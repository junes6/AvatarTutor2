"use client";

/* eslint-disable @next/next/no-img-element */

// 마이페이지 — 레벨·복습·리포트와 학습 진입점. 학습 데이터는 친구가 아니라 계정에 붙는다.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import TabBar from "@/components/TabBar";
import RoleplayBriefingSheet from "@/components/RoleplayBriefingSheet";
import { showToast } from "@/components/Toast";
import { interestLabel } from "@/core/tags";
import type { LearnerProfile, RoleplayBriefing, Scenario } from "@/core/types";

interface FriendSummary {
  id: string;
  koName: string;
  emoji: string;
  color: string;
  profileImage: string;
  bio: string;
  intimacy: { level: number; xp: number; next: number | null };
  status: "active" | "left";
  city: string;
  travelling: boolean;
}

interface MeState {
  user: {
    name: string;
    level: number;
    xp: number;
    streak: { count: number };
    dailyGoal: { reviewsDone: number; unitDone: boolean; callSeconds: number };
    completedUnits: string[];
  };
  profile: LearnerProfile | null;
  xp: { level: number; cur: number; next: number };
  friends: FriendSummary[];
  archivedFriends: FriendSummary[];
  units: { id: string; titleKo: string; order: number; level: number; expressionCount: number; completed: boolean }[];
  recommendedUnitId: string | null;
  scenarios: Scenario[];
  srsDueCount: number;
  learningProgress?: {
    weeklySessions: number;
    weeklySpeakingTurns: number;
    practicedExpressions: number;
    averagePronunciation: number | null;
    pronunciationTrend: number | null;
    practiceMinutes: number;
  };
}

const LEVEL_LABELS = ["입문", "초급", "중급", "중상급", "고급"];

export default function MePage() {
  return (
    <Suspense fallback={<div className="min-h-dvh grid place-items-center"><div className="apple-loader" /></div>}>
      <MeContent />
    </Suspense>
  );
}

function MeContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [state, setState] = useState<MeState | null>(null);
  const [catalog, setCatalog] = useState<"scenario" | "unit" | null>(null);
  const [briefing, setBriefing] = useState<RoleplayBriefing | null>(null);
  const [pendingScenario, setPendingScenario] = useState<string | null>(null);
  const [pickTutorFor, setPickTutorFor] = useState<{ kind: "scenario" | "unit" | "free"; id?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      const data = (await response.json()) as MeState;
      setState(data);
    } catch {
      showToast("정보를 불러오지 못했어요.", "error");
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void load());
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  // 채팅방 메뉴에서 "상황극 시작"으로 들어온 경우
  const roleplayParam = params.get("roleplay");
  useEffect(() => {
    if (!roleplayParam) return;
    const frame = window.requestAnimationFrame(() => setCatalog("scenario"));
    return () => window.cancelAnimationFrame(frame);
  }, [roleplayParam]);

  const openBriefing = useCallback(async (scenarioId: string) => {
    setPendingScenario(scenarioId);
    try {
      const response = await fetch(`/api/roleplay?scenario=${encodeURIComponent(scenarioId)}`);
      const data = await response.json();
      if (!response.ok || !data.briefing) throw new Error("briefing failed");
      setBriefing(data.briefing as RoleplayBriefing);
      setCatalog(null);
    } catch {
      showToast("상황을 불러오지 못했어요.", "error");
      setPendingScenario(null);
    }
  }, []);

  const levelLabel = useMemo(() => {
    if (!state) return "";
    const index = Math.max(0, Math.min(LEVEL_LABELS.length - 1, Math.round(state.user.level) - 1));
    return LEVEL_LABELS[index];
  }, [state]);

  if (!state) {
    return (
      <div className="min-h-dvh grid place-items-center">
        <div className="apple-loader" role="status" aria-label="불러오는 중" />
      </div>
    );
  }

  const progress = state.learningProgress;
  const goalStates = [
    state.user.dailyGoal.reviewsDone >= Math.min(3, Math.max(1, state.srsDueCount)),
    state.user.dailyGoal.unitDone,
    state.user.dailyGoal.callSeconds >= 300,
  ];
  const preselectedTutor = roleplayParam;

  return (
    <main className="me-screen">
      <header className="list-topbar">
        <h1>마이</h1>
        <button type="button" className="icon-button" aria-label="설정" onClick={() => router.push("/settings")}>
          <GearIcon />
        </button>
      </header>

      <div className="list-scroll">
        <section className="me-hero">
          <div className="me-hero-top">
            <div>
              <strong>{state.user.name || "학습자"}님</strong>
              <span>회화 {levelLabel} · 🔥 {state.user.streak.count}일 연속</span>
            </div>
            <div className="me-level-badge">Lv.{state.xp.level}</div>
          </div>
          <div className="me-xp-bar" role="img" aria-label={`XP ${state.xp.cur} / ${state.xp.next}`}>
            <i style={{ width: `${Math.min(100, (state.xp.cur / Math.max(1, state.xp.next)) * 100)}%` }} />
          </div>
          <div className="me-goals">
            오늘 목표 {goalStates.filter(Boolean).length}/3
            <span className="me-goal-dots" aria-hidden="true">
              {goalStates.map((done, index) => <i key={index} className={done ? "is-done" : ""} />)}
            </span>
          </div>
        </section>

        <section className="me-actions">
          <button type="button" onClick={() => setPickTutorFor({ kind: "free" })}>
            <span className="me-action-glyph is-blue"><ChatIcon /></span>
            <span><strong>자유 대화</strong><small>친구와 편하게</small></span>
          </button>
          <button type="button" onClick={() => setCatalog("scenario")}>
            <span className="me-action-glyph is-orange"><RoleIcon /></span>
            <span><strong>상황극</strong><small>8종 전부 열림</small></span>
          </button>
          <button type="button" onClick={() => setCatalog("unit")}>
            <span className="me-action-glyph is-purple"><BookIcon /></span>
            <span><strong>표현 학습</strong><small>단계별 말하기</small></span>
          </button>
          <button
            type="button"
            disabled={!state.recommendedUnitId}
            onClick={() => state.recommendedUnitId && setPickTutorFor({ kind: "unit", id: state.recommendedUnitId })}
          >
            <span className="me-action-glyph is-green"><RepeatIcon /></span>
            <span><strong>복습 {state.srsDueCount > 0 ? state.srsDueCount : ""}</strong><small>기억 굳히기</small></span>
          </button>
        </section>

        {progress && (
          <section className="me-panel">
            <h2>이번 주 기록</h2>
            <div className="me-stats">
              <span><strong>{progress.weeklySessions}</strong>번 연습</span>
              <span><strong>{progress.weeklySpeakingTurns}</strong>문장</span>
              <span><strong>{progress.practicedExpressions}</strong>표현</span>
              <span>
                <strong>{progress.averagePronunciation ?? "—"}</strong>발음
                {progress.pronunciationTrend ? <small>{progress.pronunciationTrend > 0 ? "↑" : "↓"}{Math.abs(progress.pronunciationTrend)}</small> : null}
              </span>
            </div>
            <p className="me-note">누적 {progress.practiceMinutes}분 · 학습 기록은 친구가 바뀌어도 그대로 남아요.</p>
          </section>
        )}

        {state.profile && (
          <section className="me-panel">
            <h2>내 프로필</h2>
            <div className="me-tags">
              <span>{state.profile.ageBand}</span>
              <span>{occupationLabel(state.profile.occupation)}</span>
              <span>{goalLabel(state.profile.goal)}</span>
              <span>{state.profile.style === "calm" ? "차분한 대화" : "활발한 대화"}</span>
              {state.profile.interests.map((interest) => (
                <span key={interest}>{interestLabel(interest)}</span>
              ))}
            </div>
            <p className="me-note">이 정보로 친구를 매칭해요. 대화 반응에 따라 궁합이 계속 조정됩니다.</p>
          </section>
        )}

        <section className="me-panel">
          <h2>내 친구</h2>
          <div className="me-friends">
            {state.friends.map((friend) => (
              <button key={friend.id} type="button" onClick={() => router.push(`/chat/${friend.id}`)}>
                <img src={friend.profileImage} alt="" />
                <strong>{friend.koName}</strong>
                <small>친밀도 {friend.intimacy.level}</small>
              </button>
            ))}
          </div>
          {state.archivedFriends.length > 0 && (
            <p className="me-note">보관된 대화 {state.archivedFriends.length}개는 홈 목록 아래에서 다시 열 수 있어요.</p>
          )}
        </section>
      </div>

      <TabBar />

      {catalog === "scenario" && (
        <CatalogSheet
          title="상황극"
          description="상황을 고르면 브리핑을 먼저 보여드려요."
          onClose={() => setCatalog(null)}
          items={state.scenarios.map((scenario) => ({
            id: scenario.id,
            title: scenario.titleKo,
            subtitle: scenario.descriptionKo,
            image: scenario.image,
          }))}
          onSelect={(id) => void openBriefing(id)}
        />
      )}

      {catalog === "unit" && (
        <CatalogSheet
          title="표현 학습"
          description="내 수준에 맞는 표현을 짧게 익히고 바로 말해요."
          onClose={() => setCatalog(null)}
          items={state.units.map((unit) => ({
            id: unit.id,
            title: unit.titleKo,
            subtitle: `레벨 ${unit.level} · 표현 ${unit.expressionCount}개${unit.completed ? " · 완료" : ""}`,
            index: String(unit.order).padStart(2, "0"),
          }))}
          onSelect={(id) => {
            setCatalog(null);
            setPickTutorFor({ kind: "unit", id });
          }}
        />
      )}

      {briefing && (
        <RoleplayBriefingSheet
          briefing={briefing}
          tutorId={preselectedTutor ?? state.friends[0]?.id ?? ""}
          onClose={() => {
            setBriefing(null);
            setPendingScenario(null);
          }}
          onReady={() => {
            const scenarioId = pendingScenario;
            setBriefing(null);
            setPendingScenario(null);
            if (preselectedTutor) {
              router.push(`/call/${preselectedTutor}?mode=freetalk&scenario=${scenarioId}`);
            } else {
              setPickTutorFor({ kind: "scenario", id: scenarioId ?? undefined });
            }
          }}
        />
      )}

      {pickTutorFor && (
        <TutorPickSheet
          friends={state.friends}
          onClose={() => setPickTutorFor(null)}
          onPick={(tutorId) => {
            const href =
              pickTutorFor.kind === "unit"
                ? `/call/${tutorId}?mode=learning&unit=${pickTutorFor.id}`
                : pickTutorFor.kind === "scenario"
                  ? `/call/${tutorId}?mode=freetalk&scenario=${pickTutorFor.id}`
                  : `/call/${tutorId}?mode=freetalk`;
            router.push(href);
          }}
        />
      )}
    </main>
  );
}

