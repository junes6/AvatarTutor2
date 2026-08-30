// LLM 어댑터 — Anthropic/OpenAI를 선택하며, 키가 없으면 목(mock)으로 폴백.

import { getLLMProvider } from "../config";
import type { TokenUsage } from "../types";
import { chatAnthropic } from "./anthropic";
import { chatMock } from "./mock";
import { chatOpenAI } from "./openai";

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
  signal?: AbortSignal;
}): Promise<LLMResult> {
  const provider = getLLMProvider();
  if (provider === "anthropic") return chatAnthropic(opts);
  if (provider === "openai") return chatOpenAI(opts);
  return chatMock(opts);
}
