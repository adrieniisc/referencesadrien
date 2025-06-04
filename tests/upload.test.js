
jest.mock('cloudinary', () => {
  return {
    v2: {
      config: jest.fn(),
      uploader: {
        upload_stream: jest.fn()
      }
    }
  };
});

const cloudinary = require('cloudinary');
const { handler } = require('../netlify/functions/upload');

function runHandler(event) {
  return new Promise((resolve, reject) => {
    handler(event, {}, (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
}

describe('upload handler', () => {
  test('returns 405 for non-POST', async () => {
    const result = await runHandler({ httpMethod: 'GET' });
    expect(result.statusCode).toBe(405);
  });

  test('handles POST upload', async () => {
    const boundary = '----testboundary';
    const filename = 'test.txt';
    const body = `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      'Content-Type: text/plain\r\n\r\n' +
      'hello world\r\n' +
      `--${boundary}--\r\n`;

    let receivedOptions;
    cloudinary.v2.uploader.upload_stream.mockImplementation((options, cb) => {
      receivedOptions = options;
      return {
        end: () => cb(null, { secure_url: `http://example.com/${options.public_id}` })
      };
    });

    const result = await runHandler({
      httpMethod: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
      isBase64Encoded: false
    });

    expect(receivedOptions.public_id).toContain(filename);
    expect(receivedOptions.public_id).not.toBe(filename);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ url: `http://example.com/${receivedOptions.public_id}` });
  });
});
