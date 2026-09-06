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
  });

  // When Busboy is done parsing
  busboy.on('finish', () => {
    // Generate a unique public_id to avoid overwriting existing images.
    // Date.now() alone collides whenever two uploads sharing the same
    // filename land in the same millisecond - each request here is its own
    // Netlify function invocation (a separate process), so there's no
    // shared in-memory counter to fall back on the way the frontend's
    // uploadBatchCounter does for its own same-millisecond collision (see
    // index.html). A random suffix closes that gap regardless of how many
    // concurrent invocations are in flight. Cloudinary's default upload
    // behavior overwrites an existing asset at the same public_id, so a
    // collision here doesn't error - it silently replaces a previously
    // uploaded image's content with the new one, which is exactly the kind
    // of "an image quietly disappeared" bug this guards against.
    const uniqueSuffix = Math.random().toString(36).slice(2, 10);
    const uniqueFileName = `${Date.now()}-${uniqueSuffix}-${fileName}`;

    // Upload to Cloudinary
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'auto',
        public_id: uniqueFileName,
        // Pre-generate (in the background) just w_800 - the frontend's
        // thumbnailFetchWidth() (index.html) requests w_800 for the default
        // "M" gallery size tier, so this is the one size close to a sure
        // thing to actually get requested for every upload. Keep this in
        // sync with index.html's default tier if that ever changes.
        // (2026-09-06: this used to eagerly pre-generate w_1200 and w_1920 -
        // dropped after the account hit its Cloudinary credit cap. A
        // transformation credit is spent the first time a derivative is
        // generated whether that happens eagerly here or on-demand later;
        // the only real difference eager makes is guaranteeing that spend
        // happens for every single upload regardless of whether anyone ever
        // actually requests that size. w_1200/w_1920 are only requested for
        // a size tier a visitor has to deliberately switch to (L/XL) or a
        // lightbox someone has to deliberately open - letting those generate
        // on-demand instead means the credit is only ever spent for images
        // that actually get viewed that way, at the cost of a slower first
        // load - a cold Cloudinary transform - for that specific image.)
        eager: [
          { width: 800, crop: 'limit', fetch_format: 'auto', quality: 'auto' },
        ],
        eager_async: true,
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary Upload Error:', error);
          return callback(null, {
            statusCode: 500,
            body: JSON.stringify({ error: 'Upload failed', details: error }),
          });
        }
        // Return the secure URL
        return callback(null, {
          statusCode: 200,
          body: JSON.stringify({ url: result.secure_url }),
        });
      }
    );
    // Pipe the file buffer into Cloudinary
    if (fileBuffer) {
      uploadStream.end(fileBuffer);
    } else {
      return callback(null, {
        statusCode: 400,
        body: JSON.stringify({ error: 'No file data received' }),
      });
    }
  });

  // Parse the request body with Busboy
  busboy.end(Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8'));
};

module.exports.handler = handler;
