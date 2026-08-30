// 관리자 API — 일별 사용량·원가 추정

import { NextResponse } from "next/server";
import { aggregateDaily } from "@/core/usage";
import { PRICING, getLLMProvider, isMockSTT, isMockTTS, config } from "@/core/config";

export async function GET() {
  const llmProvider = getLLMProvider();
  return NextResponse.json({
    daily: aggregateDaily(),
    pricing: PRICING,
    providers: {
      llm: llmProvider === "openai"
        ? config.openai.llmModel
        : llmProvider === "anthropic"
          ? config.anthropic.model
          : "mock",
      stt: isMockSTT() ? "mock" : config.openai.sttModel,
      tts: isMockTTS() ? "mock" : config.tts.provider === "elevenlabs" ? "elevenlabs" : config.openai.ttsModel,
      pronunciation: config.azure.key ? "azure" : "similarity-fallback",
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}
