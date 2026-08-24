// 관리자 API — 일별 사용량·원가 추정

import { NextResponse } from "next/server";
import { aggregateDaily } from "@/core/usage";
import { PRICING, isMockLLM, isMockSTT, isMockTTS, config } from "@/core/config";

export async function GET() {
  return NextResponse.json({
    daily: aggregateDaily(),
    pricing: PRICING,
    providers: {
      llm: isMockLLM() ? "mock" : config.anthropic.model,
      stt: isMockSTT() ? "mock" : config.openai.sttModel,
      tts: isMockTTS() ? "mock" : config.tts.provider === "elevenlabs" ? "elevenlabs" : config.openai.ttsModel,
      pronunciation: config.azure.key ? "azure" : "similarity-fallback",
    },
  });
}
