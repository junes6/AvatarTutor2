// L2 실시간 아바타 — 서버측 세션 토큰 발급 어댑터 (Anam / Simli)
// 키가 없으면 { ok: false } — 클라이언트는 자동으로 L1/L0 으로 폴백한다.
// 각 제공자의 정확한 엔드포인트/파라미터는 공식 문서 기준으로 이 파일에서만 조정하면 된다.

import { config } from "../config";

export interface L2Session {
  ok: boolean;
  provider?: "anam" | "simli";
  sessionToken?: string;
  reason?: string;
}

const SESSION_TIMEOUT_MS = 8_000;

export async function createL2Session(tutorId: string, signal?: AbortSignal): Promise<L2Session> {
  const provider = config.avatar.l2Provider;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("avatar session timed out")), SESSION_TIMEOUT_MS);
  try {
    if (provider === "anam") {
      if (!config.avatar.anamKey) return { ok: false, reason: "ANAM_API_KEY 미설정" };
      // Anam 세션 토큰 발급 (https://docs.anam.ai 참고 — 통합 지점)
      const res = await fetch("https://api.anam.ai/v1/auth/session-token", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.avatar.anamKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ personaConfig: { name: tutorId } }),
        signal: controller.signal,
      });
      if (!res.ok) return { ok: false, reason: `Anam 토큰 발급 실패 (${res.status})` };
      const data = (await res.json()) as { sessionToken?: string };
      if (!data.sessionToken) return { ok: false, reason: "Anam 응답에 sessionToken 없음" };
      return { ok: true, provider: "anam", sessionToken: data.sessionToken };
    }

    if (!config.avatar.simliKey) return { ok: false, reason: "SIMLI_API_KEY 미설정" };
    // Simli 세션 시작 (https://docs.simli.com 참고 — 통합 지점)
    const res = await fetch("https://api.simli.ai/startAudioToVideoSession", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: config.avatar.simliKey, faceId: tutorId }),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, reason: `Simli 세션 시작 실패 (${res.status})` };
    const data = (await res.json()) as { session_token?: string };
    if (!data.session_token) return { ok: false, reason: "Simli 응답에 session_token 없음" };
    return { ok: true, provider: "simli", sessionToken: data.session_token };
  } catch (e) {
    if (controller.signal.aborted) return { ok: false, reason: "L2 연결 시간이 초과되었거나 취소됨" };
    console.error("[avatar/l2] session failed", e);
    return { ok: false, reason: "L2 연결 오류" };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
