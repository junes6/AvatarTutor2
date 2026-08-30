"use client";

/* eslint-disable @next/next/no-img-element */

// 채팅방 — 카톡 구조(말풍선·읽음·날짜 구분선·답장 인용·이모지 반응)에
// 이 앱의 학습 루프(코칭 카드·사진 롤플레이·음성 메시지)를 얹었다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import CoachingCardView from "@/components/CoachingCardView";
import LeaveSheet from "@/components/LeaveSheet";
import PhotoViewer from "@/components/PhotoViewer";
import VoiceBubble from "@/components/VoiceBubble";
import { showToast } from "@/components/Toast";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { sfxMessage } from "@/lib/sfx";
import { bubbleTime, dayDivider, relativeFuture, sameDay } from "@/lib/time";
import type { ChatMessage, LeaveReason } from "@/core/types";

interface TutorHeader {
  id: string;
  name: string;
  koName: string;
  emoji: string;
  color: string;
  profileImage: string;
  timezone: string;
}

interface ChatPayload {
  messages: ChatMessage[];
  live: boolean;
  liveUntil: number | null;
  typing: { typing: boolean; nextAt: number | null };
  tutor: TutorHeader;
  active: boolean;
  demo: boolean | null;
}

const POLL_INTERVAL_MS = 6_000;
const REACTIONS = ["❤️", "😂", "👍", "😮", "😢", "🔥"];
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const STARTERS = [
  { label: "오늘 이야기", text: "Can I tell you about my day?" },
  { label: "표현 배우기", text: "Teach me one useful expression for today." },
  { label: "가벼운 수다", text: "What have you been up to today?" },
];

