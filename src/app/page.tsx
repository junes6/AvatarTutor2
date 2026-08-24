"use client";

// 홈 — 메신저처럼: 친구 목록 + 오늘의 목표 + 러닝 유닛 + 프리토킹 시나리오

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { sfxMessage } from "@/lib/sfx";

interface StateData {
  user: {
    onboarded: boolean;
    name: string;
    level: number;
    xp: number;
    streak: { count: number };
    dailyGoal: { reviewsDone: number; unitDone: boolean; callSeconds: number };
  };
  xp: { level: number; cur: number; next: number };
  tutors: {
    id: string;
    name: string;
    koName: string;
    emoji: string;
    color: string;
    bio: string;
    profileImage: string;
    intimacy: { level: number; xp: number; next: number | null };
    unread: number;
    lastMessage: { text: string; ts: number; role: string } | null;
  }[];
  units: { id: string; title: string; titleKo: string; order: number; completed: boolean; expressionCount: number }[];
  scenarios: { id: string; title: string; titleKo: string; image: string; descriptionKo: string }[];
  srsDueCount: number;
  mock: { llm: boolean; stt: boolean; tts: boolean };
}

export default function HomePage() {
  const router = useRouter();
  const [state, setState] = useState<StateData | null>(null);
  const [picker, setPicker] = useState<{ kind: "unit" | "scenario" | "free"; id?: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/state");
    const data: StateData = await res.json();
    if (!data.user.onboarded) {
      router.replace("/onboarding");
      return;
    }
    setState(data);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  // 능동 메시지 tick — 진입 시 + 3분마다
  useEffect(() => {
    const tick = async () => {
      try {
        const res = await fetch("/api/proactive", { method: "POST" });
        const data = await res.json();
        if (data.generated) {
          sfxMessage();
          load();
        }
      } catch {}
    };
    tick();
    const iv = setInterval(tick, 3 * 60 * 1000);
    return () => clearInterval(iv);
  }, [load]);

  if (!state) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin" />
      </div>
    );
  }

  const { user, xp, tutors, units, scenarios, srsDueCount, mock } = state;
  const goalCall = Math.min(5, Math.floor(user.dailyGoal.callSeconds / 60));
  const nextUnit = units.find((u) => !u.completed);

  return (
    <div className="pb-10">
      {/* 헤더 */}
      <header className="px-5 pt-8 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-white/40">안녕하세요 👋</div>
            <h1 className="text-xl font-bold">{user.name}님</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-center">
              <div className="text-lg font-black text-orange-400">🔥 {user.streak.count}</div>
              <div className="text-[9px] text-white/40">스트릭</div>
            </div>
            <button onClick={() => router.push("/settings")} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center">
              ⚙️
            </button>
          </div>
        </div>
        {/* XP 바 */}
        <div className="mt-4">
          <div className="flex justify-between text-[11px] text-white/50 mb-1">
            <span>Lv.{xp.level}</span>
            <span>
              {xp.cur} / {xp.next} XP
            </span>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-700" style={{ width: `${Math.min(100, (xp.cur / xp.next) * 100)}%` }} />
          </div>
        </div>
        {(mock.llm || mock.stt || mock.tts) && (
          <div className="mt-3 text-[11px] rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 px-3 py-2">
            ⚠️ 목(mock) 모드: {[mock.llm && "LLM", mock.stt && "STT", mock.tts && "TTS"].filter(Boolean).join(" · ")} API 키가 없어 시뮬레이션으로 동작해요 (.env.local 설정)
          </div>
        )}
      </header>

      {/* 오늘의 목표 */}
      <section className="px-5 mb-6">
        <h2 className="text-sm font-bold text-white/70 mb-2">오늘의 목표</h2>
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2.5">
          <GoalRow done={user.dailyGoal.reviewsDone >= Math.min(3, Math.max(1, srsDueCount))} label={`복습 ${Math.min(3, Math.max(1, srsDueCount))}개 (${user.dailyGoal.reviewsDone}개 완료${srsDueCount > 0 ? ` · ${srsDueCount}개 대기` : ""})`} />
          <GoalRow done={user.dailyGoal.unitDone} label="새 유닛 1개 클리어" />
          <GoalRow done={goalCall >= 5} label={`아무 친구와 5분 통화 (${goalCall}분)`} />
        </div>
      </section>

      {/* 친구 목록 */}
      <section className="px-5 mb-6">
        <h2 className="text-sm font-bold text-white/70 mb-2">내 친구들</h2>
        <div className="space-y-2">
          {tutors.map((t) => (
            <div key={t.id} className="rounded-2xl bg-white/5 border border-white/10 p-3 flex items-center gap-3">
              <button onClick={() => router.push(`/chat/${t.id}`)} className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={t.profileImage} alt={t.name} className="w-14 h-14 rounded-full object-cover border-2" style={{ borderColor: t.color }} />
                {t.unread > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-500 text-[11px] font-bold flex items-center justify-center">
                    {t.unread}
                  </span>
                )}
              </button>
              <button onClick={() => router.push(`/chat/${t.id}`)} className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-sm">{t.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: `${t.color}22`, color: t.color }}>
                    {"💛".repeat(t.intimacy.level)}
                  </span>
                </div>
                <div className="text-xs text-white/50 truncate mt-0.5">
                  {t.lastMessage ? (t.lastMessage.role === "user" ? "나: " : "") + t.lastMessage.text : t.bio}
                </div>
              </button>
              <button
                onClick={() => setPicker({ kind: "free", id: t.id })}
                className="shrink-0 w-11 h-11 rounded-full bg-emerald-600 flex items-center justify-center text-lg active:scale-95 transition-transform"
                aria-label={`${t.name}에게 영상통화`}
              >
                📹
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* 러닝모드 */}
      <section className="px-5 mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-white/70">러닝모드 · 초급</h2>
          {nextUnit && <span className="text-[11px] text-emerald-400">다음: {nextUnit.titleKo}</span>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {units.map((u) => (
            <button
              key={u.id}
              onClick={() => setPicker({ kind: "unit", id: u.id })}
              className={`rounded-2xl p-3.5 text-left border transition-colors ${
                u.completed ? "bg-emerald-500/10 border-emerald-500/30" : "bg-white/5 border-white/10 hover:border-white/25"
              }`}
            >
              <div className="text-[10px] text-white/40 mb-1">
                Unit {u.order} {u.completed && "✅"}
              </div>
              <div className="font-bold text-sm leading-tight">{u.titleKo}</div>
              <div className="text-[11px] text-white/50 mt-0.5">{u.title}</div>
              <div className="text-[10px] text-white/35 mt-1.5">표현 {u.expressionCount}개</div>
            </button>
          ))}
        </div>
      </section>

      {/* 프리토킹 시나리오 */}
      <section className="px-5">
        <h2 className="text-sm font-bold text-white/70 mb-2">프리토킹 · 상황극</h2>
        <div className="grid grid-cols-2 gap-2">
          {scenarios.map((s) => (
            <button
              key={s.id}
              onClick={() => setPicker({ kind: "scenario", id: s.id })}
              className="relative rounded-2xl overflow-hidden h-24 text-left border border-white/10 group"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.image} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
              <div className="absolute bottom-2 left-3">
                <div className="font-bold text-sm">{s.titleKo}</div>
                <div className="text-[10px] text-white/60">{s.title}</div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* 튜터 선택 시트 */}
      {picker && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60" onClick={() => setPicker(null)}>
          <div className="bg-slate-900 rounded-t-3xl p-5 border-t border-white/10" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold mb-1">
              {picker.kind === "unit" ? "누구랑 배울까요?" : picker.kind === "scenario" ? "누구랑 연습할까요?" : "통화 방식을 선택하세요"}
            </h3>
            <p className="text-xs text-white/50 mb-4">
              {picker.kind === "free" ? "자유 대화 또는 상황극을 고를 수 있어요" : "친구마다 목소리와 성격이 달라요"}
            </p>
            {picker.kind === "free" ? (
              <div className="space-y-2">
                <button
                  onClick={() => router.push(`/call/${picker.id}?mode=freetalk`)}
                  className="w-full rounded-2xl bg-emerald-600 p-4 text-left font-semibold"
                >
                  ☕ 그냥 수다 떨기 (프리토킹)
                </button>
                {nextUnit && (
                  <button
                    onClick={() => router.push(`/call/${picker.id}?mode=learning&unit=${nextUnit.id}`)}
                    className="w-full rounded-2xl bg-indigo-600 p-4 text-left font-semibold"
                  >
                    📚 오늘의 유닛 배우기 ({nextUnit.titleKo})
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {tutors.map((t) => (
                  <button
                    key={t.id}
                    onClick={() =>
                      router.push(
                        picker.kind === "unit"
                          ? `/call/${t.id}?mode=learning&unit=${picker.id}`
                          : `/call/${t.id}?mode=freetalk&scenario=${picker.id}`,
                      )
                    }
                    className="w-full rounded-2xl bg-white/5 border border-white/10 p-3 flex items-center gap-3 hover:border-white/30"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={t.profileImage} alt="" className="w-11 h-11 rounded-full border-2" style={{ borderColor: t.color }} />
                    <div className="text-left">
                      <div className="font-bold text-sm">
                        {t.name} {t.emoji}
                      </div>
                      <div className="text-[11px] text-white/50">{t.bio}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function GoalRow({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${done ? "bg-emerald-500" : "bg-white/10"}`}>
        {done ? "✓" : ""}
      </span>
      <span className={`text-sm ${done ? "text-white/40 line-through" : "text-white/80"}`}>{label}</span>
    </div>
  );
}
