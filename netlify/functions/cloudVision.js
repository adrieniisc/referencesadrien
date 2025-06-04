const fetch = global.fetch || require('node-fetch');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { imageUrl } = JSON.parse(event.body || '{}');
    if (!imageUrl) {
      return { statusCode: 400, body: 'Missing imageUrl' };
    }

    const apiKey = process.env.VISION_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: 'Missing API key' };
    }

    const body = {
      requests: [
        {
          image: { source: { imageUri: imageUrl } },
          features: [{ type: 'LABEL_DETECTION', maxResults: 5 }]
        }
      ]
    };

    const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      return { statusCode: response.status, body: text };
    }

    const data = await response.json();
    const labels = (data.responses && data.responses[0].labelAnnotations) || [];

    const tags = labels.map(l => l.description.toLowerCase()).slice(0,5).join(', ');
    const possibleObjects = labels.map(l => ({ name: l.description.toLowerCase(), confidence: l.score }));

    return {
      statusCode: 200,
      body: JSON.stringify({ tags, possibleObjects })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
