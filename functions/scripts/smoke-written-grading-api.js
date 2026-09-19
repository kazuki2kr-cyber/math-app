const fs = require('node:fs');
const path = require('node:path');
const { buildWrittenGradingGenerationConfig } = require('../lib/writtenGradingRequest');

function loadEnv(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#][^=]*)=(.*)$/);
    if (!match) continue;
    values[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

async function main() {
  const localEnv = loadEnv(path.resolve(__dirname, '..', '.env'));
  const apiKey = process.env.GEMINI_API_KEY || localEnv.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || localEnv.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: 'Return score 1, one rubric score 1, and short Japanese feedback.' }],
        }],
        generationConfig: buildWrittenGradingGenerationConfig(1),
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini contract smoke failed (${response.status}): ${errorText.slice(0, 500)}`);
  }

  const json = await response.json();
  const text = json?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
  const parsed = JSON.parse(text);
  if (!Number.isInteger(parsed.score) || !Array.isArray(parsed.rubricScores)) {
    throw new Error('Gemini response did not match the written grading schema.');
  }

  console.log(JSON.stringify({ model, schemaAccepted: true, rubricCount: parsed.rubricScores.length }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
