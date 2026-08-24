"use client";

// 채팅 화면 — 카톡처럼 텍스트로, 교정은 대화 흐름 속에 가볍게

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { sfxMessage } from "@/lib/sfx";
import type { ChatMessage } from "@/core/types";

interface TutorInfo {
  id: string;
  name: string;
  emoji: string;
  color: string;
  profileImage: string;
  intimacy: { level: number };
  bio: string;
}

export default function ChatPage() {
  const { tutorId } = useParams<{ tutorId: string }>();
  const router = useRouter();
  const [tutor, setTutor] = useState<TutorInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showKo, setShowKo] = useState<Record<string, boolean>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastCountRef = useRef(0);

  const load = useCallback(async () => {
    const res = await fetch(`/api/chat?tutorId=${tutorId}`);
    const data = await res.json();
    setMessages((prev) => {
      const next: ChatMessage[] = data.messages ?? [];
      if (lastCountRef.current > 0 && next.length > lastCountRef.current) sfxMessage();
      lastCountRef.current = next.length;
      return next.length !== prev.length ? next : prev;
    });
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", tutorId }),
    }).catch(() => {});
  }, [tutorId]);

  useEffect(() => {
    fetch("/api/state")
      .then((r) => r.json())
      .then((data) => setTutor(data.tutors.find((t: TutorInfo) => t.id === tutorId) ?? null));
    load();
    const iv = setInterval(load, 45000);
    return () => clearInterval(iv);
  }, [tutorId, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    // 낙관적 표시
    const tempId = "tmp" + Date.now();
    setMessages((prev) => [...prev, { id: tempId, role: "user", text, ts: Date.now(), read: true }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tutorId, text }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMessages((prev) => [...prev.filter((m) => m.id !== tempId), data.userMsg, data.tutorMsg]);
      lastCountRef.current += 2;
      sfxMessage();
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInput(text); // 입력 복원 — 유실 방지
      alert("전송에 실패했어요. 다시 시도해 주세요.");
    } finally {
      setSending(false);
    }
  };

  if (!tutor) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh">
      {/* 헤더 */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-white/10 bg-slate-950/80 backdrop-blur sticky top-0 z-10">
        <button onClick={() => router.push("/")} className="text-white/60 text-lg px-1">
          ←
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={tutor.profileImage} alt="" className="w-10 h-10 rounded-full border-2" style={{ borderColor: tutor.color }} />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm">
            {tutor.name} {tutor.emoji}
          </div>
          <div className="text-[10px]" style={{ color: tutor.color }}>
            친밀도 {"💛".repeat(tutor.intimacy.level)}
          </div>
        </div>
        <button
          onClick={() => router.push(`/call/${tutorId}?mode=freetalk`)}
          className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center active:scale-95 transition-transform"
          aria-label="영상통화"
        >
          📹
        </button>
      </header>

      {/* 메시지 목록 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-white/35 text-sm py-16">
            아직 대화가 없어요.
            <br />
            먼저 인사해 보세요! 👋
          </div>
        )}
        {messages.map((m) =>
          m.role === "tutor" ? (
            <div key={m.id} className="flex gap-2 items-end max-w-[85%]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={tutor.profileImage} alt="" className="w-7 h-7 rounded-full shrink-0" />
              <div>
                {m.proactiveType && (
                  <div className="text-[9px] text-white/30 mb-0.5 ml-1">
                    {{ morning: "☀️ 아침 인사", quiz: "🧠 복습 퀴즈", checkin: "💬 근황 질문", missyou: "🥲 보고 싶대요" }[m.proactiveType]}
                  </div>
                )}
                <button
                  onClick={() => setShowKo((s) => ({ ...s, [m.id]: !s[m.id] }))}
                  className="text-left rounded-2xl rounded-bl-sm bg-white/10 px-3.5 py-2.5 text-sm leading-relaxed"
                >
                  {m.text}
                  {showKo[m.id] && m.ko && <div className="mt-1.5 pt-1.5 border-t border-white/10 text-xs text-white/55">{m.ko}</div>}
                </button>
                <div className="text-[9px] text-white/25 mt-0.5 ml-1">{formatTime(m.ts)} · 탭하면 번역</div>
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex flex-col items-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-emerald-600 px-3.5 py-2.5 text-sm leading-relaxed">{m.text}</div>
              {m.correction && (
                <div className="mt-1 max-w-[85%] rounded-xl bg-amber-500/10 border border-amber-500/25 px-3 py-2 text-[11px] text-amber-200">
                  ✏️ <span className="line-through opacity-60">{m.correction.original}</span> → <b>{m.correction.better}</b>
                  {m.correction.reason && <div className="mt-0.5 opacity-80">{m.correction.reason}</div>}
                </div>
              )}
              <div className="text-[9px] text-white/25 mt-0.5">{formatTime(m.ts)}</div>
            </div>
          ),
        )}
        {sending && (
          <div className="flex gap-2 items-center text-white/40 text-xs ml-9">
            <span className="animate-pulse">{tutor.name}가 입력 중...</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 입력 바 */}
      <div className="p-3 border-t border-white/10 bg-slate-950/80 backdrop-blur">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && send()}
            placeholder="영어로 메시지 보내기..."
            className="flex-1 rounded-full bg-white/10 px-4 py-3 text-sm outline-none focus:ring-2 ring-emerald-500 placeholder:text-white/30"
          />
          <button
            onClick={send}
            disabled={!input.trim() || sending}
            className="w-12 h-12 rounded-full bg-emerald-600 flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform"
            aria-label="보내기"
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h < 12 ? "오전" : "오후"} ${h % 12 === 0 ? 12 : h % 12}:${m}`;
}
