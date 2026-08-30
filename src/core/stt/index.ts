// STT 어댑터 — OpenAI gpt-4o-transcribe, 모델 미지원인 경우에만 whisper-1 폴백.
// 키가 없을 때 가짜 고정 문장을 반환하지 않는다. 클라이언트 browser transcript가 있으면
// turn API의 text 필드로 전달하고, 없으면 명확한 빈 인식 결과로 재시도를 유도한다.

import { config, isMockSTT } from "../config";
import { logUsage } from "../usage";

export type STTSource = "openai" | "unavailable";

export interface STTResult {
  text: string;
  seconds: number;
  model: string;
  source: STTSource;
}

export interface STTOptions {
  feature: string;
  durationSec?: number;
  /** ISO-639-1 또는 en-US 형태. "auto"면 language 파라미터를 생략한다. */
  language?: string;
  prompt?: string;
  /** 브라우저가 녹음 전송을 취소하거나 화면을 떠나면 provider 요청도 중단한다. */
  signal?: AbortSignal;
}

export class STTError extends Error {
  readonly status?: number;
  readonly code: "invalid-audio" | "timeout" | "provider-error";
  readonly providerBody?: string;

  constructor(
    message: string,
    options: { status?: number; code?: STTError["code"]; providerBody?: string } = {},
  ) {
    super(message);
    this.name = "STTError";
    this.status = options.status;
    this.code = options.code ?? "provider-error";
    this.providerBody = options.providerBody;
  }
}

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_PROMPT =
  "Conversational English practice. Transcribe only what the speaker actually says. Keep names, contractions, and incomplete sentences; do not invent missing speech.";

export function normalizeSTTText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 한 턴의 최종 문장을 선택한다. 일반 녹음은 서버 STT를 우선하지만, 사용자가
 * 직접 확인·수정해 보낸 문장은 authoritative로 표시해 녹음 재인식 결과가 덮지 못하게 한다.
 */
export function selectTurnTranscript(
  clientText: string,
  serverText: string,
  clientIsAuthoritative = false,
): string {
  const client = normalizeSTTText(clientText);
  if (clientIsAuthoritative) return client;
  return normalizeSTTText(serverText) || client;
}

function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("mp4") || normalized.includes("m4a")) return "m4a";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("ogg") || normalized.includes("opus")) return "ogg";
  return "webm";
}

function normalizedLanguage(language?: string): string | null {
  const value = language?.trim() || "en";
  if (value.toLowerCase() === "auto") return null;
  const base = value.split("-")[0].toLowerCase();
  return /^[a-z]{2,3}$/.test(base) ? base : "en";
}

function estimateSeconds(audio: Buffer, supplied?: number): number {
  if (Number.isFinite(supplied) && Number(supplied) > 0) return Number(supplied);
  // 압축률은 브라우저/코덱마다 다르므로 추정치는 과금 집계용 근사값일 뿐이다.
  return Math.max(0.1, Math.round((audio.length / 2_000) * 10) / 10);
}

function shouldFallbackModel(error: unknown, attemptedModel: string): boolean {
  if (!(error instanceof STTError) || attemptedModel === "whisper-1") return false;
  if (error.status === 404) return true;
  if (error.status !== 400) return false;
  return /model|gpt-4o-transcribe|not supported|does not exist|not found|access/i.test(error.providerBody ?? "");
}

async function transcribeWithModel(
  audio: Buffer,
  mimeType: string,
  model: string,
  options: STTOptions,
): Promise<string> {
  const form = new FormData();
  const safeMime = mimeType || "audio/webm";
  form.append(
    "file",
    new Blob([new Uint8Array(audio)], { type: safeMime }),
    `speech.${extensionForMimeType(safeMime)}`,
  );
  form.append("model", model);
  form.append("response_format", "json");
  const language = normalizedLanguage(options.language);
  if (language) form.append("language", language);
  const prompt = normalizeSTTText(options.prompt || DEFAULT_PROMPT).slice(0, 500);
  if (prompt) form.append("prompt", prompt);

  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("STT request timed out"));
  }, REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.openai.apiKey}` },
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 500);
      throw new STTError(`STT ${model} failed (${res.status})`, { status: res.status, providerBody: body });
    }
    const data = (await res.json()) as { text?: unknown };
    return normalizeSTTText(typeof data.text === "string" ? data.text : "");
  } catch (error) {
    if (controller.signal.aborted && timedOut) {
      throw new STTError(`STT request timed out after ${REQUEST_TIMEOUT_MS}ms`, { code: "timeout" });
    }
    if (controller.signal.aborted && options.signal?.aborted) {
      throw options.signal.reason instanceof Error ? options.signal.reason : new Error("STT request cancelled");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function transcribe(
  audio: Buffer,
  mimeType: string,
  options: STTOptions,
): Promise<STTResult> {
  if (options.signal?.aborted) {
    throw options.signal.reason instanceof Error ? options.signal.reason : new Error("STT request cancelled");
  }
  const seconds = estimateSeconds(audio, options.durationSec);
  if (audio.length === 0) return { text: "", seconds: 0, model: "none", source: "unavailable" };
  if (audio.length > MAX_AUDIO_BYTES) {
    throw new STTError("audio exceeds the 25 MB transcription limit", { code: "invalid-audio" });
  }
  if (isMockSTT()) {
    return { text: "", seconds, model: "unavailable", source: "unavailable" };
  }

  let model = config.openai.sttModel.trim() || "gpt-4o-transcribe";
  let text: string;
  try {
    text = await transcribeWithModel(audio, mimeType, model, options);
  } catch (error) {
    if (!shouldFallbackModel(error, model)) throw error;
    model = "whisper-1";
    text = await transcribeWithModel(audio, mimeType, model, options);
  }

  logUsage({ ts: Date.now(), kind: "stt", model, feature: options.feature, seconds });
  return { text, seconds, model, source: "openai" };
}
