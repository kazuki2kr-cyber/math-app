import {
  buildWrittenGradingGenerationConfig,
  isGeminiJsonSchemaConfigurationError,
  requestGeminiWithSchemaFallback,
} from '../../../functions/src/writtenGradingRequest';

describe('written grading Gemini request contract', () => {
  test('generateContent互換のresponseMimeTypeとresponseJsonSchemaを使う', () => {
    const config = buildWrittenGradingGenerationConfig(5);

    expect(config.responseMimeType).toBe('application/json');
    expect(config.responseJsonSchema).toBeDefined();
    expect(config).not.toHaveProperty('responseFormat');
    expect(config.responseJsonSchema).toMatchObject({
      properties: {
        rubricScores: {
          minItems: 5,
          maxItems: 5,
        },
      },
    });
  });

  test('フォールバック時もJSON応答を要求しつつschemaだけを外す', () => {
    const config = buildWrittenGradingGenerationConfig(5, false);

    expect(config).toEqual({
      temperature: 0.1,
      responseMimeType: 'application/json',
    });
  });

  test('schema関連の400だけをフォールバック対象にする', () => {
    expect(isGeminiJsonSchemaConfigurationError(
      400,
      "Invalid value at 'generation_config.response_json_schema'"
    )).toBe(true);
    expect(isGeminiJsonSchemaConfigurationError(429, 'quota exceeded')).toBe(false);
    expect(isGeminiJsonSchemaConfigurationError(400, 'invalid image data')).toBe(false);
  });

  test('schema設定が拒否された場合だけschemaなしで一度再試行する', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce(new Response('generation_config.response_json_schema is invalid', { status: 400 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));

    const result = await requestGeminiWithSchemaFallback(request);

    expect(request.mock.calls).toEqual([[true], [false]]);
    expect(result.response.ok).toBe(true);
    expect(result.usedFallback).toBe(true);
    expect(result.errorText).toBe('');
  });

  test('画像不正などschema以外の400は再試行しない', async () => {
    const request = jest.fn()
      .mockResolvedValue(new Response('invalid image data', { status: 400 }));

    const result = await requestGeminiWithSchemaFallback(request);

    expect(request).toHaveBeenCalledTimes(1);
    expect(result.usedFallback).toBe(false);
    expect(result.errorText).toBe('invalid image data');
  });
});
