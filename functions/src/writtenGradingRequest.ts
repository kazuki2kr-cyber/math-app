export type WrittenGradingGenerationConfig = {
  temperature: number;
  responseMimeType: "application/json";
  responseJsonSchema?: Record<string, unknown>;
};

export function buildWrittenGradingGenerationConfig(
  rubricCount: number,
  includeJsonSchema = true
): WrittenGradingGenerationConfig {
  const normalizedRubricCount = Math.max(0, Math.min(8, Math.trunc(rubricCount)));
  const baseConfig: WrittenGradingGenerationConfig = {
    temperature: 0.1,
    responseMimeType: "application/json",
  };

  if (!includeJsonSchema) return baseConfig;

  return {
    ...baseConfig,
    responseJsonSchema: {
      type: "object",
      properties: {
        score: { type: "integer", minimum: 0, maximum: 100 },
        transcription: { type: "string" },
        detectedAnswer: { type: "string" },
        rubricScores: {
          type: "array",
          minItems: normalizedRubricCount,
          maxItems: normalizedRubricCount || 8,
          items: {
            type: "object",
            properties: {
              score: { type: "integer", minimum: 0, maximum: 100 },
              comment: { type: "string" },
            },
            required: ["score", "comment"],
            additionalProperties: false,
          },
        },
        feedback: { type: "string" },
        improvementPoints: {
          type: "array",
          maxItems: 5,
          items: { type: "string" },
        },
      },
      required: [
        "score",
        "transcription",
        "detectedAnswer",
        "rubricScores",
        "feedback",
        "improvementPoints",
      ],
      additionalProperties: false,
    },
  };
}

export function isGeminiJsonSchemaConfigurationError(status: number, errorText: string): boolean {
  if (status !== 400) return false;
  return /generation[_ ]?config|response[_ ]?json[_ ]?schema|responseJsonSchema|response[_ ]?format/i.test(errorText);
}

export async function requestGeminiWithSchemaFallback(
  request: (includeJsonSchema: boolean) => Promise<Response>
): Promise<{ response: Response; errorText: string; usedFallback: boolean }> {
  let response = await request(true);
  if (response.ok) return { response, errorText: "", usedFallback: false };

  let errorText = await response.text();
  if (!isGeminiJsonSchemaConfigurationError(response.status, errorText)) {
    return { response, errorText, usedFallback: false };
  }

  response = await request(false);
  errorText = response.ok ? "" : await response.text();
  return { response, errorText, usedFallback: true };
}
