"use client";

// 통화 화면 — 상황을 먼저 이해하고, 한 화면 안에서 듣기·말하기·피드백까지 이어지는 라이브 레슨.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import AvatarView from "@/components/AvatarView";
import PushToTalkButton from "@/components/PushToTalkButton";
import SceneBackdrop from "@/components/SceneBackdrop";
import CelebrationLayer from "@/components/CelebrationLayer";
import TranscriptSheet, { type ClientTurn } from "@/components/TranscriptSheet";
import HintSheet from "@/components/HintSheet";
import { ExpressionCardView, SuggestionCardView, CorrectionCardView } from "@/components/Cards";
import { useAudioPlayer, type PlayableAudio } from "@/hooks/useAudioPlayer";
import type { RecorderError, RecorderPhase, RecorderResult } from "@/hooks/useRecorder";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { sfxRingtone, sfxHangup, sfxSuccess, sfxCombo, sfxLevelUp, sfxRetry, sfxPop } from "@/lib/sfx";
import { withRequestTimeout } from "@/lib/requestTimeout";
import type { CorrectionCard, SuggestionCard, Expression, StageState, Judgment } from "@/core/types";

interface TutorInfo {
  id: string;
  name: string;
  koName: string;
  emoji: string;
  color: string;
  profileImage: string;
}

interface Scenario {
  id: string;
  title: string;
  titleKo: string;
  image: string;
  ambience?: string;
  tutorRole: string;
  learnerRole: string;
  descriptionKo: string;
  goalKo: string;
  keyExpressions?: { en: string; ko: string }[];
}

interface UnitBrief {
  id: string;
  title: string;
  titleKo: string;
  topic: string;
  expressions?: { id: string; en: string; ko: string }[];
  situation: {
    setting: string;
    tutorRole: string;
    learnerRole: string;
    goalKo: string;
  };
}

interface TutorReplyPayload {
  reply: string;
  reply_ko: string;
  audio: PlayableAudio | null;
  correction: CorrectionCard | null;
  suggestion: SuggestionCard | null;
  end_call: boolean;
  expressionCard?: Expression | null;
}

interface SessionStartResponse {
  resumed?: boolean;
  sessionId: string;
  stageState: StageState | null;
  greeting: TutorReplyPayload | null;
  expressionCard: Expression | null;
  turns?: Array<{
    id: string;
    role: "user" | "tutor";
    text: string;
    clientTurnId?: string;
    ko?: string;
    ts?: number;
    correction?: CorrectionCard | null;
    suggestion?: SuggestionCard | null;
    judgment?: Judgment;
  }>;
  elapsedSeconds?: number;
  resumeCount?: number;
  lifecycleVersion?: number;
  xpEarned?: number;
  pendingTurn?: PendingTurnDraft | null;
  lastTutorTurn?: {
    text: string;
    ko?: string;
    correction?: CorrectionCard | null;
    suggestion?: SuggestionCard | null;
    judgment?: Judgment;
  } | null;
  error?: string;
}

interface BriefingContent {
  eyebrow: string;
  title: string;
  titleEn?: string;
  description: string;
  tutorRole: string;
  learnerRole: string;
  goal?: string;
  /** 시작 전에 미리 듣고 들어갈 수 있는 표현 3개 */
  expressions?: { en: string; ko: string }[];
}

interface TextFallbackState {
  recording: RecorderResult;
  value: string;
  reason: "unheard" | "microphone" | "direct" | "recovered";
  detail?: string;
}

const STAGE_LABELS: Record<string, string> = {
  review: "복습",
  intro: "새 표현",
  practice: "따라 말하기",
  roleplay: "상황 연습",
  done: "완료",
};
const STAGE_ORDER = ["review", "intro", "practice", "roleplay", "done"];

interface PendingTurnDraft {
  text: string;
  inputLanguage: "en-US" | "ko-KR";
  clientTurnId?: string;
  repeatTarget?: string;
  savedAt: number;
}

function pendingTurnKey(sessionId: string) {
  return `avatar-tutor:pending-turn:${sessionId}`;
}

