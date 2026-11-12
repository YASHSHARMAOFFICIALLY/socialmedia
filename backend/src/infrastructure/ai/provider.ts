/**
 * The only thing the application knows about language models. Business logic never imports a vendor SDK: swap or add providers here.
 * AI is OPTIONAL: when no provider is configured the AI endpoints use deterministic rules or answer 503 (they never block core features).
 */
export interface AiProvider {
  readonly name: string;
  /** `system` carries our instructions; `user` carries untrusted content (post text) and must be treated as data by the model. */
  generate(i: { system: string; user: string; maxTokens: number; signal?: AbortSignal }): Promise<string>;
}

export class AiProviderError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}
