"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { subscribePush } from "@/components/SWRegister";
import { useRecorder } from "@/hooks/useRecorder";
import { AGE_BANDS, GOALS, INTEREST_TAGS, OCCUPATIONS, STYLES } from "@/core/tags";
import type { AgeBand, LearnerProfile, LearningGoal, Occupation, Temperament } from "@/core/types";

interface MatchInfo {
  id: string;
  name: string;
  koName: string;
  color: string;
  profileImage: string;
  bio: string;
  job: string;
  nationality: string;
  score: number;
  reasons: string[];
}

type Step = "welcome" | "name" | "leveltest" | "result" | "profile" | "match";

const FLOW_STEPS: { id: Exclude<Step, "welcome">; label: string }[] = [
  { id: "name", label: "이름" },
  { id: "leveltest", label: "레벨" },
  { id: "result", label: "결과" },
  { id: "profile", label: "프로필" },
  { id: "match", label: "친구" },
];

const PROMPTS = [
  { label: "소개", text: "이름, 하는 일, 취미를 간단히 소개해 보세요." },
  { label: "어제", text: "어제 무엇을 했는지 순서대로 이야기해 보세요." },
  { label: "음식", text: "좋아하는 음식과 그 이유를 말해 보세요." },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [name, setName] = useState("");
  const [level, setLevel] = useState(2);
  const [note, setNote] = useState("");
  const [heardText, setHeardText] = useState("");
  const [matches, setMatches] = useState<MatchInfo[]>([]);
  const [ageBand, setAgeBand] = useState<AgeBand | null>(null);
  const [occupation, setOccupation] = useState<Occupation | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [goal, setGoal] = useState<LearningGoal | null>(null);
  const [style, setStyle] = useState<Temperament | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState(0);
  const [evaluating, setEvaluating] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [completing, setCompleting] = useState(false);
  const [matchStatus, setMatchStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [stateReloadKey] = useState(0);
  const [completeError, setCompleteError] = useState("");
  const [voiceNotice, setVoiceNotice] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishingRef = useRef(false);
  const stepContentRef = useRef<HTMLDivElement>(null);
  const {
    start,
    stop,
    cancel,
    isRecording,
    isFinalizing,
    phase,
    level: micLevel,
    liveTranscript,
    hasDetectedSpeech,
    isSpeechRecognitionSupported,
    error: recorderError,
  } = useRecorder();

  useEffect(() => {
    let active = true;
    fetch("/api/state")
      .then((response) => {
        if (!response.ok) throw new Error("state load failed");
        return response.json();
      })
      .then((data) => {
        if (!active) return;
        if (data.user.onboarded) router.replace("/");
      })
      .catch(() => {
        // 온보딩 첫 화면은 서버 상태 없이도 진행할 수 있어야 한다.
      });
    return () => { active = false; };
  }, [router, stateReloadKey]);

  const clearTimer = useCallback(() => {
    if (!timerRef.current) return;
    clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  useEffect(() => {
    if (step === "welcome") return;
    const frame = window.requestAnimationFrame(() => {
      if (step === "name") {
        document.getElementById("display-name")?.focus();
        return;
      }
      stepContentRef.current?.querySelector<HTMLElement>("h1")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  const finishRecording = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    clearTimer();

    const recorded = await stop();
    if (!recorded) {
      setVoiceNotice("조금 더 길게 말한 뒤 다시 완료해 주세요.");
      finishingRef.current = false;
      return;
    }

    setEvaluating(true);
    setHeardText(recorded.transcript ?? liveTranscript);
    try {
      const form = new FormData();
      form.append("audio", recorded.blob, "leveltest.webm");
      form.append("durationSec", String(Math.round(recorded.durationSec)));
      const response = await fetch("/api/onboarding", { method: "POST", body: form });
      if (!response.ok) throw new Error("level test failed");
      const data = await response.json();
      setLevel(data.level ?? 2);
      setNote(data.note ?? "");
      setHeardText(data.transcript?.trim() || recorded.transcript || liveTranscript);
    } catch {
      setLevel(2);
      setNote("지금은 기본 레벨로 시작해요. 설정에서 언제든 바꿀 수 있어요.");
    } finally {
      setEvaluating(false);
      finishingRef.current = false;
      setStep("result");
    }
  }, [clearTimer, liveTranscript, stop]);

  const toggleRecord = async () => {
    if (phase === "requesting") {
      cancel();
      clearTimer();
      return;
    }
    if (isRecording) {
      await finishRecording();
      return;
    }

    setVoiceNotice("");
    const started = await start();
    if (!started) return;
    setSeconds(0);
    setHeardText("");
    clearTimer();
    timerRef.current = setInterval(() => {
      setSeconds((current) => {
        const next = Math.min(60, current + 1);
        if (next === 60) window.setTimeout(() => void finishRecording(), 0);
        return next;
      });
    }, 1000);
  };

  const profile: LearnerProfile | null =
    ageBand && occupation && goal && style && interests.length === 3
      ? { ageBand, occupation, interests, goal, style }
      : null;

  const loadMatches = useCallback(async (candidate: LearnerProfile) => {
    setMatchStatus("loading");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", profile: candidate }),
      });
      if (!response.ok) throw new Error("preview failed");
      const data = await response.json();
      setMatches(data.matches ?? []);
      setMatchStatus("ready");
    } catch {
      setMatches([]);
      setMatchStatus("error");
    }
  }, []);

  const complete = async () => {
    if (completing || !profile) return;
    setCompleting(true);
    setCompleteError("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete", name: name.trim(), level, note, profile }),
      });
      if (!response.ok) throw new Error("onboarding failed");
      const data = await response.json();
      subscribePush().catch(() => {});
      const first = Array.isArray(data.friends) ? data.friends[0] : undefined;
      router.replace(first ? `/chat/${first}` : "/");
    } catch {
      setCompleting(false);
      setCompleteError("친구와 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  };

  const toggleInterest = (id: string) => {
    setInterests((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      // 관심사는 3개까지 — 넘치면 가장 먼저 고른 것을 밀어낸다.
      return current.length >= 3 ? [...current.slice(1), id] : [...current, id];
    });
  };

  const stepIndex = FLOW_STEPS.findIndex((item) => item.id === step);
  const busy = evaluating || isFinalizing;

  return (
    <main className="relative min-h-dvh overflow-x-hidden bg-[#07080c] text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[360px] bg-[radial-gradient(circle_at_50%_-30%,rgba(10,132,255,0.3),transparent_68%)]" />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-[430px] flex-col px-5 pb-[max(28px,env(safe-area-inset-bottom))] pt-[max(18px,env(safe-area-inset-top))]">
        {step !== "welcome" && (
          <header className="mb-7" aria-label={`시작 설정 ${stepIndex + 1}/${FLOW_STEPS.length}`}>
            <div className="flex items-center justify-between text-[12px] font-medium text-white/45">
              <span>시작 설정</span>
              <span className="tabular-nums">{stepIndex + 1} / {FLOW_STEPS.length}</span>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-1.5" aria-hidden="true">
              {FLOW_STEPS.map((item, index) => (
                <span
                  key={item.id}
                  className={`h-1 rounded-full transition-colors ${index <= stepIndex ? "bg-[var(--apple-blue)]" : "bg-white/12"}`}
                />
              ))}
            </div>
          </header>
        )}

        <div ref={stepContentRef} className={`flex flex-1 flex-col ${step === "welcome" ? "justify-center" : ""}`}>
          {step === "welcome" && <WelcomeStep onNext={() => setStep("name")} />}

          {step === "name" && (
            <section className="animate-[slideUp_0.35s_ease]" aria-labelledby="name-title">
              <StepHeading eyebrow="01 · PROFILE" title="어떻게 불러드릴까요?" description="친구들이 부를 이름 하나만 알려주세요." id="name-title" />
              <label className="mt-8 block text-[12px] font-semibold text-white/55" htmlFor="display-name">이름 또는 닉네임</label>
              <input
                id="display-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing && name.trim()) {
                    event.preventDefault();
                    setStep("leveltest");
                  }
                }}
                placeholder="예: 수민"
                autoFocus
                autoComplete="nickname"
                enterKeyHint="next"
                maxLength={24}
                className="mt-2 h-14 w-full rounded-2xl border border-white/10 bg-white/[0.07] px-4 text-[17px] font-medium outline-none transition focus:border-[var(--apple-blue)] focus:bg-white/[0.1] placeholder:text-white/25"
              />
              <PrimaryButton onClick={() => setStep("leveltest")} disabled={!name.trim()} className="mt-5">계속</PrimaryButton>
            </section>
          )}

          {step === "leveltest" && (
            <section className="animate-[slideUp_0.35s_ease]" aria-labelledby="test-title">
              <StepHeading eyebrow="02 · VOICE CHECK" title="영어로 잠깐 말해보세요" description="30초 정도면 충분해요. 틀려도 괜찮습니다." id="test-title" />

              <div className="mt-6">
                <div className="apple-segment grid grid-cols-3 rounded-xl bg-white/[0.07] p-1" role="tablist" aria-label="말하기 주제">
                  {PROMPTS.map((prompt, index) => (
                    <button
                      key={prompt.label}
                      type="button"
                      role="tab"
                      aria-selected={selectedPrompt === index}
                      onClick={() => setSelectedPrompt(index)}
                      disabled={isRecording || busy || phase === "requesting"}
                      className={`min-h-11 rounded-[9px] px-2 text-[12px] font-semibold transition ${selectedPrompt === index ? "is-selected bg-white text-[#1d1d1f] shadow-sm" : "text-white/50"}`}
                    >
                      {prompt.label}
                    </button>
                  ))}
                </div>
                <p className="mt-3 min-h-11 rounded-2xl border border-white/[0.08] bg-white/[0.045] px-4 py-3 text-[13px] leading-relaxed text-white/68">
                  {PROMPTS[selectedPrompt].text}
                </p>
              </div>

              <div className="mt-7 flex flex-col items-center">
                <button
                  type="button"
                  onClick={toggleRecord}
                  disabled={busy}
                  aria-label={phase === "requesting" ? "마이크 연결 취소" : isRecording ? "녹음 끝내기" : "녹음 시작하기"}
                  aria-pressed={isRecording}
                  className={`relative grid h-24 w-24 place-items-center rounded-full text-white shadow-[0_18px_50px_rgba(0,0,0,0.32)] transition active:scale-95 disabled:opacity-55 ${isRecording ? "bg-[var(--apple-red)]" : "bg-[var(--apple-blue)]"}`}
                  style={isRecording ? { boxShadow: `0 0 ${24 + micLevel * 36}px rgba(255,69,58,.26)` } : undefined}
                >
                  {busy || phase === "requesting" ? <span className="apple-loader h-6 w-6" aria-hidden="true" /> : isRecording ? <StopIcon /> : <MicIcon />}
                  {isRecording && <span className="absolute inset-[-7px] rounded-full border border-[var(--apple-red)]/35" aria-hidden="true" />}
                </button>
                <div className="mt-3 min-h-10 text-center" aria-live="polite">
                  <div className="text-[14px] font-semibold">
                    {evaluating ? "레벨을 확인하고 있어요" : isFinalizing ? "말한 내용을 정리하고 있어요" : phase === "requesting" ? "마이크 연결 중 · 탭해서 취소" : isRecording ? `${seconds}초 · 탭해서 완료` : "탭해서 말하기"}
                  </div>
                  <div className="mt-1 text-[11px] text-white/38">최대 60초 뒤 자동으로 끝나요</div>
                </div>
              </div>

              <div className={`mt-5 rounded-[22px] border p-4 transition ${isRecording && hasDetectedSpeech ? "border-[var(--apple-green)]/35 bg-[var(--apple-green)]/8" : "border-white/[0.08] bg-white/[0.045]"}`} aria-live="polite">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/42">내 말</span>
                  {isRecording && <VoiceBars level={micLevel} />}
                </div>
                <p className={`mt-2 min-h-10 text-[14px] leading-relaxed ${liveTranscript ? "text-white/86" : "text-white/32"}`}>
                  {liveTranscript || (isSpeechRecognitionSupported ? "말하면 여기에 바로 표시돼요." : "음성은 녹음 후 정확히 확인해요.")}
                </p>
              </div>

              {(recorderError || voiceNotice) && <p className="mt-3 text-center text-[12px] text-[#ff9f8f]" role="alert">{recorderError?.message || voiceNotice}</p>}

              <button
                type="button"
                onClick={() => { cancel(); setVoiceNotice(""); setLevel(2); setNote(""); setHeardText(""); setStep("result"); }}
                disabled={isRecording || busy}
                className="mx-auto mt-5 block min-h-11 px-4 text-[13px] font-medium text-white/40 transition hover:text-white/65 disabled:opacity-30"
              >
                지금은 건너뛰기
              </button>
            </section>
          )}

          {step === "result" && (
            <section className="animate-[slideUp_0.35s_ease] text-center" aria-labelledby="result-title">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-[22px] bg-[var(--apple-blue)]/15 text-[var(--apple-blue)]"><LevelIcon /></div>
              <p className="mt-5 text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--apple-blue)]">Your level</p>
              <h1 id="result-title" tabIndex={-1} className="mt-2 text-[32px] font-semibold tracking-[-0.045em] outline-none">Level {level}</h1>
              <div className="mx-auto mt-5 grid max-w-[280px] grid-cols-5 gap-2" role="img" aria-label={`레벨 5단계 중 ${level}단계`}>
                {[1, 2, 3, 4, 5].map((item) => <span key={item} className={`h-1.5 rounded-full ${item <= level ? "bg-[var(--apple-blue)]" : "bg-white/12"}`} />)}
              </div>

              <div className="mt-7 rounded-[24px] border border-white/[0.08] bg-white/[0.055] p-5 text-left">
                <div className="text-[12px] font-semibold text-white/45">맞춤 대화 설정</div>
                <p className="mt-2 text-[14px] leading-relaxed text-white/75">{note || "지금 수준에 맞춰 문장 길이와 말하기 속도를 조절할게요."}</p>
                {heardText && (
                  <div className="mt-4 border-t border-white/[0.08] pt-4">
                    <div className="text-[11px] font-semibold text-white/38">인식된 문장</div>
                    <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-white/58">“{heardText}”</p>
                  </div>
                )}
              </div>

              <PrimaryButton onClick={() => setStep("profile")} className="mt-6">다음</PrimaryButton>
            </section>
          )}

          {step === "profile" && (
            <section className="animate-[slideUp_0.35s_ease]" aria-labelledby="profile-title">
              <StepHeading
                eyebrow="04 · PROFILE"
                title="어떤 친구가 잘 맞을까요?"
                description="최소한만 알려주면 성향이 맞는 친구 두 명을 소개할게요."
                id="profile-title"
              />

              <ChoiceGroup label="연령대">
                {AGE_BANDS.map((item) => (
                  <ChoiceChip key={item.id} selected={ageBand === item.id} onClick={() => setAgeBand(item.id)}>
                    {item.label}
                  </ChoiceChip>
                ))}
              </ChoiceGroup>

              <ChoiceGroup label="직업">
                {OCCUPATIONS.map((item) => (
                  <ChoiceChip key={item.id} selected={occupation === item.id} onClick={() => setOccupation(item.id)}>
                    {item.label}
                  </ChoiceChip>
                ))}
              </ChoiceGroup>

              <ChoiceGroup label={`관심사 3개 (${interests.length}/3)`}>
                {INTEREST_TAGS.map((item) => (
                  <ChoiceChip key={item.id} selected={interests.includes(item.id)} onClick={() => toggleInterest(item.id)}>
                    {item.emoji} {item.label}
                  </ChoiceChip>
                ))}
              </ChoiceGroup>

              <ChoiceGroup label="영어를 배우는 이유">
                {GOALS.map((item) => (
                  <ChoiceChip key={item.id} selected={goal === item.id} onClick={() => setGoal(item.id)}>
                    {item.label}
                  </ChoiceChip>
                ))}
              </ChoiceGroup>

              <ChoiceGroup label="원하는 대화 스타일">
                {STYLES.map((item) => (
                  <ChoiceChip key={item.id} selected={style === item.id} onClick={() => setStyle(item.id)}>
                    {item.label}
                  </ChoiceChip>
                ))}
              </ChoiceGroup>

              <PrimaryButton
                onClick={() => {
                  if (!profile) return;
                  setStep("match");
                  void loadMatches(profile);
                }}
                disabled={!profile}
                className="mt-7"
              >
                {profile ? "친구 찾기" : "5가지를 모두 골라주세요"}
              </PrimaryButton>
            </section>
          )}

          {step === "match" && (
            <section className="animate-[slideUp_0.35s_ease]" aria-labelledby="match-title">
              <StepHeading
                eyebrow="05 · FRIENDS"
                title="이 두 사람과 잘 맞아요"
                description="한 번에 두 명만 소개해요. 대화해 보고 안 맞으면 언제든 바꿀 수 있어요."
                id="match-title"
              />

              {matchStatus === "loading" && (
                <p className="mt-6 text-center text-[13px] text-white/45" role="status">궁합을 계산하는 중이에요.</p>
              )}

              {matchStatus === "ready" && matches.length > 0 && (
                <div className="mt-6 overflow-hidden rounded-[24px] border border-white/[0.09] bg-white/[0.05] divide-y divide-white/[0.08]">
                  {matches.map((match) => (
                    <div key={match.id} className="flex min-h-24 w-full items-center gap-3.5 px-4 py-4 text-left">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={match.profileImage}
                        alt={`${match.koName} 프로필`}
                        className="h-14 w-14 shrink-0 rounded-full object-cover ring-1 ring-white/15"
                        style={{ boxShadow: `0 0 0 2px ${match.color}55` }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-baseline gap-2">
                          <strong className="shrink-0 whitespace-nowrap text-[15px] font-semibold">{match.koName}</strong>
                          <span className="min-w-0 truncate text-[10px] text-white/38">{match.nationality} · {match.job}</span>
                        </span>
                        <span className="mt-1 line-clamp-2 block text-[12px] leading-relaxed text-white/52">{match.bio}</span>
                        {match.reasons.length > 0 && (
                          <span className="mt-2 flex flex-wrap gap-1.5">
                            {match.reasons.slice(0, 3).map((reason) => (
                              <span key={reason} className="rounded-full bg-white/[0.08] px-2 py-1 text-[10px] text-white/55">
                                {reason}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-right">
                        <strong className="block text-[16px] font-semibold text-[var(--apple-blue)]">{match.score}</strong>
                        <small className="block text-[9px] text-white/35">궁합</small>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {matchStatus === "error" && (
                <div className="mt-5 rounded-2xl border border-[var(--apple-red)]/20 bg-[var(--apple-red)]/[0.08] p-4 text-center" role="alert">
                  <p className="text-[12px] text-[#ffaaa4]">궁합을 계산하지 못했어요.</p>
                  <button
                    type="button"
                    onClick={() => profile && void loadMatches(profile)}
                    className="mt-2 min-h-11 px-4 text-[13px] font-semibold text-white"
                  >
                    다시 시도
                  </button>
                </div>
              )}

              <PrimaryButton onClick={() => void complete()} disabled={completing || matchStatus === "loading"} className="mt-7">
                {completing ? "연결하는 중…" : "대화 시작하기"}
              </PrimaryButton>
              <button
                type="button"
                onClick={() => setStep("profile")}
                disabled={completing}
                className="mx-auto mt-4 block min-h-11 px-4 text-[13px] font-medium text-white/40 transition hover:text-white/65 disabled:opacity-30"
              >
                프로필 다시 고르기
              </button>
              {completeError && <p className="mt-4 text-center text-[12px] text-[#ffaaa4]" role="alert">{completeError}</p>}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function ChoiceGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="mt-6">
      <legend className="mb-2.5 text-[12px] font-semibold text-white/45">{label}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

function ChoiceChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`min-h-11 rounded-full border px-3.5 text-[13px] transition active:scale-95 ${
        selected
          ? "border-[var(--apple-blue)] bg-[var(--apple-blue)]/20 text-white"
          : "border-white/[0.1] bg-white/[0.05] text-white/60"
      }`}
    >
      {children}
    </button>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <section className="animate-[slideUp_0.4s_ease] text-center" aria-labelledby="welcome-title">
      <div className="mx-auto grid h-20 w-20 place-items-center rounded-[26px] border border-white/15 bg-white/[0.09] text-white shadow-[0_24px_80px_rgba(10,132,255,0.18)] backdrop-blur-xl"><ConversationIcon /></div>
      <p className="mt-8 text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--apple-blue)]">Avatar Tutor</p>
      <h1 id="welcome-title" className="mt-3 text-[34px] font-semibold leading-[1.12] tracking-[-0.05em]">
        말이 통하는<br />나만의 영어 친구
      </h1>
      <p className="mx-auto mt-4 max-w-[280px] text-[14px] leading-relaxed text-white/52">내 말을 듣고, 기다리고, 자연스럽게 이어가는 회화 연습.</p>
      <PrimaryButton onClick={onNext} className="mt-10">시작하기</PrimaryButton>
      <p className="mt-3 text-[11px] text-white/30">약 1분이면 준비가 끝나요</p>
    </section>
  );
}

function StepHeading({ eyebrow, title, description, id }: { eyebrow: string; title: string; description: string; id: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--apple-blue)]">{eyebrow}</p>
      <h1 id={id} tabIndex={-1} className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.04em] outline-none">{title}</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-white/48">{description}</p>
    </div>
  );
}

function PrimaryButton({ children, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`apple-primary-button flex min-h-13 w-full items-center justify-center rounded-2xl bg-[var(--apple-blue)] px-5 text-[15px] font-semibold text-white shadow-[0_10px_26px_rgba(10,132,255,0.23)] transition active:scale-[0.98] disabled:opacity-35 ${className}`}
    >
      {children}
    </button>
  );
}

function VoiceBars({ level }: { level: number }) {
  return (
    <span className="flex h-4 items-center gap-0.5" aria-hidden="true">
      {[0.35, 0.65, 1, 0.6, 0.4].map((scale, index) => (
        <span key={index} className="w-0.5 rounded-full bg-[var(--apple-green)] transition-[height] duration-75" style={{ height: `${Math.max(4, 4 + level * 13 * scale)}px` }} />
      ))}
    </span>
  );
}

function ConversationIcon() {
  return <svg className="h-10 w-10 fill-none stroke-current stroke-[1.8]" viewBox="0 0 32 32" aria-hidden="true"><path d="M7.5 7.5h17a3.5 3.5 0 0 1 3.5 3.5v8a3.5 3.5 0 0 1-3.5 3.5H16l-6.5 4v-4h-2A3.5 3.5 0 0 1 4 19v-8a3.5 3.5 0 0 1 3.5-3.5Z" /><path d="M10 13h12M10 17h8" strokeLinecap="round" /></svg>;
}

function MicIcon() {
  return <svg className="h-9 w-9 fill-none stroke-current stroke-2" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="3" width="8" height="12" rx="4" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" strokeLinecap="round" /></svg>;
}

function StopIcon() {
  return <svg className="h-8 w-8 fill-current" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>;
}

function LevelIcon() {
  return <svg className="h-8 w-8 fill-none stroke-current stroke-2" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17v2M9.5 13v6M14.5 9v10M19 5v14" strokeLinecap="round" /></svg>;
}
