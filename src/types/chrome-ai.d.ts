type LanguageModelAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface LanguageModelCreateOptions {
  expectedInputs?: Array<{ type: 'text'; languages: string[] }>;
  expectedOutputs?: Array<{ type: 'text'; languages: string[] }>;
  initialPrompts?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  monitor?: (monitor: EventTarget) => void;
}

interface LanguageModelSession {
  prompt(
    input: string,
    options?: { responseConstraint?: Record<string, unknown>; signal?: AbortSignal },
  ): Promise<string>;
  destroy(): void;
}

interface LanguageModelFactory {
  availability(options?: LanguageModelCreateOptions): Promise<LanguageModelAvailability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
}

declare const LanguageModel: LanguageModelFactory;
