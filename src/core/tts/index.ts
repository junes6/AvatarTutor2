// TTS 어댑터 — 기본 OpenAI, env(TTS_PROVIDER)로 ElevenLabs 교체 가능.
// 키가 없으면 null 반환 → 클라이언트가 브라우저 speechSynthesis로 폴백.

import { config, isMockTTS } from "../config";
import { logUsage } from "../usage";
import { synthOpenAI } from "./openai";
import { synthElevenLabs } from "./elevenlabs";

export interface TTSVoice {
  openai: string;
  elevenlabs?: string;
}

export interface TTSResult {
  audioBase64: string; // data URL 없이 순수 base64
  mime: string;
}

export async function synthesize(
  text: string,
  voice: TTSVoice,
  opts: { speed?: number; feature: string },
): Promise<TTSResult | null> {
  if (isMockTTS()) return null;
  try {
    let result: TTSResult;
    let model: string;
    if (config.tts.provider === "elevenlabs" && config.elevenlabs.apiKey) {
      result = await synthElevenLabs(text, voice.elevenlabs || "", opts.speed ?? 1.0);
      model = "elevenlabs";
    } else {
      result = await synthOpenAI(text, voice.openai, opts.speed ?? 1.0);
      model = config.openai.ttsModel;
    }
    logUsage({ ts: Date.now(), kind: "tts", model, feature: opts.feature, chars: text.length });
    return result;
  } catch (e) {
    console.error("[tts] synthesis failed, falling back to browser TTS:", e);
    return null;
  }
}
