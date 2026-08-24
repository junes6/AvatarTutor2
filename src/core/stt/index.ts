// STT 어댑터 — OpenAI (gpt-4o-transcribe → whisper-1 폴백), 키 없으면 목.
// 푸시투토크로 완성 발화만 전송하므로 스트리밍 STT는 쓰지 않는다.

import { config, isMockSTT } from "../config";
import { logUsage } from "../usage";

export interface STTResult {
  text: string;
  seconds: number; // 대략적 오디오 길이 (원가 추정용)
}

export async function transcribe(
  audio: Buffer,
  mimeType: string,
  opts: { feature: string; durationSec?: number },
): Promise<STTResult> {
  const seconds = opts.durationSec ?? Math.max(1, Math.round(audio.length / 16000));
  if (isMockSTT()) {
    return { text: "(mock) Hello, nice to meet you!", seconds };
  }

  const tryModel = async (model: string): Promise<string> => {
    const form = new FormData();
    const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("mp4") ? "mp4" : mimeType.includes("wav") ? "wav" : "ogg";
    form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), `speech.${ext}`);
    form.append("model", model);
    form.append("language", "en");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.openai.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`STT ${model} failed (${res.status}): ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { text: string };
    return data.text ?? "";
  };

  let text: string;
  let model = config.openai.sttModel;
  try {
    text = await tryModel(model);
  } catch {
    // gpt-4o-transcribe 미지원 계정 등 → whisper-1 폴백
    model = "whisper-1";
    text = await tryModel(model);
  }

  logUsage({ ts: Date.now(), kind: "stt", model, feature: opts.feature, seconds });
  return { text: text.trim(), seconds };
}
