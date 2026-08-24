"use client";

// 영상통화 화면 — 연결음 → 튜터 응답 연출 → 라이브 세션 (프리토킹/러닝모드 공용)

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import AvatarView from "@/components/AvatarView";
import PushToTalkButton from "@/components/PushToTalkButton";
import SceneBackdrop from "@/components/SceneBackdrop";
import CelebrationLayer from "@/components/CelebrationLayer";
import TranscriptSheet, { type ClientTurn } from "@/components/TranscriptSheet";
import HintSheet from "@/components/HintSheet";
import { ExpressionCardView, SuggestionCardView, CorrectionCardView } from "@/components/Cards";
import { useAudioPlayer, type PlayableAudio } from "@/hooks/useAudioPlayer";
import type { RecorderResult } from "@/hooks/useRecorder";
import { sfxRingtone, sfxHangup, sfxSuccess, sfxCombo, sfxLevelUp, sfxRetry, sfxPop } from "@/lib/sfx";
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
}

const STAGE_LABELS: Record<string, string> = {
  review: "복습",
  intro: "새 표현",
  practice: "연습",
  roleplay: "상황 적용",
  done: "완료",
};
const STAGE_ORDER = ["review", "intro", "practice", "roleplay", "done"];

export default function CallPage() {
  const { tutorId } = useParams<{ tutorId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const mode = (search.get("mode") ?? "freetalk") as "freetalk" | "learning";
  const scenarioId = search.get("scenario");
  const unitId = search.get("unit");

  const [tutor, setTutor] = useState<TutorInfo | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [avatarLayer, setAvatarLayer] = useState("auto");
  const [subtitleMode, setSubtitleMode] = useState<"always" | "tap" | "off">("always");
  const [phase, setPhase] = useState<"ringing" | "live" | "ending">("ringing");
  const [sessionId, setSessionId] = useState("");
  const [stageState, setStageState] = useState<StageState | null>(null);
  const [busy, setBusy] = useState(false);
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
  const [xpGain, setXpGain] = useState<number | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [failedRecording, setFailedRecording] = useState<RecorderResult | null>(null);

  const player = useAudioPlayer();
  const repeatTargetRef = useRef("");
  const prevXpRef = useRef(0);
  const startTsRef = useRef(Date.now());
  const endingRef = useRef(false);

  // 튜터/시나리오 정보 로드
  useEffect(() => {
    fetch("/api/state")
      .then((r) => r.json())
      .then((data) => {
        const t = data.tutors.find((x: TutorInfo) => x.id === tutorId);
        if (t) setTutor(t);
        if (scenarioId) {
          const s = data.scenarios.find((x: Scenario) => x.id === scenarioId);
          if (s) setScenario(s);
        }
        setAvatarLayer(String(data.avatarLayer ?? "auto"));
        setSubtitleMode(data.user.settings?.subtitles ?? "always");
      });
  }, [tutorId, scenarioId]);

  const handleTutorReply = useCallback(
    (payload: {
      reply: string;
      reply_ko: string;
      audio: PlayableAudio | null;
      correction: CorrectionCard | null;
      suggestion: SuggestionCard | null;
      end_call: boolean;
      expressionCard?: Expression | null;
    }) => {
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
      if (mode === "learning" && payload.correction) {
        setCorrectionCard(payload.correction);
      } else {
        setCorrectionCard(null);
      }
      const turnId = "ct" + Date.now();
      setTurns((prev) => [...prev, { id: turnId, role: "tutor", text: payload.reply, ko: payload.reply_ko, audio: payload.audio }]);
      player.play(payload.audio, payload.reply, {
        onEnd: payload.end_call
          ? () => {
              endCall();
            }
          : undefined,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, player],
  );

  // 세션 시작 (연결음과 병행)
  useEffect(() => {
    if (!tutor) return;
    let cancelled = false;
    const stopRing = sfxRingtone();
    const minRing = new Promise((r) => setTimeout(r, 2400));
    const startReq = fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start", tutorId, mode, scenarioId: scenarioId ?? undefined, unitId: unitId ?? undefined }),
    }).then((r) => r.json());

    Promise.all([startReq, minRing])
      .then(([data]) => {
        if (cancelled) return;
        stopRing();
        if (data.error) {
          setErrorMsg("연결에 실패했어요: " + data.error);
          setPhase("live");
          return;
        }
        setSessionId(data.sessionId);
        setStageState(data.stageState);
        setPhase("live");
        startTsRef.current = Date.now();
        handleTutorReply({ ...data.greeting, expressionCard: data.expressionCard });
      })
      .catch(() => {
        if (!cancelled) {
          stopRing();
          setErrorMsg("연결에 실패했어요. 네트워크를 확인해 주세요.");
          setPhase("live");
        }
      });
    return () => {
      cancelled = true;
      stopRing();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutor]);

  const sendRecording = useCallback(
    async (r: RecorderResult) => {
      if (!sessionId || busy) return;
      setBusy(true);
      setErrorMsg("");
      setJudgmentResult(null);
      const form = new FormData();
      form.append("sessionId", sessionId);
      form.append("audio", r.blob, "speech.webm");
      form.append("durationSec", String(Math.round(r.durationSec)));
      if (repeatTargetRef.current) form.append("repeatTarget", repeatTargetRef.current);

      try {
        const res = await fetch("/api/turn", { method: "POST", body: form });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (data.empty) {
          setErrorMsg(data.message);
          setBusy(false);
          return;
        }
        setFailedRecording(null);

        // 내 발화 기록 (녹음 blob 보존 → 비교 재생)
        setTurns((prev) => [...prev, { id: "cu" + Date.now(), role: "user", text: data.userText, userBlob: r.blob }]);

        // 판정 이펙트
        const result = data.result;
        if (result.judgment) {
          setJudgmentResult(result.judgment);
          if (result.judgment.pass) {
            setConfetti((c) => c + 1);
            sfxSuccess();
            if (data.combo >= 2) sfxCombo(data.combo);
          } else {
            sfxRetry();
          }
        }
        setCombo(data.combo ?? 0);

        // XP 팝업
        const earned = data.xp?.earned ?? 0;
        const delta = earned - prevXpRef.current;
        prevXpRef.current = earned;
        if (delta > 0) setXpGain(delta);

        // 스테이지 전환 배너
        const events: string[] = result.events ?? [];
        if (events.includes("unit-clear")) {
          sfxLevelUp();
          setConfetti((c) => c + 1);
          setBanner("🎉 유닛 클리어!");
        } else if (events.includes("stage-advance") && data.stageState) {
          setBanner(`${STAGE_LABELS[data.stageState.stage] ?? ""} 단계로!`);
          sfxPop();
        }
        setStageState(data.stageState);
        if (data.stageState?.stage !== "intro") setExpressionCard(null);

        handleTutorReply({ ...result, expressionCard: data.expressionCard });
      } catch (e) {
        console.error(e);
        setErrorMsg("전송에 실패했어요. 아래 버튼으로 다시 시도할 수 있어요.");
        setFailedRecording(r);
      } finally {
        setBusy(false);
      }
    },
    [sessionId, busy, handleTutorReply],
  );

  const endCall = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    setPhase("ending");
    player.stop();
    sfxHangup();
    const callSeconds = Math.round((Date.now() - startTsRef.current) / 1000);
    try {
      await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end", sessionId, callSeconds }),
      });
    } catch {}
    router.replace(`/report/${sessionId}`);
  }, [player, router, sessionId]);

  if (!tutor) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin" />
      </div>
    );
  }

  // ── 연결음 화면 ──
  if (phase === "ringing") {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-slate-900 to-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={tutor.profileImage} alt="" className="w-32 h-32 rounded-full border-4 animate-pulse" style={{ borderColor: tutor.color }} />
        <div className="text-center">
          <div className="text-xl font-bold">{tutor.name}</div>
          <div className="text-sm text-white/50 mt-1 animate-pulse">연결 중...</div>
        </div>
        <button onClick={() => router.back()} className="mt-8 w-16 h-16 rounded-full bg-red-600 flex items-center justify-center text-2xl rotate-[135deg]">
          📞
        </button>
      </div>
    );
  }

  const showSubtitle = subtitleMode === "always" || (subtitleMode === "tap" && tapRevealed);

  return (
    <div className="relative min-h-dvh flex flex-col overflow-hidden">
      <SceneBackdrop image={scenario?.image} ambience={scenario?.ambience} title={scenario?.title} titleKo={scenario?.titleKo} />
      <CelebrationLayer trigger={confetti} combo={combo} xpGain={xpGain} bannerText={banner} />

      {/* 상단바 */}
      <div className="relative z-10 flex items-center justify-between px-4 pt-5">
        <div className="flex items-center gap-2">
          <div className="text-sm font-bold">
            {tutor.name} {tutor.emoji}
          </div>
          {scenario && <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10">{scenario.titleKo}</span>}
        </div>
        <CallTimer />
      </div>

      {/* 러닝모드 단계 진행 바 */}
      {mode === "learning" && stageState && (
        <div className="relative z-10 px-4 mt-3">
          <div className="flex gap-1">
            {STAGE_ORDER.slice(0, 4).map((s) => {
              const idx = STAGE_ORDER.indexOf(stageState.stage);
              const myIdx = STAGE_ORDER.indexOf(s);
              return (
                <div key={s} className="flex-1">
                  <div className={`h-1.5 rounded-full ${myIdx < idx ? "bg-emerald-500" : myIdx === idx ? "bg-emerald-400 animate-pulse" : "bg-white/15"}`} />
                  <div className={`text-[9px] mt-1 text-center ${myIdx === idx ? "text-emerald-300 font-bold" : "text-white/35"}`}>{STAGE_LABELS[s]}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 아바타 */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-5" onClick={() => subtitleMode === "tap" && setTapRevealed((v) => !v)}>
        <AvatarView tutor={tutor} speaking={player.speaking} layer={avatarLayer} size={180} />

        {/* 자막 */}
        {subtitle && showSubtitle && (
          <div className="mt-5 max-w-sm text-center animate-[slideUp_0.3s_ease]">
            <p className="text-base leading-relaxed font-medium text-white drop-shadow">{subtitle.en}</p>
            {showKo && subtitle.ko && <p className="mt-1 text-sm text-white/60">{subtitle.ko}</p>}
            {subtitle.ko && (
              <button onClick={(e) => { e.stopPropagation(); setShowKo((v) => !v); }} className="mt-1.5 text-[11px] text-white/40 underline">
                {showKo ? "번역 숨기기" : "번역 보기"}
              </button>
            )}
          </div>
        )}

        {/* 판정 결과 */}
        {judgmentResult && (
          <div className={`mt-3 px-4 py-1.5 rounded-full text-sm font-bold animate-[popIn_0.3s_ease] ${judgmentResult.pass ? "bg-emerald-500/25 text-emerald-300" : "bg-amber-500/25 text-amber-300"}`}>
            {judgmentResult.pass ? `👏 ${judgmentResult.score}점!` : `${judgmentResult.score}점 — 한 번 더!`}
          </div>
        )}
        {errorMsg && (
          <div className="mt-3 flex items-center gap-2 text-sm text-red-300 bg-red-500/10 rounded-xl px-3 py-2">
            <span>{errorMsg}</span>
            {failedRecording && (
              <button onClick={() => sendRecording(failedRecording)} className="px-2 py-0.5 rounded-full bg-red-500/30 text-xs font-bold">
                재시도
              </button>
            )}
          </div>
        )}
      </div>

      {/* 카드 영역 */}
      <div className="relative z-10 px-4 space-y-2 mb-2">
        {expressionCard && <ExpressionCardView expr={expressionCard} tutorId={tutor.id} />}
        {suggestionCard && <SuggestionCardView card={suggestionCard} tutorId={tutor.id} />}
        {correctionCard && !suggestionCard && <CorrectionCardView card={correctionCard} tutorId={tutor.id} />}
      </div>

      {/* 하단 컨트롤 */}
      <div className="relative z-10 pb-7 px-4">
        <div className="flex items-end justify-between">
          {/* 좌측 유틸 */}
          <div className="flex flex-col gap-2 mb-1">
            <button onClick={() => player.replayLast(1.0)} className="w-11 h-11 rounded-full bg-white/10 backdrop-blur flex items-center justify-center text-base" aria-label="방금 뭐라고?">
              🔁
            </button>
            <button onClick={() => player.replayLast(0.7)} className="w-11 h-11 rounded-full bg-white/10 backdrop-blur flex items-center justify-center text-base" aria-label="천천히 다시">
              🐢
            </button>
            <button onClick={() => setShowTranscript(true)} className="w-11 h-11 rounded-full bg-white/10 backdrop-blur flex items-center justify-center text-base" aria-label="다시듣기">
              📜
            </button>
          </div>

          {/* 푸시투토크 */}
          <PushToTalkButton onResult={sendRecording} onInterrupt={player.stop} tutorSpeaking={player.speaking} busy={busy || phase === "ending"} />

          {/* 우측: 힌트 + 종료 */}
          <div className="flex flex-col gap-2 mb-1 items-center">
            <button onClick={() => setShowHint(true)} className="w-11 h-11 rounded-full bg-amber-500/25 backdrop-blur flex items-center justify-center text-base" aria-label="힌트">
              💡
            </button>
            <button onClick={endCall} className="w-14 h-14 rounded-full bg-red-600 flex items-center justify-center text-xl rotate-[135deg] shadow-lg active:scale-95 transition-transform" aria-label="통화 종료">
              📞
            </button>
          </div>
        </div>
      </div>

      {showTranscript && <TranscriptSheet turns={turns} tutorId={tutor.id} onClose={() => setShowTranscript(false)} />}
      {showHint && <HintSheet tutorId={tutor.id} lastTutorLine={subtitle?.en ?? ""} onClose={() => setShowHint(false)} />}
    </div>
  );
}

function CallTimer() {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(iv);
  }, []);
  return (
    <div className="text-xs text-white/50 tabular-nums">
      {String(Math.floor(sec / 60)).padStart(2, "0")}:{String(sec % 60).padStart(2, "0")}
    </div>
  );
}
