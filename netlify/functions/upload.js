// netlify/functions/upload.js
const cloudinary = require('cloudinary').v2;
const Busboy = require('busboy');

// Configure Cloudinary using environment variables (set these in Netlify dashboard)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

exports.handler = (event, context, callback) => {
  if (event.httpMethod !== 'POST') {
    return callback(null, {
      statusCode: 405,
      body: 'Method Not Allowed',
    });
  }

  // Initialize Busboy with headers from the request
  const busboy = new Busboy({ headers: event.headers });
  let fileBuffer = null;
  let fileName = '';
  let fileMimeType = '';

  // Listen for file data
  busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
    fileName = filename;
    fileMimeType = mimetype;
    const chunks = [];
    file.on('data', (data) => {
      chunks.push(data);
    });
    file.on('end', () => {
      fileBuffer = Buffer.concat(chunks);
    });
  });

  // When parsing is finished, upload the file to Cloudinary
  busboy.on('finish', () => {
    // Use Cloudinary's upload_stream to upload the file buffer
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
        // Return the secure URL of the uploaded image
        callback(null, {
          statusCode: 200,
          body: JSON.stringify({ url: result.secure_url }),
        });
      }
    );
    uploadStream.end(fileBuffer);
  });

  // End busboy processing
  busboy.end(
    Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8')
  );
};
