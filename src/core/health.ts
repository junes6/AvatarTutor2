// 연결 상태 검증 — 키가 "있는지"가 아니라 "실제로 통하는지"를 확인한다.
// 목 모드를 은폐하지 않기 위해 결과를 전역 캐시에 두고 UI 배너·토스트가 그대로 읽는다.

import fs from "node:fs";
import path from "node:path";
import { config, getLLMProvider } from "./config";
import type { HealthReport, ProviderHealth, ProviderKind, ProviderStatus } from "./types";

const PROBE_TTL_MS = 5 * 60_000;
const PROBE_TIMEOUT_MS = 6_000;

interface CacheEntry {
  result: ProviderHealth;
  expiresAt: number;
}

// 프로세스 전역 캐시 — dev 서버의 모듈 재평가에도 살아남게 globalThis에 붙인다.
const globalCache = globalThis as typeof globalThis & {
  __avatarTutorHealth?: { cache: Map<string, CacheEntry>; inflight: Map<string, Promise<ProviderHealth>> };
};
const state = (globalCache.__avatarTutorHealth ??= { cache: new Map(), inflight: new Map() });

function ok(kind: ProviderKind, provider: string, detail?: string): ProviderHealth {
  return { kind, provider, status: "live", detail, checkedAt: Date.now() };
}

function fail(kind: ProviderKind, provider: string, status: ProviderStatus, detail: string): ProviderHealth {
  return { kind, provider, status, detail, checkedAt: Date.now() };
}

async function probeHttp(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  return { status: response.status, body: (await response.text()).slice(0, 300) };
}

function classifyHttp(status: number, body: string): { status: ProviderStatus; detail: string } | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403) return { status: "invalid-key", detail: `인증 거부 (${status})` };
  return { status: "error", detail: `응답 오류 ${status} ${body.replace(/\s+/g, " ").slice(0, 120)}` };
}

async function probeLLM(): Promise<ProviderHealth> {
  const provider = getLLMProvider();
  if (provider === "mock") {
    return fail("llm", "mock", "missing-key", "ANTHROPIC_API_KEY / OPENAI_API_KEY 가 모두 비어 있습니다.");
  }
  try {
    if (provider === "anthropic") {
      const { status, body } = await probeHttp("https://api.anthropic.com/v1/models?limit=1", {
        "x-api-key": config.anthropic.apiKey,
        "anthropic-version": "2023-06-01",
      });
      const problem = classifyHttp(status, body);
      return problem
        ? fail("llm", config.anthropic.model, problem.status, problem.detail)
        : ok("llm", config.anthropic.model);
    }
    const { status, body } = await probeHttp("https://api.openai.com/v1/models", {
      Authorization: `Bearer ${config.openai.apiKey}`,
    });
    const problem = classifyHttp(status, body);
    return problem
      ? fail("llm", config.openai.llmModel, problem.status, problem.detail)
      : ok("llm", config.openai.llmModel);
  } catch (error) {
    return fail("llm", provider, "error", errorText(error));
  }
}

async function probeOpenAIScoped(kind: "stt" | "tts", model: string): Promise<ProviderHealth> {
  if (!config.openai.apiKey) {
    return fail(kind, "openai", "missing-key", "OPENAI_API_KEY 가 비어 있습니다.");
  }
  try {
    const { status, body } = await probeHttp("https://api.openai.com/v1/models", {
      Authorization: `Bearer ${config.openai.apiKey}`,
    });
    const problem = classifyHttp(status, body);
    return problem ? fail(kind, model, problem.status, problem.detail) : ok(kind, model);
  } catch (error) {
    return fail(kind, model, "error", errorText(error));
  }
}

async function probeTTS(): Promise<ProviderHealth> {
  if (config.tts.provider === "elevenlabs") {
    if (!config.elevenlabs.apiKey) {
      return fail("tts", "elevenlabs", "missing-key", "ELEVENLABS_API_KEY 가 비어 있습니다.");
    }
    try {
      const { status, body } = await probeHttp("https://api.elevenlabs.io/v1/user", {
        "xi-api-key": config.elevenlabs.apiKey,
      });
      const problem = classifyHttp(status, body);
      return problem ? fail("tts", "elevenlabs", problem.status, problem.detail) : ok("tts", "elevenlabs");
    } catch (error) {
      return fail("tts", "elevenlabs", "error", errorText(error));
    }
  }
  return probeOpenAIScoped("tts", config.openai.ttsModel);
}

