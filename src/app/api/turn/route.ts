// 대화 턴 API — 푸시투토크 오디오(또는 텍스트) → STT → 파이프라인 → TTS

import { NextResponse } from "next/server";
import {
  clearActiveSessionTurn,
  getSession,
  registerActiveSessionTurn,
  saveSession,
  withSessionLock,
} from "@/core/session";
import { runTurn } from "@/core/pipeline/turn";
import { normalizeSTTText, selectTurnTranscript, transcribe } from "@/core/stt";
import { assessPronunciation, isLikelyRepeatAttempt } from "@/core/pronunciation";
import { findExpression } from "@/core/content";
import { getUser, xpLevel } from "@/core/gamification";
import type { Judgment } from "@/core/types";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_USER_TEXT_LENGTH = 2_000;
const MAX_REPEAT_TARGET_LENGTH = 500;
const MAX_SESSION_ID_LENGTH = 80;
const MAX_CLIENT_TURN_ID_LENGTH = 80;
const MAX_JSON_BYTES = 32 * 1024;

export async function POST(req: Request) {
  let sessionId = "";
  let turnController: AbortController | null = null;
  const abortFromRequest = () => turnController?.abort(req.signal.reason);
  try {
    let userText = "";
    let repeatTarget = "";
    let audioBuf: Buffer | null = null;
    let mime = "";
    let durationSec = 0;
    let sttUnavailable = false;
    let textAuthoritative = false;
    let inputLanguage = "en-US";
    let clientTurnId = "";

    const contentType = req.headers.get("content-type") ?? "";
    const contentLength = Number(req.headers.get("content-length") ?? 0);
    const maxRequestBytes = contentType.includes("multipart/form-data")
      ? MAX_AUDIO_BYTES + 1024 * 1024
      : MAX_JSON_BYTES;
    if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
      return NextResponse.json({ error: "request too large" }, { status: 413 });
    }
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      sessionId = String(form.get("sessionId") ?? "");
      repeatTarget = String(form.get("repeatTarget") ?? "");
      durationSec = Number(form.get("durationSec") ?? 0);
      textAuthoritative = String(form.get("textAuthoritative") ?? "").toLowerCase() === "true";
      inputLanguage = String(form.get("inputLanguage") ?? "en-US");
      clientTurnId = String(form.get("clientTurnId") ?? "");
      const audio = form.get("audio");
      if (audio instanceof Blob) {
        if (audio.size > MAX_AUDIO_BYTES) {
          return NextResponse.json({ error: "audio too large" }, { status: 413 });
        }
        audioBuf = Buffer.from(await audio.arrayBuffer());
        mime = audio.type || "audio/webm";
      }
      userText = String(form.get("text") ?? "");
    } else {
      const parsed = await req.json();
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return NextResponse.json({ error: "invalid request" }, { status: 400 });
      }
      const body = parsed as Record<string, unknown>;
      sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
      userText = typeof body.text === "string" ? body.text : "";
      repeatTarget = typeof body.repeatTarget === "string" ? body.repeatTarget : "";
      textAuthoritative = body.textAuthoritative === true;
      inputLanguage = typeof body.inputLanguage === "string" ? body.inputLanguage : "en-US";
      clientTurnId = typeof body.clientTurnId === "string" ? body.clientTurnId : "";
    }

    sessionId = sessionId.trim();
    if (!sessionId || sessionId.length > MAX_SESSION_ID_LENGTH || !/^s[a-z0-9]+$/i.test(sessionId)) {
      return NextResponse.json({ error: "invalid sessionId" }, { status: 400 });
    }
    if (userText.length > MAX_USER_TEXT_LENGTH) {
      return NextResponse.json({ error: "text too long" }, { status: 413 });
    }
    if (repeatTarget.length > MAX_REPEAT_TARGET_LENGTH) {
      return NextResponse.json({ error: "repeat target too long" }, { status: 413 });
    }
    if (!/^(?:en|ko)(?:-[A-Za-z]{2})?$|^auto$/i.test(inputLanguage)) {
      return NextResponse.json({ error: "invalid inputLanguage" }, { status: 400 });
    }
    if (clientTurnId && (
      clientTurnId.length > MAX_CLIENT_TURN_ID_LENGTH
      || !/^[A-Za-z0-9_-]+$/.test(clientTurnId)
    )) {
      return NextResponse.json({ error: "invalid clientTurnId" }, { status: 400 });
    }
    durationSec = Number.isFinite(durationSec) ? Math.min(600, Math.max(0, durationSec)) : 0;

    const initialSession = getSession(sessionId);
    if (!initialSession) return NextResponse.json({ error: "session not found" }, { status: 404 });
    if (initialSession.endedAt) return NextResponse.json({ error: "session already ended" }, { status: 409 });
    if (initialSession.pausedAt) return NextResponse.json({ error: "session is paused; resume it before sending a turn" }, { status: 409 });

    turnController = new AbortController();
    if (req.signal.aborted) abortFromRequest();
    else req.signal.addEventListener("abort", abortFromRequest, { once: true });
    registerActiveSessionTurn(sessionId, turnController);

    // 1) STT — client transcript는 즉시 화면에 보여주는 preview로 쓰고,
    // 서버 STT가 연결돼 있으면 녹음을 다시 인식한 결과를 최종 문장으로 우선한다.
    const clientTranscript = normalizeSTTText(userText);
    const authoritativeTextUsed = textAuthoritative && !!clientTranscript;
    if (audioBuf && !authoritativeTextUsed) {
      try {
        const stt = await transcribe(audioBuf, mime, {
          feature: "turn",
          durationSec,
          language: inputLanguage,
          prompt: inputLanguage.toLowerCase().startsWith("ko")
            ? "English conversation practice. The learner may ask for help in Korean. Transcribe exactly what they say, preserving Korean and any mixed English."
            : undefined,
          signal: turnController.signal,
        });
        userText = selectTurnTranscript(clientTranscript, stt.text);
        sttUnavailable = stt.source === "unavailable" && !clientTranscript;
      } catch (error) {
        if (!clientTranscript) throw error;
        console.warn("[api/turn] server STT failed; using client transcript preview");
        userText = clientTranscript;
      }
    } else {
      userText = selectTurnTranscript(clientTranscript, "", authoritativeTextUsed);
    }
    if (!userText.trim()) {
      return NextResponse.json({
        empty: true,
        code: sttUnavailable ? "stt_unavailable" : "speech_not_recognized",
        message: sttUnavailable
          ? "브라우저 음성 인식이 지원되지 않습니다. OpenAI 음성 인식 키를 연결하거나 지원 브라우저를 사용해 주세요."
          : "말이 잘 들리지 않았어요. 잠시 쉬었다가 다시 말해볼까요?",
      });
    }
    if (userText.length > MAX_USER_TEXT_LENGTH) {
      return NextResponse.json({ error: "transcript too long" }, { status: 413 });
    }

    // 2) 따라 말하기 판정 (발음 평가 → 폴백: 유사도)
    let judgment: Judgment | undefined;
    if (!authoritativeTextUsed && repeatTarget && isLikelyRepeatAttempt(repeatTarget, userText)) {
      judgment = await assessPronunciation(repeatTarget, userText, audioBuf, mime);
    }

    // 3) 두뇌 (LLM 파이프라인). 종료 요청과 같은 세션을 직렬화하고,
    // lock 안에서 endedAt을 다시 확인해 종료 뒤 stale save를 막는다.
    const completed = await withSessionLock(sessionId, async () => {
      const session = getSession(sessionId);
      if (!session) throw new Error("session not found");
      if (session.endedAt) throw new Error("session already ended");
      if (session.pausedAt) throw new Error("session is paused");
      if (turnController?.signal.aborted) throw new Error("turn cancelled");
      const result = await runTurn({
        session,
        userText,
        clientTurnId: clientTurnId || undefined,
        judgment,
        signal: turnController?.signal,
      });
      if (turnController?.signal.aborted) throw new Error("turn cancelled");
      session.pendingTurn = undefined;
      session.lastActiveAt = Date.now();
      saveSession(session);
      return { session, result };
    });
    const { session, result } = completed;

    // 텍스트 응답을 먼저 반환한다. 클라이언트가 /api/tts를 별도로 요청해
    // 느린 음성 provider가 자막/피드백 전체를 가로막지 않게 한다.
    const user = getUser();
    const expressionCard = result.new_expression ? findExpression(result.new_expression)?.expr ?? null : null;

    return NextResponse.json({
      userText,
      result: { ...result, audio: null },
      expressionCard,
      stageState: session.stageState ?? null,
      xp: { total: user.xp, ...xpLevel(user.xp), earned: session.xpEarned },
      combo: session.stageState?.combo ?? 0,
    });
  } catch (e) {
    if (e instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    console.error("[api/turn]", e);
    const message = e instanceof Error ? e.message : "turn request failed";
    const cancelled = turnController?.signal.aborted || /session already ended|session is paused|turn cancelled/i.test(message);
    return NextResponse.json(
      { error: cancelled ? "turn cancelled" : message === "session not found" ? message : "turn request failed" },
      { status: cancelled ? 409 : message === "session not found" ? 404 : 500 },
    );
  } finally {
    req.signal.removeEventListener("abort", abortFromRequest);
    if (turnController) clearActiveSessionTurn(sessionId, turnController);
  }
}
