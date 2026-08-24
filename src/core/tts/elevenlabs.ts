import { config } from "../config";
import type { TTSResult } from "./index";

// ElevenLabs TTS 어댑터. 튜터별 voice id는 data/personas.json의 voice.elevenlabs에 지정.
export async function synthElevenLabs(text: string, voiceId: string, speed: number): Promise<TTSResult> {
  const id = voiceId || "21m00Tcm4TlvDq8ikWAM"; // 기본 voice (Rachel)
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}`, {
    method: "POST",
    headers: {
      "xi-api-key": config.elevenlabs.apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed },
    }),
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { audioBase64: buf.toString("base64"), mime: "audio/mpeg" };
}
