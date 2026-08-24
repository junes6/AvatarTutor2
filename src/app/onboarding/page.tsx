"use client";

// 온보딩 — 1분 발화 레벨테스트 → 레벨 산정 → 첫 친구 선택 → 첫 메시지 수신

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useRecorder } from "@/hooks/useRecorder";
import { subscribePush } from "@/components/SWRegister";

interface TutorInfo {
  id: string;
  name: string;
  koName: string;
  emoji: string;
  color: string;
  profileImage: string;
  bio: string;
  job: string;
  nationality: string;
}

type Step = "welcome" | "name" | "leveltest" | "result" | "friend";

const PROMPTS = [
  "자기소개를 해보세요 (이름, 하는 일, 취미...)",
  "어제 하루를 이야기해 보세요",
  "좋아하는 음식에 대해 말해보세요",
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [name, setName] = useState("");
  const [level, setLevel] = useState(2);
  const [note, setNote] = useState("");
  const [tutors, setTutors] = useState<TutorInfo[]>([]);
  const [evaluating, setEvaluating] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [completing, setCompleting] = useState(false);
  const { start, stop, isRecording, level: micLevel } = useRecorder();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/state")
      .then((r) => r.json())
      .then((data) => {
        if (data.user.onboarded) router.replace("/");
        setTutors(data.tutors);
      });
  }, [router]);

  const toggleRecord = async () => {
    if (isRecording) {
      if (timerRef.current) clearInterval(timerRef.current);
      const r = await stop();
      if (!r) return;
      setEvaluating(true);
      try {
        const form = new FormData();
        form.append("audio", r.blob, "leveltest.webm");
        form.append("durationSec", String(Math.round(r.durationSec)));
        const res = await fetch("/api/onboarding", { method: "POST", body: form });
        const data = await res.json();
        setLevel(data.level ?? 2);
        setNote(data.note ?? "");
      } catch {
        setLevel(2);
        setNote("평가에 실패해 기본 레벨로 시작해요. 설정에서 언제든 조정할 수 있어요.");
      }
      setEvaluating(false);
      setStep("result");
    } else {
      const ok = await start();
      if (!ok) return;
      setSeconds(0);
      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s >= 59) toggleRecord(); // 60초 자동 종료
          return s + 1;
        });
      }, 1000);
    }
  };

  const complete = async (tutorId: string) => {
    if (completing) return;
    setCompleting(true);
    try {
      await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete", name, level, tutorId, note }),
      });
      subscribePush().catch(() => {}); // 푸시는 선택 — 거절해도 진행
      router.replace(`/chat/${tutorId}`);
    } catch {
      setCompleting(false);
      alert("잠시 문제가 생겼어요. 다시 시도해 주세요.");
    }
  };

  return (
    <div className="min-h-dvh flex flex-col justify-center px-6 py-10">
      {step === "welcome" && (
        <div className="text-center animate-[slideUp_0.4s_ease]">
          <div className="text-6xl mb-6">🎧</div>
          <h1 className="text-2xl font-black leading-snug">
            영어가 늘려면
            <br />
            <span className="text-emerald-400">영어로 사는 친구</span>가 필요해요
          </h1>
          <p className="mt-4 text-sm text-white/50 leading-relaxed">
            튜터 친구 3명과 채팅하고, 영상통화하고,
            <br />
            매일 조금씩 진짜 회화를 배워요.
          </p>
          <button onClick={() => setStep("name")} className="mt-10 w-full rounded-2xl bg-emerald-600 py-4 font-bold text-lg active:scale-[0.98] transition-transform">
            시작하기
          </button>
        </div>
      )}

      {step === "name" && (
        <div className="animate-[slideUp_0.4s_ease]">
          <h2 className="text-xl font-bold">뭐라고 불러드릴까요?</h2>
          <p className="text-sm text-white/50 mt-1">친구들이 이 이름으로 불러요.</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && setStep("leveltest")}
            placeholder="이름 또는 닉네임"
            autoFocus
            className="mt-6 w-full rounded-2xl bg-white/10 px-5 py-4 text-lg outline-none focus:ring-2 ring-emerald-500 placeholder:text-white/25"
          />
          <button
            onClick={() => setStep("leveltest")}
            disabled={!name.trim()}
            className="mt-6 w-full rounded-2xl bg-emerald-600 py-4 font-bold disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}

      {step === "leveltest" && (
        <div className="text-center animate-[slideUp_0.4s_ease]">
          <h2 className="text-xl font-bold">1분 말하기 레벨테스트</h2>
          <p className="text-sm text-white/50 mt-2 leading-relaxed">
            아래 주제로 영어로 편하게 말해보세요.
            <br />
            문법이 틀려도 전혀 괜찮아요!
          </p>
          <div className="mt-5 space-y-2 text-left">
            {PROMPTS.map((p, i) => (
              <div key={i} className="rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white/70">
                {i + 1}. {p}
              </div>
            ))}
          </div>
          <button
            onClick={toggleRecord}
            disabled={evaluating}
            className={`mt-8 w-28 h-28 rounded-full mx-auto flex flex-col items-center justify-center transition-all ${
              isRecording ? "bg-red-500 scale-110" : "bg-emerald-600"
            }`}
            style={isRecording ? { boxShadow: `0 0 ${20 + micLevel * 40}px rgba(239,68,68,0.6)` } : {}}
          >
            {evaluating ? (
              <div className="w-8 h-8 border-3 border-white/30 border-t-white rounded-full animate-spin" />
            ) : isRecording ? (
              <>
                <span className="text-2xl">⏹</span>
                <span className="text-xs mt-1 tabular-nums">{seconds}s / 60s</span>
              </>
            ) : (
              <>
                <span className="text-3xl">🎤</span>
                <span className="text-xs mt-1">탭해서 시작</span>
              </>
            )}
          </button>
          <p className="mt-3 text-xs text-white/40">{evaluating ? "평가 중..." : isRecording ? "다 말했으면 탭해서 종료" : ""}</p>
          <button onClick={() => { setLevel(2); setNote(""); setStep("result"); }} className="mt-6 text-sm text-white/40 underline">
            건너뛰기 (기본 레벨 2로 시작)
          </button>
        </div>
      )}

      {step === "result" && (
        <div className="text-center animate-[slideUp_0.4s_ease]">
          <div className="text-5xl mb-4">🎯</div>
          <h2 className="text-xl font-bold">
            당신의 레벨은 <span className="text-emerald-400">Lv.{level}</span>
          </h2>
          <div className="mt-3 flex justify-center gap-1.5">
            {[1, 2, 3, 4, 5].map((l) => (
              <div key={l} className={`w-10 h-2.5 rounded-full ${l <= level ? "bg-emerald-500" : "bg-white/15"}`} />
            ))}
          </div>
          {note && <p className="mt-4 text-sm text-white/60 leading-relaxed">{note}</p>}
          <p className="mt-2 text-xs text-white/35">튜터들이 이 레벨에 맞는 어휘와 속도로 말해줘요.</p>
          <button onClick={() => setStep("friend")} className="mt-8 w-full rounded-2xl bg-emerald-600 py-4 font-bold">
            첫 친구 만나러 가기
          </button>
        </div>
      )}

      {step === "friend" && (
        <div className="animate-[slideUp_0.4s_ease]">
          <h2 className="text-xl font-bold">첫 친구를 선택하세요</h2>
          <p className="text-sm text-white/50 mt-1">선택하면 바로 첫 메시지가 도착해요. 나머지 친구들과도 언제든 대화할 수 있어요.</p>
          <div className="mt-6 space-y-3">
            {tutors.map((t) => (
              <button
                key={t.id}
                onClick={() => complete(t.id)}
                disabled={completing}
                className="w-full rounded-2xl bg-white/5 border border-white/10 p-4 flex items-center gap-4 hover:border-white/30 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={t.profileImage} alt="" className="w-16 h-16 rounded-full border-2" style={{ borderColor: t.color }} />
                <div className="text-left flex-1">
                  <div className="font-bold">
                    {t.name} {t.emoji}
                  </div>
                  <div className="text-[11px] text-white/45 mt-0.5">
                    {t.nationality} · {t.job}
                  </div>
                  <div className="text-xs text-white/60 mt-1">{t.bio}</div>
                </div>
              </button>
            ))}
          </div>
          {completing && <div className="mt-4 text-center text-sm text-white/50 animate-pulse">친구에게 알리는 중...</div>}
        </div>
      )}
    </div>
  );
}
