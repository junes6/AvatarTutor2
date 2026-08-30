"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FlipCard } from "@/components/Cards";
import KakaoBridgeButton from "@/components/KakaoBridgeButton";
import type { SessionRecord } from "@/core/types";
import { getReportDurationLabel, getReportExpressions, isReportSessionComplete } from "@/lib/reportPresentation";

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
  const [tutorName, setTutorName] = useState("영어 친구");
  const [loadIssue, setLoadIssue] = useState<"not-found" | "load-failed" | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    fetch(`/api/session?id=${encodeURIComponent(sessionId)}`)
      .then((response) => {
        if (response.status === 404) throw new Error("not-found");
        if (!response.ok) throw new Error("load-failed");
        return response.json();
      })
      .then((data) => {
        if (!active) return;
        if (!data.session) setLoadIssue("not-found");
        else setSession(data.session as SessionRecord);
      })
      .catch((error: unknown) => {
        if (active) setLoadIssue(error instanceof Error && error.message === "not-found" ? "not-found" : "load-failed");
      });
    return () => { active = false; };
  }, [sessionId, reloadKey]);

  useEffect(() => {
    if (!session) return;
    fetch("/api/state")
      .then((response) => response.json())
      .then((data) => {
        const tutor = data.tutors?.find((item: { id: string }) => item.id === session.tutorId);
        if (tutor?.koName) setTutorName(tutor.koName);
      })
      .catch(() => {});
  }, [session]);

  useEffect(() => {
    if (!session?.unitId) return;
    fetch(`/api/unit?id=${encodeURIComponent(session.unitId)}`)
      .then((response) => response.json())
      .then((data) => setExpressions(data.unit?.expressions ?? []))
      .catch(() => setExpressions([]));
  }, [session?.unitId]);

  const retryLoad = () => {
    setLoadIssue(null);
    setSession(null);
    setExpressions([]);
    setReloadKey((value) => value + 1);
  };

  if (loadIssue) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#07080c] px-6 text-white">
        <div className="w-full max-w-xs text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-white/[0.07] text-white/45"><DocumentIcon /></div>
          <h1 className="mt-4 text-[18px] font-semibold">{loadIssue === "not-found" ? "리포트를 찾을 수 없어요" : "리포트를 불러오지 못했어요"}</h1>
          <p className="mt-2 text-[13px] text-white/42">
            {loadIssue === "not-found" ? "이미 정리된 기록이거나 주소가 올바르지 않아요." : "연결을 확인하고 잠시 뒤 다시 시도해 주세요."}
          </p>
          <button type="button" onClick={retryLoad} className="apple-primary-button mt-5 min-h-12 w-full rounded-2xl bg-[var(--apple-blue)] text-[14px] font-semibold">다시 시도</button>
          <button type="button" onClick={() => router.replace("/")} className="mt-2 min-h-11 w-full text-[13px] font-medium text-white/50">홈으로</button>
        </div>
      </main>
    );
  }

  if (!session) return <PageLoading />;

  const durationLabel = getReportDurationLabel(session);
  const avgScore = session.pronunciationScores.length > 0
    ? Math.round(session.pronunciationScores.reduce((sum, score) => sum + score, 0) / session.pronunciationScores.length)
    : null;
  const userTurns = session.turns.filter((turn) => turn.role === "user").length;
  const learningDone = session.mode === "learning" && session.stageState?.stage === "done";
  const sessionCompleted = isReportSessionComplete(session);
  const reviewExpressions = session.stageState?.reviewItems.map((item) => ({
    id: item.expressionId,
    en: item.en,
    ko: item.ko,
  })) ?? [];
  const reviewIds = new Set(reviewExpressions.map((expression) => expression.id));
  const expressionPool = learningDone
    ? expressions
    : [...reviewExpressions, ...expressions.filter((expression) => !reviewIds.has(expression.id))];
  const reportExpressions = getReportExpressions(session, expressionPool, expressions);
  const modeLabel = session.mode === "learning" ? "표현 학습" : session.scenarioId ? "상황 연습" : "프리토킹";
  const sessionDate = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(session.startedAt);
  const retryHref = `/call/${session.tutorId}?mode=${session.mode}${session.unitId ? `&unit=${session.unitId}` : ""}${session.scenarioId ? `&scenario=${session.scenarioId}` : ""}`;
  const shareText = [
    sessionCompleted
      ? `아바타튜터에서 ${modeLabel}을 완료했어요.`
      : `아바타튜터에서 ${modeLabel} 기록을 남겼어요.`,
    `${durationLabel} 동안 ${userTurns}번 말하고 ${session.xpEarned} XP를 얻었습니다.`,
    avgScore !== null ? `발음 평균은 ${avgScore}점이에요.` : "",
  ].filter(Boolean).join(" ");

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#07080c] text-white">
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-[390px] ${sessionCompleted ? "bg-[radial-gradient(circle_at_50%_-20%,rgba(48,209,88,0.2),transparent_66%)]" : "bg-[radial-gradient(circle_at_50%_-20%,rgba(10,132,255,0.18),transparent_66%)]"}`} />
      <div className="relative mx-auto w-full max-w-[430px] px-5 pb-[max(32px,env(safe-area-inset-bottom))] pt-[max(14px,env(safe-area-inset-top))]">
        <header className="flex min-h-12 items-center justify-between">
          <button type="button" onClick={() => router.replace("/")} className="grid h-11 w-11 place-items-center rounded-full bg-white/[0.07] text-white/70 transition active:scale-95" aria-label="홈으로 돌아가기"><CloseIcon /></button>
          <h1 className="text-[15px] font-semibold text-white/72">학습 리포트</h1>
          <div className="h-11 w-11" aria-hidden="true" />
        </header>

        <section className="pb-1 pt-7 text-center" aria-labelledby="report-title">
          <div className={`mx-auto grid h-16 w-16 place-items-center rounded-full ring-1 ${sessionCompleted ? "bg-[var(--apple-green)]/15 text-[var(--apple-green)] ring-[var(--apple-green)]/20" : "bg-[var(--apple-blue)]/15 text-[var(--apple-blue)] ring-[var(--apple-blue)]/20"}`}>
            {sessionCompleted ? <CheckCircleIcon /> : <DocumentIcon />}
          </div>
          <p className={`mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] ${sessionCompleted ? "text-[var(--apple-green)]" : "text-[var(--apple-blue)]"}`}>
            {sessionCompleted ? "Session complete" : "Practice saved"}
          </p>
          <h2 id="report-title" className="mt-2 text-[30px] font-semibold tracking-[-0.045em]">
            {sessionCompleted ? "오늘도 잘했어요" : userTurns > 0 ? "여기까지 연습했어요" : "이번 연습은 여기서 마쳤어요"}
          </h2>
          <p className="mt-2 text-[13px] text-white/42">{sessionDate} · {modeLabel} · {durationLabel}</p>
        </section>

        <section className="mt-7 overflow-hidden rounded-[24px] border border-white/[0.09] bg-white/[0.055]" aria-label="세션 요약">
          <div className="grid grid-cols-3 divide-x divide-white/[0.08] py-4">
            <Stat label="획득 XP" value={`+${session.xpEarned}`} color="text-[#ffd60a]" />
            <Stat label="내 발화" value={`${userTurns}회`} color="text-white" />
            <Stat label="발음 평균" value={avgScore !== null ? `${avgScore}점` : "—"} color="text-[var(--apple-green)]" />
          </div>
        </section>

        {session.pronunciationScores.length >= 2 && (
          <ReportSection title="발음 흐름" caption="말할수록 어떻게 달라졌는지 확인해요">
            <div className="rounded-[20px] border border-white/[0.075] bg-white/[0.04] p-4">
              <ScoreChart scores={session.pronunciationScores} />
            </div>
          </ReportSection>
        )}

        {reportExpressions.length > 0 && (
          <ReportSection
            title="오늘의 표현"
            caption={learningDone ? `${reportExpressions.length}개를 복습 큐에 담았어요` : `이번에 다룬 ${reportExpressions.length}개 표현이에요`}
          >
            <div className="overflow-hidden rounded-[20px] border border-white/[0.08] bg-white/[0.045] divide-y divide-white/[0.075]">
              {reportExpressions.map((expression, index) => (
                <div key={expression.id} className="flex gap-3 px-4 py-3.5">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-[var(--apple-blue)]/13 text-[10px] font-semibold text-[var(--apple-blue)]">{index + 1}</span>
                  <div className="min-w-0">
                    <div className="break-words text-[14px] font-semibold leading-snug">{expression.en}</div>
                    <div className="mt-1 break-words text-[11px] leading-relaxed text-white/43">{expression.ko}</div>
                  </div>
                </div>
              ))}
            </div>
          </ReportSection>
        )}

        {session.corrections.length > 0 && (
          <ReportSection title="더 자연스럽게" caption="카드를 눌러 이유를 확인해 보세요">
            <div className="space-y-2.5">
              {session.corrections.map((correction, index) => <FlipCard key={`${correction.original}-${index}`} card={correction} tutorId={session.tutorId} />)}
            </div>
          </ReportSection>
        )}

        {session.corrections.length === 0 && session.mode === "freetalk" && userTurns > 0 && (
          <section className="mt-7 flex items-start gap-3 rounded-[20px] border border-[var(--apple-green)]/20 bg-[var(--apple-green)]/[0.08] p-4" aria-label="교정 결과">
            <span className="mt-0.5 text-[var(--apple-green)]"><SmallCheckIcon /></span>
            <div>
              <h2 className="text-[14px] font-semibold">자연스러운 대화였어요</h2>
              <p className="mt-1 text-[12px] leading-relaxed text-white/47">이번 대화에서는 바로 고칠 표현이 없었습니다.</p>
            </div>
          </section>
        )}

        <section className="mt-8" aria-labelledby="share-title">
          <div className="rounded-[22px] border border-white/[0.08] bg-white/[0.05] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="share-title" className="text-[14px] font-semibold">오늘의 기록 공유</h2>
                <p className="mt-1 text-[11px] text-white/38">점수와 학습량만 안전하게 공유해요.</p>
              </div>
              <ShareIcon />
            </div>
            <div className="mt-3 [&>div]:w-full [&_button]:min-h-11 [&_button]:w-full [&_button]:justify-center [&_button]:rounded-xl">
              <KakaoBridgeButton tutorName={tutorName} shareText={shareText} />
            </div>
          </div>
        </section>

        <div className="mt-8 space-y-2.5">
          <button type="button" onClick={() => router.replace(retryHref)} className="apple-primary-button flex min-h-13 w-full items-center justify-center rounded-2xl bg-[var(--apple-blue)] px-5 text-[15px] font-semibold shadow-[0_10px_26px_rgba(10,132,255,0.2)] transition active:scale-[0.98]">
            한 번 더 연습
          </button>
          <button type="button" onClick={() => router.replace("/")} className="min-h-13 w-full rounded-2xl bg-white/[0.07] text-[14px] font-semibold text-white/72 transition active:scale-[0.98] active:bg-white/[0.11]">
            홈으로
          </button>
        </div>
      </div>
    </main>
  );
}

function PageLoading() {
  return <div className="grid min-h-dvh place-items-center bg-[#07080c]"><div className="apple-loader" role="status" aria-label="리포트 불러오는 중" /></div>;
}

function ReportSection({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <section className="mt-8" aria-label={title}>
      <div className="mb-3 px-0.5">
        <h2 className="text-[17px] font-semibold tracking-[-0.02em]">{title}</h2>
        <p className="mt-0.5 text-[11px] text-white/38">{caption}</p>
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="px-2 text-center">
      <div className={`text-[19px] font-semibold tabular-nums tracking-[-0.03em] ${color}`}>{value}</div>
      <div className="mt-1 text-[10px] font-medium text-white/35">{label}</div>
    </div>
  );
}

function ScoreChart({ scores }: { scores: number[] }) {
  const width = 300;
  const height = 104;
  const horizontalPadding = 14;
  const topPadding = 15;
  const bottomPadding = 18;
  const points = scores.map((score, index) => {
    const x = horizontalPadding + (index / Math.max(1, scores.length - 1)) * (width - horizontalPadding * 2);
    const y = topPadding + ((100 - score) / 100) * (height - topPadding - bottomPadding);
    return { x, y, score };
  });
  const label = `발음 점수 ${scores.join("점, ")}점`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible" role="img" aria-label={label}>
      <title>{label}</title>
      {[50, 75, 100].map((guide) => {
        const y = topPadding + ((100 - guide) / 100) * (height - topPadding - bottomPadding);
        return <line key={guide} x1={horizontalPadding} y1={y} x2={width - horizontalPadding} y2={y} stroke="rgba(255,255,255,.075)" strokeWidth="1" />;
      })}
      <polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="var(--apple-green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((point, index) => (
        <g key={`${point.x}-${index}`}>
          <circle cx={point.x} cy={point.y} r="4" fill="#07080c" stroke="var(--apple-green)" strokeWidth="2.5" />
          <text x={point.x} y={height - 2} textAnchor="middle" fontSize="9" fill="rgba(255,255,255,.42)">{point.score}</text>
        </g>
      ))}
    </svg>
  );
}

function CloseIcon() {
  return <svg className="h-5 w-5 fill-none stroke-current stroke-2" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" /></svg>;
}

function CheckCircleIcon() {
  return <svg className="h-8 w-8 fill-none stroke-current stroke-2" viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 12.2 3.5 3.5 7.8-8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function SmallCheckIcon() {
  return <svg className="h-5 w-5 fill-none stroke-current stroke-2" viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10.2 3.2 3.2 7.5-7.3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function ShareIcon() {
  return <svg className="h-5 w-5 fill-none stroke-white/30 stroke-[1.7]" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 13V3m0 0L6.5 6.5M10 3l3.5 3.5M5 10v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function DocumentIcon() {
  return <svg className="h-6 w-6 fill-none stroke-current stroke-[1.8]" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7V3Z" strokeLinejoin="round" /><path d="M14 3v5h4M10 12h5m-5 4h5" strokeLinecap="round" /></svg>;
}
