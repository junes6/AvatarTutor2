"use client";

/* eslint-disable @next/next/no-img-element */

// 홈 = 채팅 목록. 카톡과 같은 정보 밀도로 친구 목록을 보여준다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TabBar from "@/components/TabBar";
import { sfxMessage } from "@/lib/sfx";
import { listTime } from "@/lib/time";
import type { PendingIntro } from "@/core/types";

interface FriendCard {
  id: string;
  name: string;
  koName: string;
  emoji: string;
  color: string;
  bio: string;
  profileImage: string;
  status: "active" | "left";
  intimacy: { level: number; xp: number; next: number | null };
  unread: number;
  lastMessage: { text: string; ts: number; role: string; kind: string } | null;
  typing: boolean;
  awake: boolean;
  localTime: string;
  city: string;
  travelling: boolean;
}

interface HomeState {
  user: { onboarded: boolean; name: string; level: number; streak: { count: number } };
  friends: FriendCard[];
  archivedFriends: FriendCard[];
  pendingIntro: PendingIntro | null;
  srsDueCount: number;
}

const TICK_INTERVAL_MS = 45_000;

export default function HomePage() {
  const router = useRouter();
  const [state, setState] = useState<HomeState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const unreadRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (!response.ok) throw new Error("state load failed");
      const data = (await response.json()) as HomeState;
      if (!data?.user) throw new Error("invalid state response");
      if (!data.user.onboarded) {
        router.replace("/onboarding");
        return;
      }
      const unread = data.friends.reduce((total, friend) => total + friend.unread, 0);
      if (unread > unreadRef.current) sfxMessage();
      unreadRef.current = unread;
      setState(data);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [router]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void load());
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  // 예약 도착 · 능동 메시지 · 새 친구 소개를 주기적으로 확인한다.
  useEffect(() => {
    const tick = async () => {
      try {
        const response = await fetch("/api/tick", { method: "POST" });
        const data = await response.json();
        if (data.delivered > 0 || data.generated) await load();
      } catch {
        // 조용히 넘어가되 다음 tick에서 다시 시도한다.
      }
    };
    void tick();
    const interval = window.setInterval(() => void tick(), TICK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const totalUnread = useMemo(
    () => state?.friends.reduce((total, friend) => total + friend.unread, 0) ?? 0,
    [state],
  );

  if (!state && loadError) return <LoadError onRetry={() => void load()} />;
  if (!state) return <AppLoading />;

  const { friends, archivedFriends, pendingIntro } = state;

  return (
    <main className="list-screen">
      <header className="list-topbar">
        <h1>채팅</h1>
        <div className="list-topbar-actions">
          {state.srsDueCount > 0 && (
            <button type="button" className="list-chip" onClick={() => router.push("/me")}>
              복습 {state.srsDueCount}
            </button>
          )}
          <button type="button" className="icon-button" aria-label="마이페이지" onClick={() => router.push("/me")}>
            <PersonIcon />
          </button>
        </div>
      </header>

      <div className="list-scroll">
        {pendingIntro && <IntroPending intro={pendingIntro} />}

        {friends.length === 0 && !pendingIntro && (
          <div className="list-empty">
            <p>아직 대화 중인 친구가 없어요.</p>
            <button type="button" onClick={() => router.push("/me")}>친구 찾아보기</button>
          </div>
        )}

        <ul className="chat-list">
          {friends.map((friend) => (
            <li key={friend.id}>
              <button type="button" className="chat-row" onClick={() => router.push(`/chat/${friend.id}`)}>
                <span className="chat-row-avatar">
                  <img src={friend.profileImage} alt="" />
                  {friend.awake && <i className="chat-row-online" aria-label="접속 중" />}
                  {friend.travelling && <i className="chat-row-travel" aria-hidden="true">✈️</i>}
                </span>
                <span className="chat-row-body">
                  <span className="chat-row-title">
                    <strong>{friend.koName}</strong>
                    <em>{friend.emoji}</em>
                    {friend.travelling && <span className="chat-row-city">{friend.city}</span>}
                  </span>
                  <span className="chat-row-preview">
                    {friend.typing ? (
                      <span className="chat-row-typing">입력 중<i /><i /><i /></span>
                    ) : friend.lastMessage ? (
                      `${friend.lastMessage.role === "user" ? "나: " : ""}${friend.lastMessage.text}`
                    ) : (
                      friend.bio
                    )}
                  </span>
                </span>
                <span className="chat-row-meta">
                  <span className="chat-row-time">{friend.lastMessage ? listTime(friend.lastMessage.ts) : ""}</span>
                  {friend.unread > 0 && <span className="chat-row-badge">{friend.unread > 99 ? "99+" : friend.unread}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {archivedFriends.length > 0 && (
          <section className="archived-section">
            <button type="button" className="archived-toggle" onClick={() => setShowArchived((value) => !value)}>
              보관된 대화 {archivedFriends.length}
              <ChevronIcon className={showArchived ? "is-open" : ""} />
            </button>
            {showArchived && (
              <ul className="chat-list is-archived">
                {archivedFriends.map((friend) => (
                  <li key={friend.id}>
                    <button type="button" className="chat-row" onClick={() => router.push(`/chat/${friend.id}`)}>
                      <span className="chat-row-avatar">
                        <img src={friend.profileImage} alt="" />
                      </span>
                      <span className="chat-row-body">
                        <span className="chat-row-title"><strong>{friend.koName}</strong></span>
                        <span className="chat-row-preview">
                          {friend.lastMessage?.text ?? "대화 기록이 보관되어 있어요"}
                        </span>
                      </span>
                      <span className="chat-row-meta">
                        <span className="chat-row-time">보관됨</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <TabBar unread={totalUnread} />
    </main>
  );
}

function IntroPending({ intro }: { intro: PendingIntro }) {
  // 남은 시간은 렌더 중이 아니라 마운트 후에 계산한다 (렌더는 순수해야 한다).
  const [when, setWhen] = useState("");
  useEffect(() => {
    const update = () => {
      const minutes = Math.max(1, Math.round((intro.dueAt - Date.now()) / 60_000));
      setWhen(minutes > 90 ? `${Math.round(minutes / 60)}시간` : `${minutes}분`);
    };
    update();
    const interval = window.setInterval(update, 30_000);
    return () => window.clearInterval(interval);
  }, [intro.dueAt]);

  return (
    <div className="intro-pending" role="status">
      <span aria-hidden="true">👋</span>
      <div>
        <strong>새로운 친구가 곧 말을 걸 거예요</strong>
        <small>{when ? `${when} 뒤쯤 첫 메시지가 도착해요` : "곧 첫 메시지가 도착해요"}</small>
      </div>
    </div>
  );
}

function AppLoading() {
  return (
    <div className="min-h-dvh grid place-items-center">
      <div className="apple-loader" role="status" aria-label="불러오는 중" />
    </div>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-white">
      <div className="w-full max-w-xs text-center">
        <div className="text-[42px]" aria-hidden="true">↻</div>
        <h1 className="mt-3 text-[19px] font-semibold">목록을 불러오지 못했어요</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-white/48">연결을 확인한 뒤 다시 시도해 주세요.</p>
        <button
          type="button"
          onClick={onRetry}
          className="apple-primary-button mt-5 min-h-12 w-full rounded-2xl bg-[var(--apple-blue)] text-[14px] font-semibold"
        >
          다시 시도
        </button>
      </div>
    </main>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20c.4-4.3 3.4-6.5 7.5-6.5s7.1 2.2 7.5 6.5" />
    </svg>
  );
}

function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={`coach-chevron ${className}`} viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5.5 7.5 4.5 5 4.5-5" />
    </svg>
  );
}
