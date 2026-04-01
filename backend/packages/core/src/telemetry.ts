type ProviderSpendEvent = {
  provider: "hypeauditor" | "openai" | "youtube_discovery" | "youtube_context";
  operation: string;
  outcome: "fresh_call" | "cache_hit" | "payload_reuse" | "not_ready" | "error";
  retryAttempt: boolean;
  durationMs: number;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
};

export function logProviderSpend(event: ProviderSpendEvent): void {
  console.log(JSON.stringify({ type: "provider_spend", ...event }));
}