function CatalogSheet({
  title,
  description,
  items,
  onClose,
  onSelect,
}: {
  title: string;
  description: string;
  items: { id: string; title: string; subtitle: string; image?: string; index?: string }[];
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="catalog-sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" />
        <header>
          <h2>{title}</h2>
          <p>{description}</p>
          <button type="button" onClick={onClose} className="sheet-close" aria-label="닫기">×</button>
        </header>
        <div className="catalog-list">
          {items.map((item) => (
            <button key={item.id} type="button" onClick={() => onSelect(item.id)}>
              {item.image ? (
                <span className="catalog-thumb"><img src={item.image} alt="" /></span>
              ) : (
                <span className="catalog-index">{item.index}</span>
              )}
              <span className="catalog-copy">
                <strong>{item.title}</strong>
                <small>{item.subtitle}</small>
              </span>
              <ChevronIcon />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function TutorPickSheet({
  friends,
  onClose,
  onPick,
}: {
  friends: FriendSummary[];
  onClose: () => void;
  onPick: (tutorId: string) => void;
}) {
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="compact-sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" />
        <h2 className="text-[19px] font-semibold">누구와 할까요?</h2>
        {friends.length === 0 ? (
          <p className="mt-3 text-[13px] text-ink-secondary">아직 친구가 없어요. 잠시 뒤 새 친구가 말을 걸 거예요.</p>
        ) : (
          <div className="tutor-pick-grid">
            {friends.map((friend) => (
              <button key={friend.id} type="button" onClick={() => onPick(friend.id)}>
                <img src={friend.profileImage} alt="" />
                <strong>{friend.koName}</strong>
                <small>{friend.travelling ? `✈️ ${friend.city}` : friend.emoji}</small>
              </button>
            ))}
          </div>
        )}
        <button type="button" onClick={onClose} className="sheet-done mt-4">닫기</button>
      </div>
    </div>
  );
}

function occupationLabel(value: string) {
  return { student: "학생", office: "직장인", freelance: "프리랜서", other: "그 외" }[value] ?? value;
}

function goalLabel(value: string) {
  return { travel: "여행 영어", work: "업무 영어", exam: "시험 영어", hobby: "취미로" }[value] ?? value;
}

function GearIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z"/><path d="M19.2 13.1a7.5 7.5 0 0 0 .05-1.1 7.5 7.5 0 0 0-.05-1.1l2-1.55-2-3.45-2.45 1a8 8 0 0 0-1.9-1.1L14.5 3h-5l-.35 2.8a8 8 0 0 0-1.9 1.1l-2.45-1-2 3.45 2 1.55A7.5 7.5 0 0 0 4.75 12c0 .37.02.73.05 1.1l-2 1.55 2 3.45 2.45-1a8 8 0 0 0 1.9 1.1l.35 2.8h5l.35-2.8a8 8 0 0 0 1.9-1.1l2.45 1 2-3.45-2-1.55Z"/></svg>; }
function ChatIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.7 8.7 0 0 1-2.7-.5L5 20l1.3-3.8A7.2 7.2 0 0 1 4 11c0-4.1 3.6-7 8-7s8 3.2 8 7.5Z"/></svg>; }
function BookIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22V5.5ZM20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5A3.5 3.5 0 0 1 20 22V5.5Z"/></svg>; }
function RoleIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM16.5 13a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M2.5 20c.2-4 2-6 5-6 1.5 0 2.7.5 3.5 1.4M13 20c.2-2.8 1.4-4.2 3.5-4.2S19.8 17.2 20 20"/></svg>; }
function RepeatIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 7H8.5A4.5 4.5 0 0 0 4 11.5V13M16 4l3 3-3 3M5 17h10.5a4.5 4.5 0 0 0 4.5-4.5V11M8 20l-3-3 3-3"/></svg>; }
function ChevronIcon() { return <svg className="chevron-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 4.5 5 5.5-5 5.5"/></svg>; }
