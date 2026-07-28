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
          // LABEL_DETECTION gives broad, descriptive tags (material, texture,
          // wall...), which fits a materials/reference library much better
          // than OBJECT_LOCALIZATION's narrow, overly specific object names
          features: [{ type: 'LABEL_DETECTION', maxResults: 15 }]
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

    const MIN_SCORE = 0.75;
    // Backfilling from very low-confidence labels produced nonsense tags
    // (a chess set once came back as "fountain, goblet, beer"), so the
    // backfill tier still requires a reasonable bar - anything below it
    // is better left to the generic filler further down than shown as fact
    const BACKFILL_MIN_SCORE = 0.5;
    const allSorted = labels
      .map(l => [l.description.toLowerCase(), l.score || 0])
      .sort((a, b) => b[1] - a[1]);
    const tagNames = allSorted.filter(([, score]) => score >= MIN_SCORE).map(([name]) => name);
    for (const [name, score] of allSorted) {
      if (tagNames.length >= 5) break;
      if (score < BACKFILL_MIN_SCORE) break; // sorted descending, so nothing after this qualifies either
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

    // Expand with directly-related categories (e.g. "brick" -> "wall") when
    // we're short - these still describe the actual image, unlike generic
    // filler ("reference", "texture"...) which was showing up as if it were
    // real information on images Vision barely recognized anything in
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

    // No further padding: showing 1-4 accurate tags beats padding to 5
    // with words that have nothing to do with the image
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
