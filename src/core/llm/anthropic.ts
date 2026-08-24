import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { logUsage } from "../usage";
import type { LLMMessage, LLMResult } from "./index";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: config.anthropic.apiKey });
  return client;
}

export async function chatAnthropic(opts: {
  system: string;
  messages: LLMMessage[];
  maxTokens?: number;
  feature: string;
}): Promise<LLMResult> {
  const messages: Anthropic.MessageParam[] = opts.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: config.anthropic.model,
    max_tokens: opts.maxTokens ?? 1024,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages,
  };
  // 실시간 대화 앱이라 저지연이 중요 — 기본은 thinking 비활성 (env로 adaptive 전환 가능)
  if (config.anthropic.thinking === "disabled") {
    params.thinking = { type: "disabled" };
  }

  const response = await getClient().messages.create(params);

  let text = "";
  for (const block of response.content) {
    if (block.type === "text") text += block.text;
  }

  const usage = {
    inputTokens:
      response.usage.input_tokens +
      (response.usage.cache_read_input_tokens ?? 0) +
      (response.usage.cache_creation_input_tokens ?? 0),
    outputTokens: response.usage.output_tokens,
  };
  logUsage({
    ts: Date.now(),
    kind: "llm",
    model: config.anthropic.model,
    feature: opts.feature,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });

  return { text, usage };
}
