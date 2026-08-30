import { config } from "../config";
import { logUsage } from "../usage";
import type { LLMMessage, LLMResult } from "./index";

const LLM_REQUEST_TIMEOUT_MS = 15_000;

interface OpenAIResponsePayload {
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: { message?: string };
}

function outputText(payload: OpenAIResponsePayload): string {
  if (payload.output_text?.trim()) return payload.output_text.trim();
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text)
    .join("")
    .trim();
}

export async function chatOpenAI(opts: {
  system: string;
  messages: LLMMessage[];
  maxTokens?: number;
  feature: string;
  signal?: AbortSignal;
}): Promise<LLMResult> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(opts.signal?.reason);
  if (opts.signal?.aborted) abortFromCaller();
  else opts.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("LLM request timed out")), LLM_REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.openai.llmModel,
        instructions: opts.system,
        input: opts.messages,
        max_output_tokens: opts.maxTokens ?? 1024,
        store: false,
        ...(config.openai.llmModel.startsWith("gpt-5.6-")
          ? { reasoning: { effort: "low" } }
          : {}),
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener("abort", abortFromCaller);
  }

  const payload = await response.json().catch(() => ({})) as OpenAIResponsePayload;
  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenAI LLM request failed (${response.status})`);
  }

  const text = outputText(payload);
  if (!text) throw new Error("OpenAI LLM returned no text");

  const usage = {
    inputTokens: payload.usage?.input_tokens ?? 0,
    outputTokens: payload.usage?.output_tokens ?? 0,
  };
  logUsage({
    ts: Date.now(),
    kind: "llm",
    model: config.openai.llmModel,
    feature: opts.feature,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });

  return { text, usage };
}