export default function ChatPage() {
  const { tutorId } = useParams<{ tutorId: string }>();
  const router = useRouter();
  const player = useAudioPlayer(tutorId);

  const [payload, setPayload] = useState<ChatPayload | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showKo, setShowKo] = useState<Record<string, boolean>>({});
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [reactionTarget, setReactionTarget] = useState<string | null>(null);
  const [viewerPhoto, setViewerPhoto] = useState<ChatMessage | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [speakingText, setSpeakingText] = useState<string | null>(null);
  const [scheduledAt, setScheduledAt] = useState<number | null>(null);
  const [practiced, setPracticed] = useState<Record<string, boolean>>({});

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const longPressRef = useRef<number | null>(null);
  const sendingRef = useRef(false);
  const countRef = useRef(0);

  const load = useCallback(
    async (options: { silent?: boolean } = {}) => {
      try {
        const response = await fetch(`/api/chat?tutorId=${encodeURIComponent(tutorId)}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(data.error || "chat load failed");
        if (sendingRef.current) return;
        const next = data as ChatPayload;
        if (countRef.current > 0 && next.messages.length > countRef.current) {
          sfxMessage();
          setScheduledAt(null);
        }
        countRef.current = next.messages.length;
        setPayload(next);
        setLoadError("");
        void fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "read", tutorId }),
        }).catch(() => {});
      } catch {
        if (!options.silent) setLoadError("대화를 불러오지 못했어요. 연결을 확인해 주세요.");
      }
    },
    [tutorId],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setInitializing(true);
      await load();
      if (!cancelled) setInitializing(false);
    })();
    const interval = window.setInterval(() => void load({ silent: true }), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [payload?.messages.length, payload?.typing.typing, sending]);

  useEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = "0px";
    field.style.height = `${Math.min(120, Math.max(42, field.scrollHeight))}px`;
  }, [input]);

  const messages = payload?.messages ?? [];
  const tutor = payload?.tutor ?? null;

  // playTTS는 훅 내부에서 안정적인 참조다 — player 객체 전체를 의존성에 넣지 않는다.
  const { playTTS } = player;
  const speak = useCallback(
    async (text: string) => {
      setSpeakingText(text);
      const started = await playTTS(text, { tutorId, onEnd: () => setSpeakingText(null) });
      if (!started) setSpeakingText(null);
    },
    [playTTS, tutorId],
  );

  const send = useCallback(
    async (preset?: string) => {
      const text = (preset ?? input).trim();
      if (!text || sendingRef.current) return;
      sendingRef.current = true;
      setSending(true);
      setInput("");
      const quoted = replyTo;
      setReplyTo(null);

      const tempId = `tmp-${Date.now()}`;
      setPayload((current) =>
        current
          ? {
              ...current,
              messages: [
                ...current.messages,
                {
                  id: tempId,
                  role: "user",
                  text,
                  ts: Date.now(),
                  read: true,
                  replyTo: quoted ? { id: quoted.id, role: quoted.role, preview: quoted.text.slice(0, 90) } : null,
                },
              ],
            }
          : current,
      );

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tutorId, text, replyToId: quoted?.id }),
        });
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(data.error || "send failed");

        setPayload((current) => {
          if (!current) return current;
          const withoutTemp = current.messages.filter((message) => message.id !== tempId);
          const next = [...withoutTemp, data.userMsg];
          // 예약 발송이면 튜터 답장은 아직 도착하지 않는다.
          if (data.scheduledFor === null) next.push(data.tutorMsg);
          countRef.current = next.length;
          return { ...current, messages: next };
        });

        setScheduledAt(data.scheduledFor ?? null);
        if (data.practiceHit) showToast("배운 표현을 직접 썼어요! +6 XP", "success");
        if (data.sleptThrough) showToast(`${tutor?.koName ?? "친구"}는 지금 자는 중이에요. 일어나면 답장이 와요.`, "info");
        if (data.scheduledFor === null) sfxMessage();
      } catch {
        setPayload((current) =>
          current ? { ...current, messages: current.messages.filter((message) => message.id !== tempId) } : current,
        );
        setInput(text);
        showToast("보내지 못했어요. 내용은 그대로 두었어요.", "error");
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [input, replyTo, tutor, tutorId],
  );

  const sendPhoto = useCallback(
    async (file: File) => {
      if (file.size > MAX_PHOTO_BYTES) {
        showToast("사진이 너무 커요. 5MB 이하로 보내주세요.", "warn");
        return;
      }
      setSending(true);
      sendingRef.current = true;
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("read failed"));
          reader.readAsDataURL(file);
        });
        const response = await fetch("/api/chat/photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tutorId, photo: dataUrl, caption: input.trim() }),
        });
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(data.error || "photo send failed");
        setInput("");
        if (data.visionAvailable === false) {
          showToast("사진 인식은 API 키가 연결되어야 동작해요.", "warn");
        }
        setScheduledAt(data.scheduledFor ?? null);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "사진을 보내지 못했어요.", "error");
      } finally {
        sendingRef.current = false;
        setSending(false);
        await load({ silent: true });
      }
    },
    [input, load, tutorId],
  );

  const toggleLive = useCallback(async () => {
    if (!payload) return;
    const next = !payload.live;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tutorId, action: "live", on: next }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error("live toggle failed");
      showToast(next ? "지금 대화 중 — 답장이 바로 와요 (5분 뒤 자동 해제)" : "평소처럼 시간을 두고 답장해요", "info");
      setScheduledAt(null);
      await load({ silent: true });
    } catch {
      showToast("설정을 바꾸지 못했어요.", "error");
    }
  }, [load, payload, tutorId]);

  const react = useCallback(
    async (messageId: string, emoji: string) => {
      setReactionTarget(null);
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tutorId, action: "react", messageId, emoji }),
        });
        const data = await response.json();
        if (!response.ok || data.error) throw new Error("reaction failed");
        setPayload((current) =>
          current
            ? {
                ...current,
                messages: current.messages.map((message) => (message.id === messageId ? data.message : message)),
              }
            : current,
        );
      } catch {
        showToast("반응을 남기지 못했어요.", "error");
      }
    },
    [tutorId],
  );

  const leave = useCallback(
    async (reason: LeaveReason) => {
      try {
        const response = await fetch("/api/friends", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tutorId, action: "leave", reason }),
        });
        const data = await response.json();
        if (!response.ok || data.error) throw new Error("leave failed");
        setLeaveOpen(false);
        showToast(
          data.nextFriendInMinutes
            ? "대화 기록은 보관했어요. 새 친구가 곧 말을 걸 거예요."
            : "대화 기록은 보관했어요.",
          "info",
        );
        router.push("/");
      } catch {
        showToast("나가지 못했어요. 잠시 후 다시 시도해 주세요.", "error");
      }
    },
    [router, tutorId],
  );

  const restore = useCallback(async () => {
    try {
      await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tutorId, action: "restore" }),
      });
      showToast("다시 대화를 시작했어요.", "success");
      await load({ silent: true });
    } catch {
      showToast("다시 시작하지 못했어요.", "error");
    }
  }, [load, tutorId]);

  const startPractice = useCallback((messageId: string, text: string) => {
    setPracticed((current) => ({ ...current, [messageId]: true }));
    setInput(text);
    inputRef.current?.focus();
  }, []);

  const beginLongPress = useCallback((messageId: string) => {
    longPressRef.current = window.setTimeout(() => setReactionTarget(messageId), 420);
  }, []);
  const cancelLongPress = useCallback(() => {
    if (longPressRef.current) window.clearTimeout(longPressRef.current);
    longPressRef.current = null;
  }, []);

  const statusLine = useMemo(() => {
    if (!payload || !tutor) return "";
    if (payload.typing.typing) return "입력 중…";
    return "";
  }, [payload, tutor]);

  if (initializing) return <ChatLoading />;
  if (!payload || !tutor) {
    return <ChatLoadError message={loadError || "대화를 열지 못했어요."} onBack={() => router.push("/")} onRetry={() => void load()} />;
  }

  return (
    <main className="room-screen" style={{ "--tutor-color": tutor.color } as React.CSSProperties}>
      <header className="room-topbar">
        <button type="button" className="icon-button" aria-label="목록으로" onClick={() => router.push("/")}>
          <BackIcon />
        </button>
        <img src={tutor.profileImage} alt="" className="room-avatar" />
        <div className="room-identity">
          <strong>{tutor.koName}</strong>
          <small>{statusLine || <TutorPresence tutorId={tutorId} />}</small>
        </div>
        <button
          type="button"
          className="icon-button is-call"
          aria-label={`${tutor.koName}와 통화`}
          onClick={() => router.push(`/call/${tutorId}?mode=freetalk`)}
        >
          <PhoneIcon />
        </button>
        <button type="button" className="icon-button" aria-label="더 보기" onClick={() => setMenuOpen(true)}>
          <MoreIcon />
        </button>
      </header>

      <div className="room-live-bar">
        <span>{payload.live ? "5분 동안 바로 답장해요" : "친구처럼 시간을 두고 답장해요"}</span>
        <button
          type="button"
          className={`live-toggle ${payload.live ? "is-on" : ""}`}
          onClick={() => void toggleLive()}
          aria-pressed={payload.live}
        >
          <i />
          지금 대화 중
        </button>
      </div>

      {!payload.active && (
        <div className="room-archived-bar">
          보관된 대화예요.
          <button type="button" onClick={() => void restore()}>다시 대화하기</button>
        </div>
      )}

      <div className="room-messages" role="log" aria-live="polite" aria-label={`${tutor.koName}와의 대화`}>
        {messages.length === 0 && (
          <section className="room-empty">
            <img src={tutor.profileImage} alt="" />
            <h1>{tutor.koName}와 첫 대화</h1>
            <p>한국어로 써도 괜찮아요. 영어로 어떻게 말하는지 알려줄게요.</p>
            <div className="room-starters">
              {STARTERS.map((starter) => (
                <button type="button" key={starter.label} onClick={() => void send(starter.text)}>
                  {starter.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const showDivider = !previous || !sameDay(previous.ts, message.ts);
          const showAvatar = message.role === "tutor" && (!previous || previous.role !== "tutor" || showDivider);
          return (
            <div key={message.id}>
              {showDivider && (
                <div className="day-divider">
                  <span>{dayDivider(message.ts)}</span>
                </div>
              )}
              <MessageRow
                message={message}
                tutor={tutor}
                showAvatar={showAvatar}
                showKo={Boolean(showKo[message.id])}
                onToggleKo={() => setShowKo((state) => ({ ...state, [message.id]: !state[message.id] }))}
                onReply={() => setReplyTo(message)}
                onLongPressStart={() => beginLongPress(message.id)}
                onLongPressEnd={cancelLongPress}
                onOpenPhoto={() => setViewerPhoto(message)}
                onSpeak={speak}
                speakingText={speakingText}
                onPractice={(text) => startPractice(message.id, text)}
                practiced={Boolean(practiced[message.id])}
                reactionOpen={reactionTarget === message.id}
                onReact={(emoji) => void react(message.id, emoji)}
                onCloseReactions={() => setReactionTarget(null)}
              />
            </div>
          );
        })}

        {(payload.typing.typing || sending) && (
          <div className="msg-row is-tutor" role="status" aria-label={`${tutor.koName}가 입력 중`}>
            <div className="msg-avatar-slot">
              <img src={tutor.profileImage} alt="" />
            </div>
            <div className="typing-bubble"><i /><i /><i /></div>
          </div>
        )}

        {scheduledAt && !payload.typing.typing && (
          <div className="scheduled-hint" role="status">
            {tutor.koName}가 {relativeFuture(scheduledAt)} 답장할 거예요
            <button type="button" onClick={() => void toggleLive()}>바로 받기</button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <footer className="room-composer-wrap">
        {loadError && <div className="room-error" role="status">{loadError}</div>}
        {replyTo && (
          <div className="reply-preview">
            <div>
              <span>{replyTo.role === "user" ? "내 메시지" : tutor.koName}에게 답장</span>
              <p>{replyTo.text.slice(0, 80)}</p>
            </div>
            <button type="button" onClick={() => setReplyTo(null)} aria-label="답장 취소">×</button>
          </div>
        )}
        <div className="room-composer">
          <button
            type="button"
            className="composer-icon"
            aria-label="사진 보내기"
            onClick={() => fileRef.current?.click()}
          >
            <PhotoIcon />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void sendPhoto(file);
            }}
          />
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder="메시지 보내기 (한국어도 괜찮아요)"
            aria-label="메시지"
            enterKeyHint="send"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!input.trim() || sending}
            className="composer-send"
            aria-label="보내기"
          >
            <UpArrowIcon />
          </button>
        </div>
      </footer>

      {menuOpen && (
        <RoomMenu
          tutorName={tutor.koName}
          active={payload.active}
          onClose={() => setMenuOpen(false)}
          onCall={() => router.push(`/call/${tutorId}?mode=freetalk`)}
          onRoleplay={() => router.push(`/me?roleplay=${tutorId}`)}
          onLeave={() => {
            setMenuOpen(false);
            setLeaveOpen(true);
          }}
        />
      )}

      {leaveOpen && (
        <LeaveSheet tutorName={tutor.koName} onClose={() => setLeaveOpen(false)} onLeave={(reason) => void leave(reason)} />
      )}

      {viewerPhoto?.photo && (
        <PhotoViewer
          photo={viewerPhoto.photo}
          caption={viewerPhoto.text}
          onClose={() => setViewerPhoto(null)}
          onRoleplay={
            viewerPhoto.photo.roleplayScenarioId
              ? () => router.push(`/call/${tutorId}?mode=freetalk&scenario=${viewerPhoto.photo!.roleplayScenarioId}`)
              : undefined
          }
        />
      )}
    </main>
  );
}

function MessageRow({
  message,
  tutor,
  showAvatar,
  showKo,
  onToggleKo,
  onReply,
  onLongPressStart,
  onLongPressEnd,
  onOpenPhoto,
  onSpeak,
  speakingText,
  onPractice,
  practiced,
  reactionOpen,
  onReact,
  onCloseReactions,
}: {
  message: ChatMessage;
  tutor: TutorHeader;
  showAvatar: boolean;
  showKo: boolean;
  onToggleKo: () => void;
  onReply: () => void;
  onLongPressStart: () => void;
  onLongPressEnd: () => void;
  onOpenPhoto: () => void;
  onSpeak: (text: string) => void;
  speakingText: string | null;
  onPractice: (text: string) => void;
  practiced: boolean;
  reactionOpen: boolean;
  onReact: (emoji: string) => void;
  onCloseReactions: () => void;
}) {
  const mine = message.role === "user";
  const pending = message.id.startsWith("tmp");

  if (message.kind === "call-summary" && message.callSummary) {
    const summary = message.callSummary;
    return (
      <div className="call-summary-card">
        <span aria-hidden="true">📞</span>
        <div>
          <strong>통화 {Math.max(1, Math.round(summary.durationSec / 60))}분</strong>
          <small>
            {summary.turns}문장 · 교정 {summary.correctionCount}개 · +{summary.xpEarned} XP
          </small>
          {summary.highlights.length > 0 && (
            <ul>
              {summary.highlights.slice(0, 3).map((highlight) => (
                <li key={highlight}>{highlight}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`msg-row ${mine ? "is-user" : "is-tutor"}`}>
      {!mine && <div className="msg-avatar-slot">{showAvatar && <img src={tutor.profileImage} alt="" />}</div>}

      <div className="msg-column">
        {message.proactiveType && !mine && <div className="msg-context">{proactiveLabel(message.proactiveType)}</div>}

        {message.replyTo && (
          <div className="msg-quote">
            <span>{message.replyTo.role === "user" ? "나" : tutor.koName}</span>
            <p>{message.replyTo.preview}</p>
          </div>
        )}

        <div
          className="msg-bubble-wrap"
          onPointerDown={onLongPressStart}
          onPointerUp={onLongPressEnd}
          onPointerLeave={onLongPressEnd}
          onContextMenu={(event) => event.preventDefault()}
        >
          {message.kind === "photo" && message.photo ? (
            <button type="button" className={`photo-bubble ${mine ? "is-user" : ""}`} onClick={onOpenPhoto}>
              <img src={message.photo.url} alt={message.photo.alt} />
              {message.text && <span>{message.text}</span>}
            </button>
          ) : message.kind === "voice" && message.voice ? (
            <VoiceBubble
              voice={message.voice}
              mine={mine}
              onSpeak={() => onSpeak(message.voice!.script)}
              speaking={speakingText === message.voice.script}
            />
          ) : (
            <div className={mine ? "user-bubble" : "tutor-bubble"} data-pending={pending || undefined}>
              <p>{message.text}</p>
              {!mine && showKo && message.ko && <p className="bubble-translation">{message.ko}</p>}
            </div>
          )}

          {message.reactions && message.reactions.length > 0 && (
            <div className={`msg-reactions ${mine ? "is-user" : ""}`}>
              {message.reactions.map((reaction) => (
                <span key={`${reaction.emoji}-${reaction.by}`}>{reaction.emoji}</span>
              ))}
            </div>
          )}

          {reactionOpen && (
            <div className={`reaction-picker ${mine ? "is-user" : ""}`} role="menu">
              {REACTIONS.map((emoji) => (
                <button key={emoji} type="button" onClick={() => onReact(emoji)} aria-label={`${emoji} 반응`}>
                  {emoji}
                </button>
              ))}
              <button type="button" className="reaction-reply" onClick={() => { onCloseReactions(); onReply(); }}>
                답장
              </button>
            </div>
          )}
        </div>

        {message.correction && (
          <div className="inline-correction">
            <div className="correction-label">더 자연스럽게</div>
            <div>
              <span>{message.correction.original}</span>
              <ArrowIcon />
              <strong>{message.correction.better}</strong>
            </div>
            {message.correction.reason && <p>{message.correction.reason}</p>}
          </div>
        )}

        {message.coaching && (
          <CoachingCardView
            card={message.coaching}
            onSpeak={onSpeak}
            onPractice={onPractice}
            speakingText={speakingText}
            completed={practiced}
          />
        )}

        <div className={`msg-meta ${mine ? "is-user" : ""}`}>
          {mine && !pending && <span className="msg-read">읽음</span>}
          <span>{pending ? "보내는 중" : bubbleTime(message.ts)}</span>
          {!mine && message.ko && (
            <button type="button" onClick={onToggleKo} aria-pressed={showKo}>
              {showKo ? "번역 닫기" : "번역"}
            </button>
          )}
          {!mine && message.kind !== "voice" && (
            <button type="button" onClick={() => onSpeak(message.text)}>듣기</button>
          )}
        </div>
      </div>
    </div>
  );
}

function TutorPresence({ tutorId }: { tutorId: string }) {
  const [presence, setPresence] = useState<{ awake: boolean; localTime: string; city: string; travelling: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/friends", { cache: "no-store" });
        const data = await response.json();
        const all = [...(data.active ?? []), ...(data.left ?? []), ...(data.candidates ?? [])];
        const found = all.find((item: { id: string }) => item.id === tutorId);
        if (!cancelled && found) setPresence(found);
      } catch {
        // 헤더 보조 정보라 실패해도 무시한다.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tutorId]);

  if (!presence) return <>영어 친구</>;
  if (presence.travelling) return <>✈️ {presence.city} · 현지 {presence.localTime}</>;
  if (!presence.awake) return <>자는 중 · 현지 {presence.localTime}</>;
  return <>{presence.city} · 현지 {presence.localTime}</>;
}

function RoomMenu({
  tutorName,
  active,
  onClose,
  onCall,
  onRoleplay,
  onLeave,
}: {
  tutorName: string;
  active: boolean;
  onClose: () => void;
  onCall: () => void;
  onRoleplay: () => void;
  onLeave: () => void;
}) {
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="compact-sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" />
        <h2 className="text-[19px] font-semibold">{tutorName}</h2>
        <div className="menu-list">
          <button type="button" onClick={onCall}><PhoneIcon /> 통화하기</button>
          <button type="button" onClick={onRoleplay}><RoleIcon /> 상황극 시작</button>
          {active && (
            <button type="button" className="is-danger" onClick={onLeave}>
              <ExitIcon /> 채팅방 나가기
            </button>
          )}
        </div>
        <button type="button" onClick={onClose} className="sheet-done mt-4">닫기</button>
      </div>
    </div>
  );
}

function ChatLoading() {
  return (
    <div className="min-h-dvh grid place-items-center">
      <div className="apple-loader" role="status" aria-label="대화 불러오는 중" />
    </div>
  );
}

function ChatLoadError({ message, onBack, onRetry }: { message: string; onBack: () => void; onRetry: () => void }) {
  return (
    <main className="call-error-screen">
      <div className="call-error-symbol" aria-hidden="true">!</div>
      <h1>대화를 열지 못했어요</h1>
      <p role="alert">{message}</p>
      <div className="call-error-actions">
        <button type="button" onClick={onBack}>목록으로</button>
        <button type="button" onClick={onRetry} className="is-primary">다시 시도</button>
      </div>
    </main>
  );
}

function proactiveLabel(type: NonNullable<ChatMessage["proactiveType"]>) {
  return {
    morning: "아침 인사",
    quiz: "복습 퀴즈",
    checkin: "근황 질문",
    missyou: "먼저 온 메시지",
    life: "근황 사진",
    intro: "첫 인사",
  }[type];
}

function BackIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>; }
function PhoneIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5 9 4l1.2 3.4-1.9 1.6a12 12 0 0 0 5.3 5.3l1.6-1.9L18.5 15l.5 2.5c0 1-1 2-2.2 1.9C9.6 18.8 5.2 14.4 4.6 5.7 4.5 4.5 5.5 3.5 6.5 3.5Z" /></svg>; }
function MoreIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>; }
function PhotoIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="m5 17 4.5-4.5 3 3 3-2.5 4 4" /></svg>; }
function UpArrowIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 15V5M6 9l4-4 4 4" /></svg>; }
function ArrowIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M9 5l3 3-3 3" /></svg>; }
function RoleIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM16.5 13a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" /><path d="M2.5 20c.2-4 2-6 5-6 1.5 0 2.7.5 3.5 1.4M13 20c.2-2.8 1.4-4.2 3.5-4.2S19.8 17.2 20 20" /></svg>; }
function ExitIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8M17 8l4 4-4 4M21 12H10" /></svg>; }
