"use client";

// 세션 리포트 — 배운 표현, 교정 카드(뒤집기), 발음 점수 추이, XP

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FlipCard } from "@/components/Cards";
import type { SessionRecord } from "@/core/types";

interface ExpressionLite {
  id: string;
  en: string;
  ko: string;
}

export default function ReportPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [expressions, setExpressions] = useState<ExpressionLite[]>([]);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/session?id=${sessionId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.session) setNotFound(true);
        else setSession(data.session as SessionRecord);
      })
      .catch(() => setNotFound(true));
  }, [sessionId]);

  // 유닛 표현 로드 (러닝모드)
  useEffect(() => {
    if (!session?.unitId) return;
    fetch(`/api/unit?id=${session.unitId}`)
      .then((r) => r.json())
      .then((data) => setExpressions(data.unit?.expressions ?? []))
      .catch(() => {});
  }, [session?.unitId]);

  if (notFound) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4">
        <div className="text-white/50">세션을 찾을 수 없어요</div>
        <button onClick={() => router.replace("/")} className="rounded-xl bg-white/10 px-5 py-2.5 text-sm">
          홈으로
        </button>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin" />
      </div>
    );
  }

  const durationMin = session.endedAt ? Math.max(1, Math.round((session.endedAt - session.startedAt) / 60000)) : 0;
  const avgScore =
    session.pronunciationScores.length > 0
      ? Math.round(session.pronunciationScores.reduce((a, b) => a + b, 0) / session.pronunciationScores.length)
      : null;
  const userTurns = session.turns.filter((t) => t.role === "user").length;

  return (
    <div className="px-5 py-8 pb-14">
      <div className="text-center">
        <div className="text-5xl mb-3">{session.mode === "learning" ? "🎓" : "☕"}</div>
        <h1 className="text-xl font-black">{session.mode === "learning" ? "유닛 세션 리포트" : "프리토킹 리포트"}</h1>
        <p className="text-xs text-white/40 mt-1">
          {durationMin}분 통화 · 내 발화 {userTurns}번
        </p>
      </div>

      {/* 요약 지표 */}
      <div className="mt-6 grid grid-cols-3 gap-2">
        <StatBox label="획득 XP" value={`+${session.xpEarned}`} accent="text-amber-300" />
        <StatBox label="교정 표현" value={String(session.corrections.length)} accent="text-emerald-300" />
        <StatBox label="발음 평균" value={avgScore !== null ? `${avgScore}점` : "—"} accent="text-indigo-300" />
      </div>

      {/* 발음 점수 추이 */}
      {session.pronunciationScores.length >= 2 && (
        <section className="mt-7">
          <h2 className="text-sm font-bold text-white/70 mb-2">발음 점수 추이</h2>
          <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
            <ScoreChart scores={session.pronunciationScores} />
          </div>
        </section>
      )}

      {/* 오늘 배운 표현 */}
      {expressions.length > 0 && (
        <section className="mt-7">
          <h2 className="text-sm font-bold text-white/70 mb-2">오늘 배운 표현</h2>
          <div className="space-y-2">
            {expressions.map((e) => (
              <div key={e.id} className="rounded-xl bg-indigo-500/10 border border-indigo-400/25 px-4 py-3">
                <div className="font-bold text-sm">{e.en}</div>
                <div className="text-xs text-white/55 mt-0.5">{e.ko}</div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-white/35 mt-2">이 표현들은 오늘 → 3일 → 7일 간격으로 복습 큐에 들어가요.</p>
        </section>
      )}

      {/* 교정 카드 */}
      {session.corrections.length > 0 && (
        <section className="mt-7">
          <h2 className="text-sm font-bold text-white/70 mb-2">이렇게 말하면 더 자연스러워요 (탭해서 뒤집기)</h2>
          <div className="space-y-2">
            {session.corrections.map((c, i) => (
              <FlipCard key={i} card={c} tutorId={session.tutorId} />
            ))}
          </div>
        </section>
      )}

      {session.corrections.length === 0 && session.mode === "freetalk" && (
        <div className="mt-7 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 p-4 text-center text-sm text-emerald-200">
          🎉 교정할 게 없었어요! 자연스러운 대화였습니다.
        </div>
      )}

      <div className="mt-9 space-y-2">
        <button onClick={() => router.replace(`/call/${session.tutorId}?mode=${session.mode}${session.unitId ? `&unit=${session.unitId}` : ""}${session.scenarioId ? `&scenario=${session.scenarioId}` : ""}`)} className="w-full rounded-2xl bg-emerald-600 py-3.5 font-bold">
          한 번 더 통화하기
        </button>
        <button onClick={() => router.replace("/")} className="w-full rounded-2xl bg-white/10 py-3.5 font-semibold text-white/80">
          홈으로
        </button>
      </div>
    </div>
  );
}

function StatBox({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-2xl bg-white/5 border border-white/10 p-3 text-center">
      <div className={`text-lg font-black ${accent}`}>{value}</div>
      <div className="text-[10px] text-white/40 mt-0.5">{label}</div>
    </div>
  );
}

function ScoreChart({ scores }: { scores: number[] }) {
  const w = 280;
  const h = 90;
  const pad = 8;
  const pts = scores.map((s, i) => {
    const x = pad + (i / Math.max(1, scores.length - 1)) * (w - pad * 2);
    const y = h - pad - (s / 100) * (h - pad * 2);
    return { x, y, s };
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      <line x1={pad} y1={h - pad - 0.7 * (h - pad * 2)} x2={w - pad} y2={h - pad - 0.7 * (h - pad * 2)} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" />
      <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="3.5" fill="#34D399" />
          <text x={p.x} y={p.y - 7} textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.6)">
            {p.s}
          </text>
        </g>
      ))}
    </svg>
  );
}
