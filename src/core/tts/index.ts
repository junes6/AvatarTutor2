// TTS 어댑터 — 설정한 provider를 우선 사용하고 다른 provider를 안전한 2차 폴백으로 사용한다.
// 서버 키가 모두 없으면 null을 반환하며 클라이언트가 튜터별 browser voice로 이어받는다.

import { config, isMockTTS } from "../config";
import { logUsage } from "../usage";
import { synthOpenAI } from "./openai";
import { synthElevenLabs } from "./elevenlabs";

export interface TTSVoice {
  openai: string;
  elevenlabs?: string;
  /** gpt-4o-mini-tts의 억양/태도 지시. 없으면 현재 캐릭터 voice id의 안정적 기본값을 사용한다. */
  instructions?: string;
}

export interface TTSAudioData {
  audioBase64: string; // data URL 없이 순수 base64
  mime: string;
}

export interface TTSResult extends TTSAudioData {
  provider: "openai" | "elevenlabs";
  voiceId: string;
}

type Provider = TTSResult["provider"];

const DEFAULT_OPENAI_VOICE = "alloy";
const SPEED_MIN = 0.5;
const SPEED_MAX = 2;
const TTS_TOTAL_TIMEOUT_MS = 6_000;

// 현재 persona 데이터의 voice id와 결합되는 발화 지시다. voice id가 같아지는 설정 실수가 있어도
// 말투/억양 차이가 유지되며, persona.voice.instructions로 언제든 덮어쓸 수 있다.
const OPENAI_VOICE_INSTRUCTIONS: Readonly<Record<string, string>> = {
  nova:
    "Speak as a bright, energetic young adult woman from California. Sound warm, playful, upbeat, and expressive, with clear learner-friendly pacing.",
  onyx:
    "Speak as a calm, measured British English man. Sound gentle, articulate, and quietly warm, with precise diction and an unhurried pace.",
  echo:
    "Speak as an upbeat, relaxed Australian English man. Sound friendly, playful, and energetic, with a natural Australian rhythm and clear diction.",
};

function clampSpeed(speed?: number): number {
  const value = Number.isFinite(speed) ? Number(speed) : 1;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, value));
}

export function resolveOpenAIVoice(voice: TTSVoice): { voiceId: string; instructions?: string } {
  const voiceId = voice.openai?.trim().toLowerCase() || DEFAULT_OPENAI_VOICE;
  const customInstructions = voice.instructions?.replace(/\s+/g, " ").trim();
  return {
    voiceId,
    instructions: customInstructions || OPENAI_VOICE_INSTRUCTIONS[voiceId],
  };
}

function providerOrder(): Provider[] {
  return config.tts.provider === "elevenlabs" ? ["elevenlabs", "openai"] : ["openai", "elevenlabs"];
}

export async function synthesize(
  text: string,
  voice: TTSVoice,
  opts: { speed?: number; feature: string; signal?: AbortSignal },
): Promise<TTSResult | null> {
  const input = text.replace(/\s+/g, " ").trim();
  if (!input || isMockTTS()) return null;

  const speed = clampSpeed(opts.speed);
  const failures: string[] = [];
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(opts.signal?.reason);
  if (opts.signal?.aborted) abortFromCaller();
  else opts.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("TTS timed out")), TTS_TOTAL_TIMEOUT_MS);
  try {
    for (const provider of providerOrder()) {
      try {
        let result: TTSAudioData;
        let voiceId: string;
        let model: string;

        if (provider === "elevenlabs") {
          voiceId = voice.elevenlabs?.trim() ?? "";
          if (!config.elevenlabs.apiKey || !voiceId) continue;
          result = await synthElevenLabs(input, voiceId, speed, controller.signal);
          model = "eleven_multilingual_v2";
        } else {
          if (!config.openai.apiKey) continue;
          const resolved = resolveOpenAIVoice(voice);
          voiceId = resolved.voiceId;
          result = await synthOpenAI(input, voiceId, speed, resolved.instructions, controller.signal);
          model = config.openai.ttsModel;
        }

        logUsage({ ts: Date.now(), kind: "tts", model, feature: opts.feature, chars: input.length });
        return { ...result, provider, voiceId };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${provider}: ${message}`);
        if (controller.signal.aborted) break;
      }
    }
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener("abort", abortFromCaller);
  }

  if (failures.length > 0) {
    console.error(`[tts] all configured providers failed; using browser fallback (${failures.join(" | ")})`);
  }
  return null;
}
