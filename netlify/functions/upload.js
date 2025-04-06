// netlify/functions/upload.js

const cloudinary = require('cloudinary').v2;
const { Busboy } = require('busboy'); // Use destructuring for Busboy

// Configure Cloudinary using environment variables (set these in your Netlify site settings)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

exports.handler = (event, context, callback) => {
  // Only accept POST requests
  if (event.httpMethod !== 'POST') {
    return callback(null, {
      statusCode: 405,
      body: 'Method Not Allowed',
    });
  }

  // Initialize Busboy to parse the form data using the headers from the event
  const busboy = new Busboy({ headers: event.headers });
  let fileBuffer = null;
  let fileName = '';

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

  busboy.on('finish', () => {
    // Upload the file buffer to Cloudinary
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
        // Return the Cloudinary secure URL in the response
        return callback(null, {
          statusCode: 200,
          body: JSON.stringify({ url: result.secure_url }),
        });
      }
    );
    uploadStream.end(fileBuffer);
  });

  // End the busboy stream. If the body is base64 encoded, decode it.
  busboy.end(Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8'));
};
