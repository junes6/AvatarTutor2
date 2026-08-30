import { config } from "../config";
import type { TTSAudioData } from "./index";

const REQUEST_TIMEOUT_MS = 6_000;

function supportsInstructions(model: string): boolean {
  return model.startsWith("gpt-4o-mini-tts");
}

export async function synthOpenAI(
  text: string,
  voice: string,
  speed: number,
  instructions?: string,
  signal?: AbortSignal,
): Promise<TTSAudioData> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.openai.ttsModel,
        voice: voice || "alloy",
        input: text,
        speed,
        response_format: "mp3",
        ...(instructions && supportsInstructions(config.openai.ttsModel) ? { instructions } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`OpenAI TTS failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error("OpenAI TTS returned empty audio");
    return { audioBase64: buf.toString("base64"), mime: "audio/mpeg" };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`OpenAI TTS timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
