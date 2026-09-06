// netlify/functions/deleteImage.js
//
// Deletes a Cloudinary asset. Exists because deleting a gallery image (or
// dismissing a Review Submissions entry) only ever removed the Firestore
// doc pointing at it - the actual Cloudinary asset (plus its eager
// derivative) stayed forever, so Storage only ever grew from image churn,
// never shrank. Cloudinary's destroy API needs the account's secret key
// (same CLOUDINARY_API_SECRET already used by upload.js), so this can't run
// client-side - which means it needs its own auth check, since every image
// URL is already visible in the page source to any visitor and this
// endpoint would otherwise be a public "delete any of this account's
// images" endpoint.
//
// Verifies the caller's Firebase ID token against Firebase's own public
// signing keys rather than pulling in the full firebase-admin SDK - that
// would need a service-account credential (full admin access to the whole
// Firebase project, Console-only to generate), where this only needs to
// check a signature. See https://github.com/panva/jose/discussions/626 for
// the JWKS URL below (the "jwk" endpoint returns proper JWK-Set JSON,
// unlike the x509-cert endpoint firebase-admin itself uses internally).

const cloudinary = require('cloudinary').v2;
const { createRemoteJWKSet, jwtVerify } = require('jose');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Both public, non-secret values - the same ones already inlined in
// index.html's client-side firebaseConfig (see CLAUDE.md's "Environment
// variables" section on why that's fine to have in client code at all).
const FIREBASE_PROJECT_ID = 'referencesadrien';
const ADMIN_EMAIL = 'isakovicadrien@gmail.com';
const FIREBASE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

// Lazily created once per warm function instance (createRemoteJWKSet keeps
// its own internal cache of the fetched keys), not per request.
let jwks = null;
function getJwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
  return jwks;
}

async function verifyAdminIdToken(idToken) {
  const { payload } = await jwtVerify(idToken, getJwks(), {
    issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
    audience: FIREBASE_PROJECT_ID,
    algorithms: ['RS256'],
  });
  if (payload.email !== ADMIN_EMAIL) {
    throw new Error('Token does not belong to the admin account');
  }
}

// Pulls the Cloudinary public_id out of a stored delivery URL, e.g.
// https://res.cloudinary.com/<cloud>/image/upload/v1699999999/167-abc-photo.jpg
// -> "167-abc-photo". Expects the *original* URL as stored in Firestore
// (what upload.js returned), not a cloudinaryDisplayUrl()-transformed
// display URL - the frontend call sites here only ever pass
// container.dataset.url, which is always the original.
function publicIdFromUrl(url) {
  const match = typeof url === 'string' && url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+(?:\?.*)?$/);
  return match ? match[1] : null;
}

const handler = async (event, context, callback) => {
  if (event.httpMethod !== 'POST') {
    return callback(null, { statusCode: 405, body: 'Method Not Allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return callback(null, { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) });
  }

  const { idToken, url } = body;
  if (!idToken || !url) {
    return callback(null, { statusCode: 400, body: JSON.stringify({ error: 'Missing idToken or url' }) });
  }

  try {
    await verifyAdminIdToken(idToken);
  } catch (err) {
    return callback(null, { statusCode: 403, body: JSON.stringify({ error: 'Not authorized' }) });
  }

  const publicId = publicIdFromUrl(url);
  if (!publicId) {
    return callback(null, { statusCode: 400, body: JSON.stringify({ error: 'Could not determine public_id from url' }) });
  }

  try {
    // invalidate: true also purges any already-cached CDN edge copies, so a
    // deleted image can't keep serving stale from the edge somewhere it's
    // still (incorrectly) linked.
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
    return callback(null, { statusCode: 200, body: JSON.stringify({ result }) });
  } catch (err) {
    console.error('Cloudinary destroy error:', err);
    return callback(null, { statusCode: 500, body: JSON.stringify({ error: 'Cloudinary destroy failed', details: err.message }) });
  }
};

module.exports.handler = handler;
module.exports._internal = { publicIdFromUrl, verifyAdminIdToken };
