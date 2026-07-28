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

    const apiKey = process.env.CLOUD_VISION_API;
    if (!apiKey) {
      return { statusCode: 500, body: 'Missing API key' };
    }

    const body = {
      requests: [
        {
          image: { source: { imageUri: imageUrl } },
          // Combine general labels with localized object detection for richer,
          // more accurate tags than the client-side MobileNet fallback
          features: [
            { type: 'LABEL_DETECTION', maxResults: 15 },
            { type: 'OBJECT_LOCALIZATION', maxResults: 15 }
          ]
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
    const result = (data.responses && data.responses[0]) || {};
    const labels = result.labelAnnotations || [];
    const objects = result.localizedObjectAnnotations || [];

    // Merge labels and localized objects, keeping the higher confidence score
    // when the same thing is detected by both
    const MIN_SCORE = 0.6;
    const merged = new Map();
    for (const l of labels) {
      const name = l.description.toLowerCase();
      const score = l.score || 0;
      if (!merged.has(name) || merged.get(name) < score) merged.set(name, score);
    }
    for (const o of objects) {
      const name = o.name.toLowerCase();
      const score = o.score || 0;
      if (!merged.has(name) || merged.get(name) < score) merged.set(name, score);
    }

    const allSorted = [...merged.entries()].sort((a, b) => b[1] - a[1]);
    // Prefer confident detections, but backfill with lower-confidence ones
    // (still real detections) so we can always reach a fixed tag count
    const tagNames = allSorted.filter(([, score]) => score >= MIN_SCORE).map(([name]) => name);
    for (const [name] of allSorted) {
      if (tagNames.length >= 5) break;
      if (!tagNames.includes(name)) tagNames.push(name);
    }

    const generalTagMappings = {
      brick: ['wall', 'masonry'],
      stone: ['rock', 'material'],
      wood: ['material', 'timber'],
      metal: ['material'],
      concrete: ['material'],
      leather: ['material'],
      fabric: ['material'],
      grass: ['plant'],
      dirt: ['ground'],
      sand: ['ground'],
      rock: ['stone'],
      water: ['liquid'],
      sky: ['outdoor'],
      cloud: ['sky'],
      fire: ['flame'],
      rust: ['metal'],
      paint: ['color'],
      glass: ['material'],
      ceramic: ['material'],
      plastic: ['material'],
      paper: ['material'],
      cardboard: ['paper']
    };

    if (tagNames.length < 5) {
      for (const tag of [...tagNames]) {
        const extras = generalTagMappings[tag];
        if (extras) {
          for (const extra of extras) {
            if (tagNames.length >= 5) break;
            if (!tagNames.includes(extra)) {
              tagNames.push(extra);
            }
          }
        }
        if (tagNames.length >= 5) break;
      }
    }

    // Last-resort filler if the image genuinely has fewer than 5 detections,
    // so the tag count is always exactly 5
    const fillerTags = ['reference', 'material', 'texture', 'surface', 'photo'];
    for (const filler of fillerTags) {
      if (tagNames.length >= 5) break;
      if (!tagNames.includes(filler)) tagNames.push(filler);
    }

    const tags = tagNames.slice(0, 5).join(', ');
    const possibleObjects = allSorted.map(([name, score]) => ({ name, confidence: score }));

    return {
      statusCode: 200,
      body: JSON.stringify({ tags, possibleObjects })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
