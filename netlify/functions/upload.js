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

  // Initialize Busboy (classic usage)
  const busboy = Busboy({ headers: event.headers });

  let fileBuffer = null;
  let fileName = '';

  // When Busboy finds a file
  busboy.on('file', (fieldname, file, filename) => {
    fileName = filename;
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
    // Upload to Cloudinary
    const uploadStream = cloudinary.uploader.upload_stream(
      { resource_type: 'auto', public_id: fileName },
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
    uploadStream.end(fileBuffer);
  });

  // Parse the request body with Busboy
  busboy.end(Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8'));
};

module.exports.handler = handler;
