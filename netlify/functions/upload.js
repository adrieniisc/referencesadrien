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
    // Generate a unique public_id to avoid overwriting existing images
    const uniqueFileName = `${Date.now()}-${fileName}`;

    // Upload to Cloudinary
    const uploadStream = cloudinary.uploader.upload_stream(
      { resource_type: 'auto', public_id: uniqueFileName },
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
