// 학습자가 보낸 사진 인식 — 튜터가 사진을 "보고" 영어로 물어볼 수 있게 한다.
// 텍스트 전용 chatLLM과 계약이 달라 별도 모듈로 분리했다.

import { config, getLLMProvider } from "./config";
import { logUsage } from "./usage";

const TIMEOUT_MS = 20_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const SYSTEM = [
  "You describe a photo a language learner just sent to their English-speaking friend.",
  "Reply with one or two short English sentences naming what is actually visible: objects, food, place, weather, mood.",
  "Do not greet, do not ask questions, do not speculate about who the people are.",
  "If the photo contains readable text (a sign, a menu), mention it.",
].join(" ");

export interface ParsedImage {
  mime: string;
  base64: string;
}

/** data URL 파싱 + 크기/형식 검증. 잘못된 입력은 여기서 걸러 낸다. */
export function parseDataUrl(dataUrl: string): ParsedImage | null {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  const mime = match[1].toLowerCase();
  if (!ALLOWED_MIME.has(mime)) return null;
  const base64 = match[2].replace(/\s+/g, "");
  // base64 4문자 → 3바이트
  if ((base64.length * 3) / 4 > MAX_IMAGE_BYTES) return null;
  return { mime, base64 };
}

async function describeWithAnthropic(image: ParsedImage): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": config.anthropic.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.anthropic.model,
      max_tokens: 200,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.mime, data: image.base64 } },
            { type: "text", text: "Describe this photo." },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Anthropic vision failed (${response.status})`);
  const data = (await response.json()) as {
    content?: { type?: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  logUsage({
    ts: Date.now(),
    kind: "llm",
    model: config.anthropic.model,
    feature: "vision",
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  });
  return (data.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join(" ")
    .trim();
}

async function describeWithOpenAI(image: ParsedImage): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.openai.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.openai.llmModel,
      instructions: SYSTEM,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Describe this photo." },
            { type: "input_image", image_url: `data:${image.mime};base64,${image.base64}` },
          ],
        },
      ],
      max_output_tokens: 300,
      store: false,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI vision failed (${response.status}) ${body.slice(0, 160)}`);
  }
  const data = (await response.json()) as {
    output_text?: string;
    output?: { content?: { type?: string; text?: string }[] }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  logUsage({
    ts: Date.now(),
    kind: "llm",
    model: config.openai.llmModel,
    feature: "vision",
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  });
  if (data.output_text?.trim()) return data.output_text.trim();
  return (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text)
    .join("")
    .trim();
}

export function visionAvailable(): boolean {
  return getLLMProvider() !== "mock";
}

/**
 * 사진을 한두 문장 영어 설명으로 바꾼다. 인식이 불가능하면 null을 반환하고,
 * 호출자는 "사진 잘 안 보여, 뭐가 찍힌 거야?" 로 자연스럽게 되물을 수 있다.
 */
export async function describePhoto(dataUrl: string): Promise<string | null> {
  const image = parseDataUrl(dataUrl);
  if (!image) return null;
  const provider = getLLMProvider();
  if (provider === "mock") return null;
  try {
    return provider === "anthropic" ? await describeWithAnthropic(image) : await describeWithOpenAI(image);
  } catch (error) {
    console.error("[vision] describe failed:", error);
    return null;
  }
}

export const VISION_LIMITS = { MAX_IMAGE_BYTES, ALLOWED_MIME: [...ALLOWED_MIME] };
