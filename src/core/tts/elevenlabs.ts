import { config } from "../config";
import type { TTSAudioData } from "./index";

// ElevenLabs TTS 어댑터. 튜터별 voice id는 data/personas.json의 voice.elevenlabs에 지정.
const REQUEST_TIMEOUT_MS = 6_000;

export async function synthElevenLabs(text: string, voiceId: string, speed: number, signal?: AbortSignal): Promise<TTSAudioData> {
  const id = voiceId.trim();
  if (!id) throw new Error("ElevenLabs voice id is missing");
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(id)}`, {
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
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`ElevenLabs TTS failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error("ElevenLabs TTS returned empty audio");
    return { audioBase64: buf.toString("base64"), mime: "audio/mpeg" };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error(`ElevenLabs TTS timed out after ${REQUEST_TIMEOUT_MS}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
