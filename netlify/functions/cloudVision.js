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
          // Request extra labels so we can always return at least 5 tags
          features: [{ type: 'LABEL_DETECTION', maxResults: 10 }]
        }
      ]
    };

    const generalTagMappings = {
      soup: ['food', 'dish', 'meal', 'liquid', 'broth'],
      salad: ['food', 'dish', 'meal', 'vegetable', 'greens'],
      car: ['vehicle', 'transport', 'auto'],
      cat: ['animal', 'pet', 'feline'],
      dog: ['animal', 'pet', 'canine'],
      tree: ['plant', 'nature', 'wood'],
      building: ['architecture', 'structure', 'construction'],
      phone: ['electronics', 'device', 'smartphone'],
      person: ['human', 'people', 'individual'],
      computer: ['electronics', 'device', 'technology']
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

    const tagNames = labels.map(l => l.description.toLowerCase());
    let processedTags = [...tagNames];
    if (processedTags.length < 5) {
      for (const tag of [...tagNames]) {
        const extras = generalTagMappings[tag];
        if (extras) {
          for (const extra of extras) {
            if (processedTags.length >= 5) break;
            if (!processedTags.includes(extra)) {
              processedTags.push(extra);
            }
          }
        }
        if (processedTags.length >= 5) break;
      }
    }

    const tags = processedTags.slice(0, 5).join(', ');
    const possibleObjects = labels.map(l => ({ name: l.description.toLowerCase(), confidence: l.score }));

    return {
      statusCode: 200,
      body: JSON.stringify({ tags, possibleObjects })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
