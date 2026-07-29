// netlify/functions/upload.js

const cloudinary = require('cloudinary').v2;
const Busboy = require('busboy'); // <-- Classic require

// Configure Cloudinary using environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const handler = (event, context, callback) => {
  // Only accept POST requests
  if (event.httpMethod !== 'POST') {
    return callback(null, {
      statusCode: 405,
      body: 'Method Not Allowed',
    });
  }

  // Normalize header names for Busboy which expects lowercase keys
  const lowerCaseHeaders = Object.keys(event.headers || {}).reduce(
    (acc, key) => {
      acc[key.toLowerCase()] = event.headers[key];
      return acc;
    },
    {}
  );

  // Initialize Busboy with normalized headers
  const busboy = Busboy({ headers: lowerCaseHeaders });

  let fileBuffer = null;
  let fileName = '';

  // Busboy (and the Cloudinary callback below) can each try to respond -
  // make sure only the first one actually calls back to Lambda.
  let responded = false;
  const respond = (response) => {
    if (responded) return;
    responded = true;
    callback(null, response);
  };

  // When Busboy finds a file
  busboy.on('file', (fieldname, file, info) => {
    fileName = info.filename;
    const chunks = [];
    file.on('data', (data) => {
      chunks.push(data);
    });
    file.on('end', () => {
      fileBuffer = Buffer.concat(chunks);
    });
    // A parse failure below destroys this file stream with the same error -
    // that's a second, separate EventEmitter 'error' with no listener of its
    // own, which crashes the invocation even though the 'error' handler below
    // already handles the overall parse failure.
    file.on('error', () => {});
  });

  // A request body that got cut off in transit (e.g. several uploads
  // competing for the same limited upload bandwidth, one of them not
  // finishing before the gateway's timeout) fails here with an "Unexpected
  // end of form" error rather than through the normal 'finish' event. With
  // no listener, that error is unhandled and crashes the whole invocation
  // (a 502 with a raw internal stack trace) instead of a clean, retryable
  // response.
  busboy.on('error', (err) => {
    console.error('Busboy parse error:', err);
    respond({
      statusCode: 400,
      body: JSON.stringify({ error: 'Upload did not complete - please try again', details: err.message }),
    });
  });

  // When Busboy is done parsing
  busboy.on('finish', () => {
    // Generate a unique public_id to avoid overwriting existing images
    const uniqueFileName = `${Date.now()}-${fileName}`;

    // Upload to Cloudinary
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'auto',
        public_id: uniqueFileName,
        // Pre-generate (in the background) the same derived sizes the
        // frontend requests for thumbnails and the lightbox, so they're
        // already cached by the time someone actually views the image
        // instead of being transformed on demand on first view.
        eager: [
          { width: 1200, crop: 'limit', fetch_format: 'auto', quality: 'auto' },
          { width: 1920, crop: 'limit', fetch_format: 'auto', quality: 'auto' },
        ],
        eager_async: true,
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary Upload Error:', error);
          return respond({
            statusCode: 500,
            body: JSON.stringify({ error: 'Upload failed', details: error }),
          });
        }
        // Return the secure URL
        return respond({
          statusCode: 200,
          body: JSON.stringify({ url: result.secure_url }),
        });
      }
    );
    // Pipe the file buffer into Cloudinary
    if (fileBuffer) {
      uploadStream.end(fileBuffer);
    } else {
      return respond({
        statusCode: 400,
        body: JSON.stringify({ error: 'No file data received' }),
      });
    }
  });

  // Parse the request body with Busboy
  busboy.end(Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8'));
};

module.exports.handler = handler;