async function probePhotos(): Promise<ProviderHealth> {
  if (config.photos.unsplashKey) {
    try {
      const { status, body } = await probeHttp("https://api.unsplash.com/photos?per_page=1", {
        Authorization: `Client-ID ${config.photos.unsplashKey}`,
      });
      const problem = classifyHttp(status, body);
      return problem ? fail("photos", "unsplash", problem.status, problem.detail) : ok("photos", "unsplash");
    } catch (error) {
      return fail("photos", "unsplash", "error", errorText(error));
    }
  }
  if (config.photos.pexelsKey) {
    try {
      const { status, body } = await probeHttp("https://api.pexels.com/v1/curated?per_page=1", {
        Authorization: config.photos.pexelsKey,
      });
      const problem = classifyHttp(status, body);
      return problem ? fail("photos", "pexels", problem.status, problem.detail) : ok("photos", "pexels");
    } catch (error) {
      return fail("photos", "pexels", "error", errorText(error));
    }
  }
  // 사진은 없어도 학습이 막히지 않는다 — 로컬 샘플로 자동 폴백한다.
  return fail("photos", "local-samples", "disabled", "UNSPLASH/PEXELS 키가 없어 로컬 샘플 이미지를 사용합니다.");
}

function probePush(): ProviderHealth {
  if (!config.push.publicKey || !config.push.privateKey) {
    return fail("push", "web-push", "disabled", "VAPID 키가 없어 예약 메시지 알림이 앱 안에서만 표시됩니다.");
  }
  return ok("push", "web-push");
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return `응답이 ${PROBE_TIMEOUT_MS}ms 안에 오지 않았습니다.`;
    return error.message.slice(0, 160);
  }
  return String(error).slice(0, 160);
}

async function cached(key: string, probe: () => Promise<ProviderHealth>, force: boolean): Promise<ProviderHealth> {
  const now = Date.now();
  if (!force) {
    const hit = state.cache.get(key);
    if (hit && hit.expiresAt > now) return hit.result;
  }
  const running = state.inflight.get(key);
  if (running && !force) return running;

  const pending = probe()
    .then((result) => {
      state.cache.set(key, { result, expiresAt: Date.now() + PROBE_TTL_MS });
      return result;
    })
    .finally(() => {
      if (state.inflight.get(key) === pending) state.inflight.delete(key);
    });
  state.inflight.set(key, pending);
  return pending;
}

export function storageWritable(): boolean {
  const storeRoot = process.env.STORE_DIR
    ? path.resolve(process.env.STORE_DIR)
    : path.join(process.cwd(), "data", "store");
  let candidate = storeRoot;
  while (!fs.existsSync(candidate)) {
    const parent = path.dirname(candidate);
    if (parent === candidate) return false;
    candidate = parent;
  }
  try {
    fs.accessSync(candidate, fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** 대화의 핵심 경로(LLM)가 실연동이어야 데모 모드가 아니다. */
export async function getHealth(options: { force?: boolean } = {}): Promise<HealthReport> {
  const force = options.force === true;
  const [llm, stt, tts, photos] = await Promise.all([
    cached("llm", probeLLM, force),
    cached("stt", () => probeOpenAIScoped("stt", config.openai.sttModel), force),
    cached("tts", probeTTS, force),
    cached("photos", probePhotos, force),
  ]);
  const push = probePush();
  const providers = [llm, stt, tts, push, photos];
  const storage = storageWritable();

  return {
    ok: storage && llm.status === "live",
    demo: llm.status !== "live",
    storage: storage ? "writable" : "unavailable",
    providers,
    checkedAt: Date.now(),
  };
}

/** 이미 확인한 결과만 즉시 읽는다 (네트워크 호출 없음). */
export function peekHealth(): HealthReport | null {
  const kinds: ProviderKind[] = ["llm", "stt", "tts", "photos"];
  const providers: ProviderHealth[] = [];
  for (const kind of kinds) {
    const hit = state.cache.get(kind);
    if (!hit) return null;
    providers.push(hit.result);
  }
  providers.push(probePush());
  const llm = providers[0];
  const storage = storageWritable();
  return {
    ok: storage && llm.status === "live",
    demo: llm.status !== "live",
    storage: storage ? "writable" : "unavailable",
    providers,
    checkedAt: Math.min(...providers.map((p) => p.checkedAt)),
  };
}

export function clearHealthCache() {
  state.cache.clear();
  state.inflight.clear();
}
