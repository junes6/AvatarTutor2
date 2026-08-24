// LLM 어댑터 — Anthropic Claude가 기본, 키가 없으면 목(mock)으로 폴백.

import { isMockLLM } from "../config";
import type { TokenUsage } from "../types";
import { chatAnthropic } from "./anthropic";
import { chatMock } from "./mock";

export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMResult {
  text: string;
  usage: TokenUsage;
}

export async function chatLLM(opts: {
  system: string;
  messages: LLMMessage[];
  maxTokens?: number;
  feature: string; // usage 로깅용
}): Promise<LLMResult> {
  if (isMockLLM()) return chatMock(opts);
  return chatAnthropic(opts);
}