function createClientTurnId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function readPendingTurn(sessionId: string): PendingTurnDraft | null {
  try {
    const raw = window.localStorage.getItem(pendingTurnKey(sessionId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingTurnDraft>;
    if (typeof value.text !== "string" || !value.text.trim()) return null;
    return {
      text: value.text.trim(),
      inputLanguage: value.inputLanguage === "ko-KR" ? "ko-KR" : "en-US",
      clientTurnId: typeof value.clientTurnId === "string" ? value.clientTurnId : undefined,
      repeatTarget: typeof value.repeatTarget === "string" ? value.repeatTarget : undefined,
      savedAt: typeof value.savedAt === "number" ? value.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

function countCoachedLearnerTurns(turns: NonNullable<SessionStartResponse["turns"]>): number {
  const coached = new Set<string>();
  let lastLearnerId = "";
  for (const turn of turns) {
    if (turn.role === "user") {
      lastLearnerId = turn.id;
      if (turn.judgment) coached.add(turn.id);
    } else if (lastLearnerId && (turn.correction || turn.suggestion)) {
      coached.add(lastLearnerId);
    }
  }
  return coached.size;
}

export default function CallPage() {
  const { tutorId } = useParams<{ tutorId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const requestedMode = search.get("mode") ?? "freetalk";
  const mode: "freetalk" | "learning" = requestedMode === "learning" ? "learning" : "freetalk";
  const scenarioId = search.get("scenario");
  const unitId = search.get("unit");
  const requestedResumeId = search.get("resume");
  const queryError = requestedMode !== "freetalk" && requestedMode !== "learning"
    ? "지원하지 않는 대화 방식이에요."
    : scenarioId && unitId
      ? "상황 연습과 표현 학습을 동시에 시작할 수 없어요."
      : mode === "learning" && !unitId
        ? "학습할 표현 단원을 찾을 수 없어요."
        : unitId && mode !== "learning"
          ? "표현 학습 링크가 올바르지 않아요."
          : "";

  const [tutor, setTutor] = useState<TutorInfo | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [unitBrief, setUnitBrief] = useState<UnitBrief | null>(null);
  const [avatarLayer, setAvatarLayer] = useState("auto");
  const [subtitleMode, setSubtitleMode] = useState<"always" | "tap" | "off">("always");
  const [phase, setPhase] = useState<"ringing" | "briefing" | "live" | "ending">("ringing");
  const [sessionId, setSessionId] = useState("");
  const [pendingGreeting, setPendingGreeting] = useState<TutorReplyPayload | null>(null);
  const [stageState, setStageState] = useState<StageState | null>(null);
  const [busy, setBusy] = useState(false);
  const [responseStep, setResponseStep] = useState<"transcribing" | "thinking">("transcribing");
  const [isRecording, setIsRecording] = useState(false);
  const [recorderPhase, setRecorderPhase] = useState<RecorderPhase>("idle");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [turns, setTurns] = useState<ClientTurn[]>([]);
  const [subtitle, setSubtitle] = useState<{ en: string; ko: string } | null>(null);
  const [showKo, setShowKo] = useState(false);
  const [tapRevealed, setTapRevealed] = useState(false);
  const [expressionCard, setExpressionCard] = useState<Expression | null>(null);
  const [suggestionCard, setSuggestionCard] = useState<SuggestionCard | null>(null);
  const [correctionCard, setCorrectionCard] = useState<CorrectionCard | null>(null);
  const [judgmentResult, setJudgmentResult] = useState<Judgment | null>(null);
  const [confetti, setConfetti] = useState(0);
  const [combo, setCombo] = useState(0);
  const [coachingCount, setCoachingCount] = useState(0);
  const [xpGain, setXpGain] = useState<number | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [activeTool, setActiveTool] = useState<"repeat" | "slow" | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [failedRecording, setFailedRecording] = useState<RecorderResult | null>(null);
  const [textFallback, setTextFallback] = useState<TextFallbackState | null>(null);
  const [inputLanguage, setInputLanguage] = useState<"en-US" | "ko-KR">("en-US");
  const [elapsedBaseSeconds, setElapsedBaseSeconds] = useState(0);
  const [showExitOptions, setShowExitOptions] = useState(false);

  const {
    play: playTutorAudio,
    playTTS: playTutorTTS,
    replayLast: replayTutorAudio,
    stop: stopTutorAudio,
    speaking: tutorSpeaking,
  } = useAudioPlayer(tutorId);
  const repeatTargetRef = useRef("");
  const prevXpRef = useRef(0);
  const startTsRef = useRef(0);
  const elapsedActiveMsRef = useRef(0);
  const elapsedBaseRef = useRef(0);
  const sessionIdRef = useRef("");
  const userTurnCountRef = useRef(0);
  const busyRef = useRef(false);
  const exitAfterTurnRef = useRef(false);
  const pendingDraftRef = useRef<PendingTurnDraft | null>(null);
  const activeClientTurnIdRef = useRef("");
  const lifecycleVersionRef = useRef(0);
  const endingRef = useRef(false);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const turnAbortRef = useRef<AbortController | null>(null);
  const startRequestRef = useRef<{
    key: string;
    request: Promise<SessionStartResponse>;
    controller: AbortController;
    resolvedSessionId: string;
    resolvedWasResume: boolean;
    resolvedElapsedSeconds: number;
  } | null>(null);
  const mountedRef = useRef(false);
  const ringingCancelledRef = useRef(false);
  const phaseRef = useRef(phase);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const nextLifecycleVersion = useCallback(() => {
    const next = Math.max(Date.now(), lifecycleVersionRef.current + 1);
    lifecycleVersionRef.current = next;
    return next;
  }, []);

  const persistPendingText = useCallback((rawText: string) => {
    const activeSessionId = sessionId || sessionIdRef.current;
    if (!activeSessionId) return;
    const text = rawText.trim();
    if (!text) {
      pendingDraftRef.current = null;
      try {
        window.localStorage.removeItem(pendingTurnKey(activeSessionId));
      } catch {}
      return;
    }
    const pendingDraft: PendingTurnDraft = {
      text,
      inputLanguage,
      clientTurnId: activeClientTurnIdRef.current
        || pendingDraftRef.current?.clientTurnId
        || createClientTurnId(),
      repeatTarget: repeatTargetRef.current || pendingDraftRef.current?.repeatTarget || undefined,
      savedAt: Math.max(Date.now(), (pendingDraftRef.current?.savedAt ?? 0) + 1),
    };
    activeClientTurnIdRef.current = pendingDraft.clientTurnId ?? "";
    pendingDraftRef.current = pendingDraft;
    try {
      window.localStorage.setItem(pendingTurnKey(activeSessionId), JSON.stringify(pendingDraft));
    } catch {}
  }, [inputLanguage, sessionId]);

  const discardPendingStart = useCallback(() => {
    const pending = startRequestRef.current;
    if (!pending) return;
    startRequestRef.current = null;
    ringingCancelledRef.current = true;
    pending.controller.abort();
    // A new greeting can be discarded, but an existing session that the start
    // request already resumed must be parked again instead of being left live.
    const release = (sessionId: string, resumed: boolean, elapsedSeconds = 0) => {
      const body = JSON.stringify(resumed
        ? { action: "pause", sessionId, elapsedSeconds, lifecycleVersion: nextLifecycleVersion() }
        : { action: "discard", sessionId });
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        const queued = navigator.sendBeacon(
          "/api/session",
          new Blob([body], { type: "application/json" }),
        );
        if (queued) return Promise.resolve();
      }
      return fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).then(() => undefined);
    };
    if (pending.resolvedSessionId) {
      void release(
        pending.resolvedSessionId,
        pending.resolvedWasResume,
        pending.resolvedElapsedSeconds,
      ).catch(() => {});
    } else {
      void pending.request
        .then((data) => release(data.sessionId, Boolean(data.resumed), data.elapsedSeconds ?? 0))
        .catch(() => {});
    }
  }, [nextLifecycleVersion]);

  const cancelRinging = useCallback(() => {
    discardPendingStart();
    router.back();
  }, [discardPendingStart, router]);

  useEffect(() => {
    mountedRef.current = true;

    const freezeElapsedClock = () => {
      if (startTsRef.current > 0) {
        elapsedActiveMsRef.current += Math.max(0, Date.now() - startTsRef.current);
        startTsRef.current = 0;
      }
      const seconds = Math.max(0, Math.round(elapsedActiveMsRef.current / 1000));
      elapsedBaseRef.current = seconds;
      return seconds;
    };

    const sendLifecycle = (action: "pause" | "checkpoint" | "discard") => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId) return;
      const body = JSON.stringify(action === "discard"
        ? { action, sessionId: activeSessionId }
        : {
            action,
            sessionId: activeSessionId,
            elapsedSeconds: freezeElapsedClock(),
            pendingTurn: pendingDraftRef.current,
            lifecycleVersion: nextLifecycleVersion(),
          });
      const blob = new Blob([body], { type: "application/json" });
      const queued = navigator.sendBeacon?.("/api/session", blob) ?? false;
      if (!queued) {
        void fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    };

    const parkForLeave = (event?: Event) => {
      if (endingRef.current) return;
      const enteringBackForwardCache = event instanceof PageTransitionEvent && event.persisted;
      if (phaseRef.current === "ringing") {
        discardPendingStart();
        return;
      }
      if ((phaseRef.current === "live" || phaseRef.current === "briefing") && sessionIdRef.current) {
        turnAbortRef.current?.abort();
        if (enteringBackForwardCache) sendLifecycle("checkpoint");
        else sendLifecycle(userTurnCountRef.current > 0 || pendingDraftRef.current ? "pause" : "discard");
      }
    };

    const handleVisibilityChange = () => {
      if (phaseRef.current !== "live" || endingRef.current) return;
      if (document.visibilityState === "hidden") {
        freezeElapsedClock();
        if (userTurnCountRef.current > 0 || pendingDraftRef.current) sendLifecycle("checkpoint");
      } else if (startTsRef.current === 0) {
        startTsRef.current = Date.now();
      }
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted || phaseRef.current !== "live" || !sessionIdRef.current || endingRef.current) return;
      const resume = () => fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resume",
          sessionId: sessionIdRef.current,
          lifecycleVersion: nextLifecycleVersion(),
        }),
      }).then((response) => {
        if (!response.ok) throw new Error("resume failed");
        setErrorMsg("");
        if (startTsRef.current === 0) startTsRef.current = Date.now();
      });
      void resume().catch(() => setErrorMsg("연습 연결을 복구하지 못했어요. 홈에서 다시 이어 주세요."));
    };

    window.addEventListener("pagehide", parkForLeave);
    window.addEventListener("beforeunload", parkForLeave);
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", parkForLeave);
      window.removeEventListener("beforeunload", parkForLeave);
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      mountedRef.current = false;
      // React Strict Mode briefly mounts twice in development. Deferring one
      // tick avoids cancelling that probe while still covering real back nav.
      window.setTimeout(() => {
        if (!mountedRef.current) parkForLeave();
      }, 0);
    };
  }, [discardPendingStart, nextLifecycleVersion]);

  useEffect(() => {
    fetch("/api/state")
      .then((r) => r.json())
      .then((data) => {
        const nextTutor = data.tutors.find((x: TutorInfo) => x.id === tutorId);
        if (!nextTutor) {
          setErrorMsg("존재하지 않는 튜터예요.");
          return;
        }
        setTutor(nextTutor);
        if (scenarioId) {
          const nextScenario = data.scenarios.find((x: Scenario) => x.id === scenarioId);
          if (!nextScenario) {
            setErrorMsg("요청한 상황 연습을 찾을 수 없어요.");
            return;
          }
          setScenario(nextScenario);
        }
        setAvatarLayer(String(data.avatarLayer ?? "auto"));
        setSubtitleMode(data.user.settings?.subtitles ?? "always");
      })
      .catch(() => setErrorMsg("튜터 정보를 불러오지 못했어요."));
  }, [tutorId, scenarioId]);

  useEffect(() => {
    if (!unitId) return;
    fetch(`/api/unit?id=${encodeURIComponent(unitId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("unit not found");
        return response.json();
      })
      .then((data) => {
        if (!data.unit) throw new Error("unit not found");
        setUnitBrief(data.unit as UnitBrief);
      })
      .catch(() => setErrorMsg("요청한 표현 학습을 찾을 수 없어요."));
  }, [unitId]);

  const briefing = useMemo<BriefingContent | null>(() => {
    if (scenario) {
      return {
        eyebrow: "오늘의 상황극",
        title: scenario.titleKo,
        titleEn: scenario.title,
        description: scenario.descriptionKo,
        tutorRole: scenario.tutorRole,
        learnerRole: scenario.learnerRole,
        goal: scenario.goalKo,
        expressions: (scenario.keyExpressions ?? []).slice(0, 3),
      };
    }
    if (unitBrief) {
      return {
        eyebrow: "오늘의 역할 연습",
        title: unitBrief.titleKo,
        titleEn: unitBrief.title,
        description: unitBrief.situation.setting,
        tutorRole: unitBrief.situation.tutorRole,
        learnerRole: unitBrief.situation.learnerRole,
        goal: unitBrief.situation.goalKo,
        expressions: (unitBrief.expressions ?? []).slice(0, 3).map((expression) => ({
          en: expression.en,
          ko: expression.ko,
        })),
      };
    }
    return null;
  }, [scenario, unitBrief]);

  const totalElapsedSeconds = useCallback(() => {
    const activeSegmentMs = startTsRef.current > 0 ? Math.max(0, Date.now() - startTsRef.current) : 0;
    return Math.max(0, Math.round((elapsedActiveMsRef.current + activeSegmentMs) / 1000));
  }, []);

  const pauseCall = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    setShowExitOptions(false);
    turnAbortRef.current?.abort();
    setPhase("ending");
    stopTutorAudio();
    const activeSessionId = sessionIdRef.current;
    const previousPhase = phaseRef.current;
    if (activeSessionId) {
      const action = userTurnCountRef.current > 0 || pendingDraftRef.current ? "pause" : "discard";
      const payload = action === "pause"
        ? {
            action,
            sessionId: activeSessionId,
            elapsedSeconds: totalElapsedSeconds(),
            pendingTurn: pendingDraftRef.current,
            lifecycleVersion: nextLifecycleVersion(),
          }
        : { action, sessionId: activeSessionId };
      try {
        const response = await withRequestTimeout(
          (signal) => fetch("/api/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal,
            keepalive: true,
          }),
          3_000,
        );
        if (!response.ok) throw new Error("pause failed");
      } catch {
        endingRef.current = false;
        setPhase(previousPhase === "briefing" ? "briefing" : "live");
        setErrorMsg("저장하지 못했어요. 연결을 확인한 뒤 다시 눌러 주세요.");
        return;
      }
    }
    router.replace("/");
  }, [nextLifecycleVersion, router, stopTutorAudio, totalElapsedSeconds]);

  const endCall = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    setShowExitOptions(false);
    turnAbortRef.current?.abort();
    setPhase("ending");
    stopTutorAudio();
    sfxHangup();
    const callSeconds = totalElapsedSeconds();
    if (sessionId) {
      try {
        const response = await withRequestTimeout(
          (signal) => fetch("/api/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "end", sessionId, callSeconds }),
            signal,
          }),
          4_000,
        );
        if (!response.ok) throw new Error("end failed");
      } catch {
        endingRef.current = false;
        setPhase("live");
        setErrorMsg("연습을 종료하지 못했어요. 연결을 확인한 뒤 다시 눌러 주세요.");
        return;
      }
    }
    if (sessionId) router.replace(`/report/${sessionId}`);
    else router.back();
  }, [stopTutorAudio, router, sessionId, totalElapsedSeconds]);

  const requestExit = useCallback(() => {
    if (busyRef.current) {
      exitAfterTurnRef.current = true;
      setBanner("이번 답변까지 저장한 뒤 멈출게요");
      return;
    }
    const completedLearning = mode === "learning" && stageState?.stage === "done";
    if (!completedLearning && (userTurnCountRef.current > 0 || pendingDraftRef.current)) {
      stopTutorAudio();
      setShowExitOptions(true);
      return;
    }
    void endCall();
  }, [endCall, mode, stageState?.stage, stopTutorAudio]);

  const handleTutorReply = useCallback(
    (payload: TutorReplyPayload) => {
      setSubtitle({ en: payload.reply, ko: payload.reply_ko });
      setShowKo(false);
      setTapRevealed(false);
      if (payload.expressionCard) {
        setExpressionCard(payload.expressionCard);
        sfxPop();
      }
      if (payload.suggestion) {
        setSuggestionCard(payload.suggestion);
        repeatTargetRef.current = payload.suggestion.en;
        sfxPop();
      } else {
        setSuggestionCard(null);
        repeatTargetRef.current = "";
      }
      // 자유대화·상황극에서도 필요한 순간에는 교정 카드를 보여준다.
      // 서버의 레벨별 cadence가 과도한 끼어들기를 막는다.
      setCorrectionCard(payload.correction ?? null);
      setTurns((prev) => [
        ...prev,
        { id: `ct${Date.now()}`, role: "tutor", text: payload.reply, ko: payload.reply_ko, audio: payload.audio },
      ]);
      const onEnd = payload.end_call ? endCall : undefined;
      if (payload.audio) playTutorAudio(payload.audio, payload.reply, { onEnd });
      else void playTutorTTS(payload.reply, { onEnd });
    },
    [playTutorAudio, playTutorTTS, endCall],
  );

  useEffect(() => {
    if (!tutor || queryError || (scenarioId && !scenario) || (unitId && !unitBrief)) return;
    let cancelled = false;
    const stopRing = sfxRingtone();
    const minRing = new Promise((resolve) => setTimeout(resolve, 1800));
    const requestKey = `${tutorId}:${mode}:${scenarioId ?? ""}:${unitId ?? ""}:${requestedResumeId ?? ""}`;
    if (!startRequestRef.current || startRequestRef.current.key !== requestKey) {
      ringingCancelledRef.current = false;
      const controller = new AbortController();
      const pending = {
        key: requestKey,
        controller,
        resolvedSessionId: "",
        resolvedWasResume: false,
        resolvedElapsedSeconds: 0,
        request: Promise.resolve(null as unknown as SessionStartResponse),
      };
      pending.request = fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          tutorId,
          mode,
          scenarioId: scenarioId ?? undefined,
          unitId: unitId ?? undefined,
          resumeSessionId: requestedResumeId ?? undefined,
          resumeExisting: !requestedResumeId && Boolean(scenarioId || unitId),
        }),
        signal: controller.signal,
      }).then(async (response) => {
        const data = (await response.json()) as SessionStartResponse;
        if (!response.ok) throw new Error(data.error || "session start failed");
        pending.resolvedSessionId = data.sessionId;
        pending.resolvedWasResume = Boolean(data.resumed);
        pending.resolvedElapsedSeconds = Math.max(0, Math.round(data.elapsedSeconds ?? 0));
        return data;
      });
      startRequestRef.current = pending;
    }
    const startReq = startRequestRef.current.request;

    Promise.all([startReq, minRing])
      .then(([data]) => {
        if (cancelled || ringingCancelledRef.current) return;
        startRequestRef.current = null;
        stopRing();
        setSessionId(data.sessionId);
        sessionIdRef.current = data.sessionId;
        lifecycleVersionRef.current = Math.max(
          lifecycleVersionRef.current,
          Math.round(data.lifecycleVersion ?? 0),
        );
        setStageState(data.stageState);
        if (data.resumed) {
          const restoredTurns: ClientTurn[] = (data.turns ?? []).map((turn) => ({
            id: turn.id,
            role: turn.role,
            text: turn.text,
            ko: turn.ko,
          }));
          const restoredUserTurns = (data.turns ?? []).filter((turn) => turn.role === "user");
          userTurnCountRef.current = restoredUserTurns.length;
          setTurns(restoredTurns);
          setCoachingCount(countCoachedLearnerTurns(data.turns ?? []));
          const restoredElapsed = Math.max(0, Math.round(data.elapsedSeconds ?? 0));
          elapsedActiveMsRef.current = restoredElapsed * 1000;
          elapsedBaseRef.current = restoredElapsed;
          setElapsedBaseSeconds(restoredElapsed);
          setExpressionCard(data.expressionCard ?? null);
          const lastTutor = data.lastTutorTurn;
          if (lastTutor) {
            setSubtitle({ en: lastTutor.text, ko: lastTutor.ko ?? "" });
            setSuggestionCard(lastTutor.suggestion ?? null);
            setCorrectionCard(lastTutor.correction ?? null);
            repeatTargetRef.current = lastTutor.suggestion?.en ?? "";
          }
          prevXpRef.current = Math.max(0, Math.round(data.xpEarned ?? 0));
          const localDraft = readPendingTurn(data.sessionId);
          const pendingDraft = [data.pendingTurn ?? null, localDraft]
            .filter((draft): draft is PendingTurnDraft => Boolean(draft?.text))
            .sort((a, b) => a.savedAt - b.savedAt)
            .at(-1) ?? null;
          const latestSavedLearnerAt = restoredUserTurns.reduce(
            (latest, turn) => Math.max(latest, typeof turn.ts === "number" ? turn.ts : 0),
            0,
          );
          const draftAlreadySaved = Boolean(pendingDraft && (
            (pendingDraft.clientTurnId
              && restoredUserTurns.some((turn) => turn.clientTurnId === pendingDraft.clientTurnId))
            || (!pendingDraft.clientTurnId && latestSavedLearnerAt >= pendingDraft.savedAt)
          ));
          if (draftAlreadySaved) {
            pendingDraftRef.current = null;
            activeClientTurnIdRef.current = "";
            window.localStorage.removeItem(pendingTurnKey(data.sessionId));
            void fetch("/api/session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "checkpoint",
                sessionId: data.sessionId,
                elapsedSeconds: restoredElapsed,
                pendingTurn: null,
                lifecycleVersion: nextLifecycleVersion(),
              }),
            }).catch(() => {});
          } else if (pendingDraft) {
            pendingDraftRef.current = pendingDraft;
            activeClientTurnIdRef.current = pendingDraft.clientTurnId ?? createClientTurnId();
            if (!pendingDraft.clientTurnId) pendingDraft.clientTurnId = activeClientTurnIdRef.current;
            setInputLanguage(pendingDraft.inputLanguage);
            repeatTargetRef.current = pendingDraft.repeatTarget ?? repeatTargetRef.current;
            setTextFallback({
              recording: {
                blob: new Blob([], { type: "audio/webm" }),
                durationSec: 0,
                mimeType: "audio/webm",
                speechDetected: true,
                transcript: pendingDraft.text,
              },
              value: pendingDraft.text,
              reason: "recovered",
            });
          } else {
            activeClientTurnIdRef.current = "";
            const latestUserText = restoredUserTurns.at(-1)?.text ?? "";
            const koreanCount = latestUserText.match(/[가-힣]/g)?.length ?? 0;
            const latinCount = latestUserText.match(/[A-Za-z]/g)?.length ?? 0;
            if (koreanCount > latinCount) setInputLanguage("ko-KR");
          }
          setPhase("live");
          startTsRef.current = Date.now();
          setBanner(pendingDraft && !draftAlreadySaved ? "중단 직전 문장을 복구했어요" : "멈춘 곳부터 이어갈게요");
          return;
        }
        elapsedBaseRef.current = 0;
        elapsedActiveMsRef.current = 0;
        setElapsedBaseSeconds(0);
        userTurnCountRef.current = 0;
        if (!data.greeting) throw new Error("greeting unavailable");
        const greeting = { ...data.greeting, expressionCard: data.expressionCard } as TutorReplyPayload;
        if (scenarioId || unitId) {
          setPendingGreeting(greeting);
          setPhase("briefing");
        } else {
          setPhase("live");
          startTsRef.current = Date.now();
          handleTutorReply(greeting);
        }
      })
      .catch(() => {
        if (!cancelled && !ringingCancelledRef.current) {
          stopRing();
          setErrorMsg("연결에 실패했어요. 네트워크를 확인해 주세요.");
        }
      });
    return () => {
      cancelled = true;
      stopRing();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutor, scenario, unitBrief]);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setTimeout(() => setResponseStep("thinking"), 1100);
    return () => window.clearTimeout(timer);
  }, [busy]);

  useEffect(() => {
    if (tutorSpeaking || !activeTool) return;
    const timer = window.setTimeout(() => setActiveTool(null), 0);
    return () => window.clearTimeout(timer);
  }, [tutorSpeaking, activeTool]);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation) return;
    conversation.scrollTop = conversation.scrollHeight;
  }, [liveTranscript, subtitle, turns.length]);

  const openDirectInput = useCallback((recorderError: RecorderError) => {
    activeClientTurnIdRef.current = createClientTurnId();
    setFailedRecording(null);
    setTextFallback({
      recording: {
        blob: new Blob([], { type: "audio/webm" }),
        durationSec: 0,
        mimeType: "audio/webm",
        speechDetected: true,
      },
      value: "",
      reason: "microphone",
      detail: recorderError.message,
    });
    setLiveTranscript("");
    setErrorMsg("");
  }, []);

  /** 말풍선을 탭해 방금 한 말을 고쳐 다시 보낸다 (STT 오인식 복구). */
  const editLastUtterance = useCallback((text: string) => {
    activeClientTurnIdRef.current = createClientTurnId();
    setFailedRecording(null);
    setTextFallback({
      recording: {
        blob: new Blob([], { type: "audio/webm" }),
        durationSec: 0,
        mimeType: "audio/webm",
        speechDetected: true,
      },
      value: text,
      reason: "direct",
    });
    setErrorMsg("");
  }, []);

  const openKeyboardInput = useCallback(() => {
    activeClientTurnIdRef.current = createClientTurnId();
    setFailedRecording(null);
    setTextFallback({
      recording: {
        blob: new Blob([], { type: "audio/webm" }),
        durationSec: 0,
        mimeType: "audio/webm",
        speechDetected: true,
      },
      value: "",
      reason: "direct",
    });
    setErrorMsg("");
  }, []);

  const sendRecording = useCallback(
    async (recording: RecorderResult, options: { authoritativeText?: boolean } = {}) => {
      if (!sessionId || busy) return;
      if (!recording.transcript?.trim() && !recording.speechDetected) {
        setFailedRecording(recording);
        setTextFallback({ recording, value: "", reason: "unheard" });
        setErrorMsg("");
        return;
      }
      busyRef.current = true;
      setBusy(true);
      setResponseStep("transcribing");
      setTextFallback(null);
      setLiveTranscript(recording.transcript?.trim() ?? "");
      setErrorMsg("");
      setJudgmentResult(null);
      turnAbortRef.current?.abort();
      const controller = new AbortController();
      turnAbortRef.current = controller;
      const form = new FormData();
      form.append("sessionId", sessionId);
      const clientTurnId = activeClientTurnIdRef.current
        || pendingDraftRef.current?.clientTurnId
        || createClientTurnId();
      activeClientTurnIdRef.current = clientTurnId;
      form.append("clientTurnId", clientTurnId);
      if (recording.blob.size > 0) {
        const extension = recording.mimeType.includes("mp4") ? "mp4" : recording.mimeType.includes("ogg") ? "ogg" : "webm";
        form.append("audio", recording.blob, `speech.${extension}`);
      }
      form.append("durationSec", String(recording.durationSec));
      form.append("inputLanguage", inputLanguage);
      if (recording.transcript?.trim()) form.append("text", recording.transcript.trim());
      if (options.authoritativeText) form.append("textAuthoritative", "true");
      // 제안은 강제 모드가 아니다. 한 번의 발화에만 후보 목표를 보내고 즉시
      // 소비한다. 서버가 최종 STT와 유사한 경우에만 실제 발음평가를 수행한다.
      const repeatTarget = repeatTargetRef.current;
      repeatTargetRef.current = "";
      if (repeatTarget && !options.authoritativeText) form.append("repeatTarget", repeatTarget);
      const draftText = recording.transcript?.trim() ?? "";
      if (draftText) {
        const pendingDraft: PendingTurnDraft = {
          text: draftText,
          inputLanguage,
          clientTurnId,
          repeatTarget: repeatTarget || undefined,
          savedAt: Math.max(Date.now(), (pendingDraftRef.current?.savedAt ?? 0) + 1),
        };
        pendingDraftRef.current = pendingDraft;
        try {
          window.localStorage.setItem(pendingTurnKey(sessionId), JSON.stringify(pendingDraft));
        } catch {}
      }

      try {
        const res = await fetch("/api/turn", { method: "POST", body: form, signal: controller.signal });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (data.empty) {
          if (!options.authoritativeText && repeatTarget && !repeatTargetRef.current) {
            repeatTargetRef.current = repeatTarget;
          }
          setFailedRecording(recording);
          setTextFallback({ recording, value: "", reason: "unheard" });
          setErrorMsg("");
          return;
        }
        try {
          window.localStorage.removeItem(pendingTurnKey(sessionId));
        } catch {}
        pendingDraftRef.current = null;
        activeClientTurnIdRef.current = "";
        if (endingRef.current) return;
        setFailedRecording(null);
        setLiveTranscript(data.userText);
        userTurnCountRef.current += 1;
        setTurns((prev) => [
          ...prev,
          {
            id: `cu${Date.now()}`,
            role: "user",
            text: data.userText,
            ...(recording.blob.size > 0 ? { userBlob: recording.blob } : {}),
          },
        ]);

        const result = data.result;
        if (result.judgment || result.correction || result.suggestion) {
          setCoachingCount((count) => count + 1);
        }
        if (result.judgment) {
          setJudgmentResult(result.judgment);
          if (result.judgment.pass) {
            setConfetti((value) => value + 1);
            sfxSuccess();
            if (data.combo >= 2) sfxCombo(data.combo);
          } else {
            sfxRetry();
          }
        }
        setCombo(data.combo ?? 0);

        const earned = data.xp?.earned ?? 0;
        const delta = earned - prevXpRef.current;
        prevXpRef.current = earned;
        if (delta > 0) setXpGain(delta);

        const events: string[] = result.events ?? [];
        if (events.includes("unit-clear")) {
          sfxLevelUp();
          setConfetti((value) => value + 1);
          setBanner("유닛을 완료했어요");
        } else if (events.includes("stage-advance") && data.stageState) {
          setBanner(`${STAGE_LABELS[data.stageState.stage] ?? "다음"} 단계로 이동해요`);
          sfxPop();
        }
        setStageState(data.stageState);
        if (data.stageState?.stage !== "intro") setExpressionCard(null);

        handleTutorReply({ ...result, expressionCard: data.expressionCard });
      } catch (error) {
        if (controller.signal.aborted || endingRef.current) return;
        console.error(error);
        if (repeatTarget && !repeatTargetRef.current) repeatTargetRef.current = repeatTarget;
        setErrorMsg("음성을 보내지 못했어요. 녹음은 보관해 두었어요.");
        setFailedRecording(recording);
      } finally {
        if (turnAbortRef.current === controller) turnAbortRef.current = null;
        busyRef.current = false;
        setBusy(false);
        if (exitAfterTurnRef.current && !controller.signal.aborted && !endingRef.current) {
          exitAfterTurnRef.current = false;
          window.setTimeout(requestExit, 0);
        }
      }
    },
    [sessionId, busy, handleTutorReply, inputLanguage, requestExit],
  );

  const startRoleplay = () => {
    setPhase("live");
    setShowContext(false);
    startTsRef.current = Date.now();
    if (pendingGreeting) {
      handleTutorReply(pendingGreeting);
      setPendingGreeting(null);
    }
  };

  const replay = (rate: 1 | 0.7) => {
    setActiveTool(rate === 1 ? "repeat" : "slow");
    replayTutorAudio(rate);
  };

  if ((queryError || errorMsg) && !sessionId) {
    return (
      <CallErrorScreen
        message={queryError || errorMsg}
        onBack={cancelRinging}
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (!tutor) {
    return (
      <div className="call-loading" role="status" aria-label="튜터 불러오는 중">
        <span className="call-spinner" />
      </div>
    );
  }

  if (phase === "ringing") {
    return <RingingScreen tutor={tutor} onCancel={cancelRinging} />;
  }

  if (phase === "briefing") {
    return (
      <BriefingScreen
        tutor={tutor}
        briefing={briefing}
        image={scenario?.image}
        loading={!briefing}
        onStart={startRoleplay}
        onCancel={pauseCall}
      />
    );
  }

  const showSubtitle = subtitleMode === "always" || (subtitleMode === "tap" && tapRevealed);
  const lastUserTurn = [...turns].reverse().find((turn) => turn.role === "user");
  const visibleUserText = liveTranscript || lastUserTurn?.text || "";
  const spokenCount = turns.filter((turn) => turn.role === "user").length;
  const status = phase === "ending"
    ? "통화 기록을 정리하고 있어요"
    : recorderPhase === "requesting"
      ? "마이크를 연결하고 있어요 · 놓으면 취소"
      : recorderPhase === "recording"
      ? "듣고 있어요 · 놓으면 전송"
      : recorderPhase === "finalizing"
        ? "말 인식 중 · 문장을 확인하고 있어요"
        : busy
          ? responseStep === "transcribing"
            ? "내 말을 글로 확인하고 있어요"
            : "상황에 맞는 답을 준비하고 있어요"
          : tutorSpeaking
            ? `${tutor.name}이 말하고 있어요 · 눌러서 끊고 말하기`
            : inputLanguage === "ko-KR"
              ? "한국어 도움 중 · 편하게 한국말로 말하세요"
              : "내 차례예요 · 버튼을 누르고 말하세요";

  const activeCoach = correctionCard
    ? { kind: "correction" as const, card: correctionCard }
    : suggestionCard
      ? { kind: "suggestion" as const, card: suggestionCard }
      : expressionCard
        ? { kind: "expression" as const, card: expressionCard }
        : null;
  const activeCoachIdentity = activeCoach
    ? `${activeCoach.kind}:${activeCoach.kind === "correction" ? activeCoach.card.better : activeCoach.card.en}`
    : "";

  return (
    <div className={`call-live-shell ${activeCoach ? "has-coach" : ""} ${textFallback ? "is-text-entry" : ""}`}>
      <SceneBackdrop image={scenario?.image} ambience={scenario?.ambience} />
      <CelebrationLayer trigger={confetti} combo={combo} xpGain={xpGain} bannerText={banner} />

      <header className="call-topbar">
        <div className="call-contact">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={tutor.profileImage} alt="" className="call-contact-avatar" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="call-contact-name">{tutor.name}</span>
              <span className="call-live-dot" aria-hidden="true" />
            </div>
            <span className="call-contact-detail">실시간 영어 코치</span>
          </div>
        </div>
        <div className="call-top-actions">
          <CallTimer
            key={`${sessionId}:${elapsedBaseSeconds}`}
            active={phase === "live"}
            initialSeconds={elapsedBaseSeconds}
            getSeconds={totalElapsedSeconds}
          />
          <button type="button" onClick={requestExit} className="call-close-button" aria-label="연습 나가기">
            <CloseIcon />
          </button>
        </div>
      </header>

      <main className="call-main">
        <div className="call-context-row">
          {briefing ? (
            <button
              type="button"
              className="call-context-pill"
              onClick={() => setShowContext(true)}
              aria-haspopup="dialog"
              aria-expanded={showContext}
            >
              <LocationIcon />
              <span className="truncate">{briefing.title} · 나는 {briefing.learnerRole}</span>
              <ChevronIcon />
            </button>
          ) : (
            <div className="call-context-pill call-context-pill-static">
              <SparkIcon />
              <span>{mode === "learning" ? "오늘의 표현을 익혀봐요" : "편하게 일상 대화를 나눠보세요"}</span>
            </div>
          )}
          {mode === "learning" && stageState && <StageProgress stage={stageState.stage} />}
        </div>

        <div className="call-session-glance" aria-label={`이번 연습에서 ${spokenCount}번 말했고 ${coachingCount}개의 코칭을 받았어요`}>
          <span><strong>{spokenCount}</strong> 말한 문장</span>
          <i aria-hidden="true" />
          <span><strong>{coachingCount}</strong> 코칭</span>
          <i aria-hidden="true" />
          <span>{mode === "learning" ? "표현 학습" : scenario ? "상황 연습" : "자유 대화"}</span>
        </div>

        <section className="call-avatar-area">
          <AvatarView tutor={tutor} speaking={tutorSpeaking} layer={avatarLayer} size={112} />

          <div
            ref={conversationRef}
            className="call-conversation"
            aria-live={isRecording ? "off" : "polite"}
            aria-atomic="false"
          >
            {(isRecording || busy || visibleUserText) && (
              <div
                className={`call-user-caption ${isRecording || busy ? "is-processing" : ""} ${!isRecording && !busy && visibleUserText ? "is-editable" : ""}`}
                role={!isRecording && !busy && visibleUserText ? "button" : undefined}
                tabIndex={!isRecording && !busy && visibleUserText ? 0 : undefined}
                aria-label={!isRecording && !busy && visibleUserText ? "내 문장 수정해서 다시 보내기" : undefined}
                onClick={() => {
                  if (isRecording || busy || !visibleUserText) return;
                  editLastUtterance(visibleUserText);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  if (isRecording || busy || !visibleUserText) return;
                  event.preventDefault();
                  editLastUtterance(visibleUserText);
                }}
              >
                <div className="call-caption-meta">
                  <span>나{inputLanguage === "ko-KR" ? " · 한국어 도움" : ""}</span>
                  {(isRecording || busy) && <ListeningDots />}
                </div>
                <p>
                  {isRecording
                    ? liveTranscript || (recorderPhase === "finalizing" ? "말한 문장을 확인하고 있어요…" : "말하는 내용을 듣고 있어요…")
                    : busy && !visibleUserText
                      ? responseStep === "transcribing"
                        ? "음성을 텍스트로 바꾸는 중…"
                        : "내 말의 의미를 확인하는 중…"
                      : visibleUserText}
                </p>
              </div>
            )}

            {subtitle && showSubtitle && (
              <div className="call-tutor-caption">
                <div className="call-caption-meta">
                  <span>{tutor.name}</span>
                  {tutorSpeaking && <span className="call-speaking-bars" aria-label="말하는 중"><i /><i /><i /></span>}
                </div>
                <p>{subtitle.en}</p>
                {showKo && subtitle.ko && <p className="call-translation">{subtitle.ko}</p>}
                {subtitle.ko && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setShowKo((value) => !value);
                    }}
                    className="call-translation-button"
                    aria-expanded={showKo}
                  >
                    {showKo ? "해석 닫기" : "한국어 해석"}
                  </button>
                )}
              </div>
            )}
          </div>

          {subtitleMode === "tap" && subtitle && (
            <button
              type="button"
              className="call-subtitle-toggle"
              onClick={() => setTapRevealed((value) => !value)}
              aria-pressed={tapRevealed}
            >
              {tapRevealed ? "영어 자막 숨기기" : "영어 자막 보기"}
            </button>
          )}

          {judgmentResult && (
            <div className={`call-score ${judgmentResult.pass ? "is-pass" : "is-retry"}`} role="status">
              <span>{judgmentResult.pass ? "좋아요" : "한 번 더"}</span>
              <strong>{judgmentResult.score}점</strong>
            </div>
          )}
        </section>

        {activeCoach && (
          <section
            key={activeCoachIdentity}
            className={`call-coach-panel is-${activeCoach.kind}`}
            aria-label="코칭 피드백"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="call-coach-grabber" aria-hidden="true" />
            {activeCoach.kind === "suggestion" && <SuggestionCardView card={activeCoach.card} tutorId={tutor.id} />}
            {activeCoach.kind === "correction" && <CorrectionCardView card={activeCoach.card} tutorId={tutor.id} />}
            {activeCoach.kind === "expression" && <ExpressionCardView expr={activeCoach.card} tutorId={tutor.id} />}
          </section>
        )}

        {textFallback ? (
          <form
            className="call-text-fallback"
            aria-labelledby="call-text-fallback-title"
            aria-describedby="call-text-fallback-description"
            onSubmit={(event) => {
              event.preventDefault();
              const text = textFallback.value.trim();
              if (!text) return;
              const recording = { ...textFallback.recording, transcript: text, speechDetected: true };
              setLiveTranscript(text);
              setTextFallback(null);
              void sendRecording(recording, { authoritativeText: true });
            }}
          >
            <div>
              <strong id="call-text-fallback-title">
                {textFallback.reason === "recovered"
                  ? "중단 직전 문장을 복구했어요"
                  : textFallback.reason === "direct"
                  ? "키보드로 말하기"
                  : textFallback.reason === "microphone"
                    ? "직접 입력으로 계속할게요"
                    : "말을 정확히 듣지 못했어요"}
              </strong>
              <span id="call-text-fallback-description">
                {textFallback.reason === "recovered"
                  ? "내용을 확인하고 보내면 멈췄던 대화가 그대로 이어집니다."
                  : textFallback.reason === "direct"
                  ? "영어나 한국어로 입력하면 대화에 맞춰 도와드려요."
                  : textFallback.reason === "microphone"
                  ? textFallback.detail
                  : "다시 말하거나, 아래에 직접 입력할 수 있어요."}
              </span>
            </div>
            <div className="call-text-fallback-row">
              <textarea
                value={textFallback.value}
                onChange={(event) => {
                  const value = event.target.value;
                  setTextFallback((state) => state ? { ...state, value } : state);
                  persistPendingText(value);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }}
                placeholder={inputLanguage === "ko-KR" ? "한국어로 편하게 입력" : "영어 또는 한국어로 입력"}
                aria-label="내가 말한 문장"
                maxLength={2000}
                enterKeyHint="send"
                rows={1}
                autoFocus
              />
              <button type="submit" disabled={!textFallback.value.trim()}>보내기</button>
            </div>
            <button
              type="button"
              className="call-try-again"
              onClick={() => {
                setTextFallback(null);
                setFailedRecording(null);
                setLiveTranscript("");
                window.requestAnimationFrame(() => {
                  document.querySelector<HTMLButtonElement>(".ptt-button")?.focus();
                });
              }}
            >
              {textFallback.reason === "microphone" ? "마이크 다시 시도" : "마이크로 말하기"}
            </button>
          </form>
        ) : errorMsg && (
          <div className="call-error" role="alert">
            <span>{errorMsg}</span>
            {failedRecording && (
              <button type="button" onClick={() => sendRecording(failedRecording)}>다시 보내기</button>
            )}
          </div>
        )}
      </main>

      <footer className="call-dock">
        <div className="call-status" role="status" aria-live="polite">
          <span className={isRecording ? "is-recording" : tutorSpeaking ? "is-speaking" : ""} />
          {status}
        </div>

        <div className="call-tool-row" aria-label="통화 도구">
          <ToolButton label="입력" ariaLabel="키보드로 입력" active={Boolean(textFallback)} onClick={openKeyboardInput} icon={<KeyboardIcon />} />
          <ToolButton label="0.7배속" ariaLabel="천천히 다시 듣기" active={activeTool === "slow" && tutorSpeaking} onClick={() => replay(0.7)} icon={<TurtleIcon />} />
          <ToolButton label="대본" ariaLabel="스크립트 열기" active={showTranscript} onClick={() => setShowTranscript(true)} icon={<ScriptIcon />} />
          <ToolButton label="힌트" ariaLabel="표현 힌트 열기" active={showHint} onClick={() => setShowHint(true)} icon={<BulbIcon />} />
          <ToolButton
            label="한국어"
            active={inputLanguage === "ko-KR"}
            onClick={() => setInputLanguage((language) => language === "en-US" ? "ko-KR" : "en-US")}
            icon={<LanguageIcon />}
            disabled={isRecording || busy}
            ariaLabel={inputLanguage === "ko-KR" ? "한국어 도움 끄고 영어로 말하기" : "한국어 도움 켜기"}
          />
        </div>

        <div className="call-primary-controls">
          <button
            type="button"
            onClick={() => replay(1)}
            className={`call-round-action call-replay-action ${activeTool === "repeat" && tutorSpeaking ? "is-active" : ""}`}
            aria-label="방금 뭐라고 했는지 다시 듣기"
          >
            <RepeatIcon />
            <span>방금 뭐라고?</span>
          </button>

          <PushToTalkButton
            recognitionLanguage={inputLanguage}
            onResult={sendRecording}
            onEmpty={() => openDirectInput({
              code: "recording-failed",
              message: "음성이 너무 짧거나 또렷하게 담기지 않았어요. 다시 말하거나 직접 입력해 주세요.",
            })}
            onUnavailable={openDirectInput}
            onInterrupt={stopTutorAudio}
            onRecordingChange={(recording) => {
              setIsRecording(recording);
              if (recording) {
                activeClientTurnIdRef.current = createClientTurnId();
                setLiveTranscript("");
                setTextFallback(null);
              }
            }}
            onPhaseChange={setRecorderPhase}
            onTranscriptChange={(transcript) => {
              setLiveTranscript(transcript);
              persistPendingText(transcript);
            }}
            tutorSpeaking={tutorSpeaking}
            busy={busy || phase === "ending"}
          />

          <button type="button" onClick={requestExit} className="call-round-action call-end-action" aria-label="연습 나가기">
            <PhoneDownIcon />
            <span>종료</span>
          </button>
        </div>
      </footer>

      {showTranscript && <TranscriptSheet turns={turns} tutorId={tutor.id} onClose={() => setShowTranscript(false)} />}
      {showHint && <HintSheet tutorId={tutor.id} lastTutorLine={subtitle?.en ?? ""} onClose={() => setShowHint(false)} />}
      {showContext && briefing && <BriefingDialog briefing={briefing} onClose={() => setShowContext(false)} />}
      {showExitOptions && (
        <CallExitSheet
          onPause={() => void pauseCall()}
          onFinish={() => void endCall()}
          onClose={() => setShowExitOptions(false)}
        />
      )}
    </div>
  );
}

function RingingScreen({ tutor, onCancel }: { tutor: TutorInfo; onCancel: () => void }) {
  return (
    <div className="call-ringing-screen" style={{ "--tutor-color": tutor.color } as React.CSSProperties}>
      <div className="call-ringing-orb" />
      <div className="call-ringing-content">
        <div className="call-ringing-avatar-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={tutor.profileImage} alt={`${tutor.name} 프로필`} className="call-ringing-avatar" />
          <span className="call-ringing-pulse" />
        </div>
        <p className="call-ringing-kicker">영어 통화</p>
        <h1>{tutor.name}</h1>
        <p className="call-ringing-status"><ListeningDots /> 연결하고 있어요</p>
        <p className="call-ai-voice-disclosure">들리는 목소리는 AI가 생성한 음성입니다.</p>
      </div>
      <button type="button" onClick={onCancel} className="call-ringing-cancel" aria-label="통화 취소">
        <PhoneDownIcon />
        <span>취소</span>
      </button>
    </div>
  );
}

function CallErrorScreen({ message, onBack, onRetry }: { message: string; onBack: () => void; onRetry: () => void }) {
  return (
    <main className="call-error-screen">
      <div className="call-error-symbol" aria-hidden="true">!</div>
      <h1>통화를 시작하지 못했어요</h1>
      <p role="alert">{message}</p>
      <div className="call-error-actions">
        <button type="button" onClick={onBack}>돌아가기</button>
        <button type="button" onClick={onRetry} className="is-primary">다시 시도</button>
      </div>
    </main>
  );
}

function BriefingScreen({
  tutor,
  briefing,
  image,
  loading,
  onStart,
  onCancel,
}: {
  tutor: TutorInfo;
  briefing: BriefingContent | null;
  image?: string;
  loading: boolean;
  onStart: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="call-briefing-screen">
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="call-briefing-background" />
      )}
      <div className="call-briefing-scrim" />
      <header className="call-briefing-header">
        <div className="call-contact">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={tutor.profileImage} alt="" className="call-contact-avatar" />
          <div>
            <div className="call-contact-name">{tutor.name}과 연습</div>
            <div className="call-contact-detail">상황 확인 · AI 생성 음성</div>
          </div>
        </div>
        <button type="button" onClick={onCancel} className="call-close-button" aria-label="나가기"><CloseIcon /></button>
      </header>
      <div className="call-briefing-card">
        {loading || !briefing ? (
          <div className="call-briefing-loading"><span className="call-spinner" /> 상황을 준비하고 있어요</div>
        ) : (
          <>
            <div className="call-briefing-eyebrow"><SparkIcon /> {briefing.eyebrow}</div>
            <h1>{briefing.title}</h1>
            {briefing.titleEn && <div className="call-briefing-title-en">{briefing.titleEn}</div>}
            <p className="call-briefing-description">{briefing.description}</p>
            <div className="call-role-grid">
              <div><span>{tutor.name}</span><strong>{briefing.tutorRole}</strong></div>
              <div><span>나</span><strong>{briefing.learnerRole}</strong></div>
            </div>
            {briefing.goal && (
              <div className="call-goal-box">
                <TargetIcon />
                <div><span>이번 대화 목표</span><p>{briefing.goal}</p></div>
              </div>
            )}
            {briefing.expressions && briefing.expressions.length > 0 && (
              <div className="brief-expressions">
                <span className="brief-expressions-label">이럴 때 쓰면 좋아요</span>
                {briefing.expressions.map((expression) => (
                  <BriefExpression key={expression.en} expression={expression} tutorId={tutor.id} />
                ))}
              </div>
            )}
          </>
        )}
        <button type="button" onClick={onStart} disabled={loading || !briefing} className="call-start-button">
          준비됐어요 <ArrowRightIcon />
        </button>
        <p className="call-briefing-tip">정답을 외우지 않아도 괜찮아요. 막히면 힌트를 눌러보세요.</p>
      </div>
    </div>
  );
}

function BriefExpression({ expression, tutorId }: { expression: { en: string; ko: string }; tutorId: string }) {
  const player = useAudioPlayer(tutorId);
  return (
    <div className="brief-expression">
      <div>
        <p>{expression.en}</p>
        <small>{expression.ko}</small>
      </div>
      <button
        type="button"
        className={`brief-listen ${player.speaking ? "is-speaking" : ""}`}
        onClick={() => void player.playTTS(expression.en, { tutorId })}
        aria-label={`"${expression.en}" 듣기`}
      >
        <SpeakerIcon />
      </button>
    </div>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" />
      <path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.2 6.6a7.6 7.6 0 0 1 0 10.8" />
    </svg>
  );
}

function BriefingDialog({ briefing, onClose }: { briefing: BriefingContent; onClose: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(onClose);
  return (
    <div className="apple-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="apple-bottom-sheet call-context-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="context-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="apple-sheet-handle" />
        <div className="apple-sheet-header">
          <div>
            <span>{briefing.eyebrow}</span>
            <h2 id="context-title">{briefing.title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="상황 설명 닫기"><CloseIcon /></button>
        </div>
        <p className="call-context-description">{briefing.description}</p>
        <div className="call-role-grid light">
          <div><span>튜터 역할</span><strong>{briefing.tutorRole}</strong></div>
          <div><span>내 역할</span><strong>{briefing.learnerRole}</strong></div>
        </div>
        {briefing.goal && <div className="call-context-goal"><TargetIcon /><p>{briefing.goal}</p></div>}
        <button type="button" onClick={onClose} className="apple-primary-button">확인했어요</button>
      </section>
    </div>
  );
}

function CallExitSheet({ onPause, onFinish, onClose }: { onPause: () => void; onFinish: () => void; onClose: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(onClose);
  return (
    <div className="apple-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="apple-bottom-sheet call-exit-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="call-exit-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="apple-sheet-handle" />
        <div className="call-exit-symbol" aria-hidden="true">Ⅱ</div>
        <h2 id="call-exit-title">여기서 잠시 멈출까요?</h2>
        <p>지금까지의 대화와 학습 단계가 저장돼요. 홈에서 그대로 이어할 수 있습니다.</p>
        <button type="button" className="call-exit-primary" onClick={onPause}>
          저장하고 나가기
          <span>다음에 이 지점부터 계속</span>
        </button>
        <button type="button" className="call-exit-secondary" onClick={onFinish}>
          이번 연습 종료 · 리포트 보기
        </button>
        <button type="button" className="call-exit-cancel" onClick={onClose}>계속 연습하기</button>
      </section>
    </div>
  );
}

function StageProgress({ stage }: { stage: string }) {
  const current = STAGE_ORDER.indexOf(stage);
  return (
    <div className="call-stage-progress" aria-label={`현재 ${STAGE_LABELS[stage] ?? stage} 단계`}>
      <span>{STAGE_LABELS[stage] ?? stage}</span>
      <div>{STAGE_ORDER.slice(0, 4).map((item, index) => <i key={item} className={index <= current ? "is-filled" : ""} />)}</div>
    </div>
  );
}

function ToolButton({
  label,
  active,
  onClick,
  icon,
  disabled = false,
  ariaLabel,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      className={`call-tool-button ${active ? "is-active" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? label}
      aria-pressed={active}
    >
      <span className="call-tool-icon">{icon}</span>
      <span>{label}</span>
      <i className="call-tool-indicator" aria-hidden="true" />
    </button>
  );
}

function CallTimer({
  active,
  initialSeconds = 0,
  getSeconds,
}: {
  active: boolean;
  initialSeconds?: number;
  getSeconds?: () => number;
}) {
  const [seconds, setSeconds] = useState(initialSeconds);
  useEffect(() => {
    if (!active) return;
    const refresh = () => setSeconds(getSeconds ? getSeconds() : initialSeconds);
    refresh();
    const interval = window.setInterval(refresh, 1000);
    return () => window.clearInterval(interval);
  }, [active, getSeconds, initialSeconds]);
  return (
    <div className="call-timer" aria-label={`통화 시간 ${Math.floor(seconds / 60)}분 ${seconds % 60}초`}>
      {String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}
    </div>
  );
}

function ListeningDots() {
  return <span className="listening-dots" aria-hidden="true"><i /><i /><i /></span>;
}

const Svg = ({ children, size = 20 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

function RepeatIcon() { return <Svg><path d="M4 7h11a5 5 0 0 1 0 10H8" /><path d="m7 4-3 3 3 3" /><path d="m11 14-3 3 3 3" /></Svg>; }
function TurtleIcon() { return <Svg><path d="M7 15a5 5 0 0 1 10 0v1H7v-1Z" /><path d="M17 14h2.5a1.5 1.5 0 1 1 0 3H17M9 16v2m6-2v2M5 15H3" /><circle cx="20" cy="15.5" r=".35" fill="currentColor" stroke="none" /></Svg>; }
function ScriptIcon() { return <Svg><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M8.5 8h7M8.5 12h7M8.5 16h4" /></Svg>; }
function LanguageIcon() { return <Svg size={21}><circle cx="12" cy="12" r="9" /><path d="M3.5 12h17M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></Svg>; }
function KeyboardIcon() { return <Svg size={22}><rect x="3" y="6" width="18" height="12" rx="3" /><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7 14h10" /></Svg>; }
function BulbIcon() { return <Svg size={22}><path d="M9 18h6M10 22h4M8 14.5A6 6 0 1 1 16 14.5c-.8.7-1 1.4-1 2.5H9c0-1.1-.2-1.8-1-2.5Z" /></Svg>; }
function PhoneDownIcon() { return <Svg size={24}><path d="M5.2 15.8a15 15 0 0 1 13.6 0M7.2 14.8l-1.7 4M16.8 14.8l1.7 4" /></Svg>; }
function CloseIcon() { return <Svg size={18}><path d="m7 7 10 10M17 7 7 17" /></Svg>; }
function LocationIcon() { return <Svg size={16}><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></Svg>; }
function ChevronIcon() { return <Svg size={15}><path d="m9 6 6 6-6 6" /></Svg>; }
function SparkIcon() { return <Svg size={16}><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3ZM18.5 14l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" /></Svg>; }
function TargetIcon() { return <Svg size={22}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><path d="m14.8 9.2 5-5M17 4h3v3" /></Svg>; }
function ArrowRightIcon() { return <Svg size={18}><path d="M5 12h14M14 7l5 5-5 5" /></Svg>; }
