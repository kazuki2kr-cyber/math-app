const assert = require('node:assert/strict');
const {
  buildWrittenGradingGenerationConfig,
  isGeminiJsonSchemaConfigurationError,
} = require('../lib/writtenGradingRequest');

const structured = buildWrittenGradingGenerationConfig(5);
assert.equal(structured.responseMimeType, 'application/json');
assert.ok(structured.responseJsonSchema);
assert.equal(Object.prototype.hasOwnProperty.call(structured, 'responseFormat'), false);
assert.equal(structured.responseJsonSchema.properties.rubricScores.minItems, 5);
assert.equal(structured.responseJsonSchema.properties.rubricScores.maxItems, 5);

const fallback = buildWrittenGradingGenerationConfig(5, false);
assert.deepEqual(fallback, {
  temperature: 0.1,
  responseMimeType: 'application/json',
});
assert.equal(
  isGeminiJsonSchemaConfigurationError(400, "Invalid value at 'generation_config.response_json_schema'"),
  true
);

console.log('Written grading Gemini request contract: OK');
