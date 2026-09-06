const jose = require('jose');

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: { destroy: jest.fn() },
  },
}));

// Only the "fetch keys from Google" part is faked - a real RSA key pair is
// generated per test run and jwtVerify() itself (unmocked, the real
// signature-checking code) runs against it, so this exercises the actual
// verification logic, not a stand-in for it.
jest.mock('jose', () => {
  const actual = jest.requireActual('jose');
  return { ...actual, createRemoteJWKSet: jest.fn() };
});

const cloudinary = require('cloudinary');
const { handler, _internal } = require('../netlify/functions/deleteImage');

const PROJECT_ID = 'referencesadrien';
const ADMIN_EMAIL = 'isakovicadrien@gmail.com';
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;

function runHandler(event) {
  return new Promise((resolve, reject) => {
    handler(event, {}, (err, res) => (err ? reject(err) : resolve(res)));
  });
}

let signingKey;
let otherKey; // a second, unrelated key pair - used to prove a token signed
              // by *anyone else* is rejected, not just malformed tokens.

async function signToken(privateKey, overrides = {}) {
  return new jose.SignJWT({ email: ADMIN_EMAIL, ...overrides.claims })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? PROJECT_ID)
    .setExpirationTime(overrides.expiresIn ?? '1h')
    .sign(privateKey);
}

beforeAll(async () => {
  signingKey = await jose.generateKeyPair('RS256');
  otherKey = await jose.generateKeyPair('RS256');
  const jwk = await jose.exportJWK(signingKey.publicKey);
  jwk.alg = 'RS256';
  jwk.kid = 'test-key';
  const jwks = jose.createLocalJWKSet({ keys: [jwk] });
  jose.createRemoteJWKSet.mockReturnValue(jwks);
});

beforeEach(() => {
  cloudinary.v2.uploader.destroy.mockReset();
  cloudinary.v2.uploader.destroy.mockResolvedValue({ result: 'ok' });
});

const IMAGE_URL = 'https://res.cloudinary.com/demo/image/upload/v1712345678/167-abc123-photo.jpg';

describe('publicIdFromUrl', () => {
  test('extracts the public_id, stripping version and extension', () => {
    expect(_internal.publicIdFromUrl(IMAGE_URL)).toBe('167-abc123-photo');
  });

  test('works without a version segment', () => {
    expect(_internal.publicIdFromUrl('https://res.cloudinary.com/demo/image/upload/name.png')).toBe('name');
  });

  test('returns null for a non-Cloudinary or malformed url', () => {
    expect(_internal.publicIdFromUrl('https://example.com/not-cloudinary.jpg')).toBeNull();
    expect(_internal.publicIdFromUrl(null)).toBeNull();
    expect(_internal.publicIdFromUrl(undefined)).toBeNull();
  });
});

describe('deleteImage handler', () => {
  test('rejects non-POST', async () => {
    const result = await runHandler({ httpMethod: 'GET' });
    expect(result.statusCode).toBe(405);
  });

  test('rejects missing idToken/url', async () => {
    const result = await runHandler({ httpMethod: 'POST', body: JSON.stringify({}) });
    expect(result.statusCode).toBe(400);
    expect(cloudinary.v2.uploader.destroy).not.toHaveBeenCalled();
  });

  test('rejects invalid JSON body', async () => {
    const result = await runHandler({ httpMethod: 'POST', body: '{not json' });
    expect(result.statusCode).toBe(400);
  });

  test('deletes the Cloudinary asset for a valid admin token', async () => {
    const idToken = await signToken(signingKey.privateKey);
    const result = await runHandler({ httpMethod: 'POST', body: JSON.stringify({ idToken, url: IMAGE_URL }) });
    expect(result.statusCode).toBe(200);
    expect(cloudinary.v2.uploader.destroy).toHaveBeenCalledWith('167-abc123-photo', { resource_type: 'image', invalidate: true });
  });

  test('rejects a validly-signed token for a different email', async () => {
    const idToken = await signToken(signingKey.privateKey, { claims: { email: 'someone-else@example.com' } });
    const result = await runHandler({ httpMethod: 'POST', body: JSON.stringify({ idToken, url: IMAGE_URL }) });
    expect(result.statusCode).toBe(403);
    expect(cloudinary.v2.uploader.destroy).not.toHaveBeenCalled();
  });

  test('rejects a token signed by a different key (not Firebase)', async () => {
    const idToken = await signToken(otherKey.privateKey);
    const result = await runHandler({ httpMethod: 'POST', body: JSON.stringify({ idToken, url: IMAGE_URL }) });
    expect(result.statusCode).toBe(403);
    expect(cloudinary.v2.uploader.destroy).not.toHaveBeenCalled();
  });

  test('rejects an expired token', async () => {
    const idToken = await signToken(signingKey.privateKey, { expiresIn: '-1h' });
    const result = await runHandler({ httpMethod: 'POST', body: JSON.stringify({ idToken, url: IMAGE_URL }) });
    expect(result.statusCode).toBe(403);
    expect(cloudinary.v2.uploader.destroy).not.toHaveBeenCalled();
  });

  test('rejects a token with the wrong audience/project id', async () => {
    const idToken = await signToken(signingKey.privateKey, { audience: 'some-other-project' });
    const result = await runHandler({ httpMethod: 'POST', body: JSON.stringify({ idToken, url: IMAGE_URL }) });
    expect(result.statusCode).toBe(403);
    expect(cloudinary.v2.uploader.destroy).not.toHaveBeenCalled();
  });

  test('rejects a token with the wrong issuer', async () => {
    const idToken = await signToken(signingKey.privateKey, { issuer: 'https://securetoken.google.com/some-other-project' });
    const result = await runHandler({ httpMethod: 'POST', body: JSON.stringify({ idToken, url: IMAGE_URL }) });
    expect(result.statusCode).toBe(403);
    expect(cloudinary.v2.uploader.destroy).not.toHaveBeenCalled();
  });

  test('returns 400 and never calls destroy when the url is not parseable', async () => {
    const idToken = await signToken(signingKey.privateKey);
    const result = await runHandler({ httpMethod: 'POST', body: JSON.stringify({ idToken, url: 'not-a-cloudinary-url' }) });
    expect(result.statusCode).toBe(400);
    expect(cloudinary.v2.uploader.destroy).not.toHaveBeenCalled();
  });

  test('returns 500 if Cloudinary destroy itself fails, after a valid admin check', async () => {
    cloudinary.v2.uploader.destroy.mockRejectedValue(new Error('cloudinary down'));
    const idToken = await signToken(signingKey.privateKey);
    const result = await runHandler({ httpMethod: 'POST', body: JSON.stringify({ idToken, url: IMAGE_URL }) });
    expect(result.statusCode).toBe(500);
  });
});
