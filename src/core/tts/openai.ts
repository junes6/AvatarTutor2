import { config } from "../config";
import type { TTSResult } from "./index";

export async function synthOpenAI(text: string, voice: string, speed: number): Promise<TTSResult> {
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
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI TTS failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { audioBase64: buf.toString("base64"), mime: "audio/mpeg" };
}
