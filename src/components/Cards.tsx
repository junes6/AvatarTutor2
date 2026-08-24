"use client";

// 표현 카드 · 교정 카드 · "이렇게 말해보세요" 카드

import { useState } from "react";
import { fetchTTS } from "@/hooks/useAudioPlayer";
import type { CorrectionCard, SuggestionCard, Expression } from "@/core/types";

function ListenButton({ text, tutorId, speed = 1.0 }: { text: string; tutorId: string; speed?: number }) {
  const [loading, setLoading] = useState(false);
  const play = async (rate: number) => {
    if (loading) return;
    setLoading(true);
    const audio = await fetchTTS(text, tutorId);
    setLoading(false);
    if (audio) {
      const el = new Audio(`data:${audio.mime};base64,${audio.audioBase64}`);
      el.playbackRate = rate;
      el.play().catch(() => {});
    } else if (window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US";
      u.rate = rate;
      window.speechSynthesis.speak(u);
    }
  };
  return (
    <div className="flex gap-1.5">
      <button onClick={() => play(speed)} className="px-2.5 py-1 rounded-full bg-white/10 text-xs hover:bg-white/20 transition-colors">
        {loading ? "…" : "🔊 듣기"}
      </button>
      <button onClick={() => play(0.7)} className="px-2.5 py-1 rounded-full bg-white/10 text-xs hover:bg-white/20 transition-colors">
        0.7×
      </button>
    </div>
  );
}

/** 러닝모드: 새 표현 소개 카드 */
export function ExpressionCardView({ expr, tutorId }: { expr: Expression; tutorId: string }) {
  return (
    <div className="rounded-2xl bg-indigo-500/15 border border-indigo-400/40 p-4 backdrop-blur-md animate-[slideUp_0.35s_ease]">
      <div className="text-[11px] font-semibold text-indigo-300 mb-1">✨ 새 표현</div>
      <div className="text-lg font-bold text-white">{expr.en}</div>
      <div className="text-sm text-white/70 mt-0.5">{expr.ko}</div>
      <div className="mt-2 text-xs text-white/50 italic">
        {expr.example}
        <div className="not-italic">{expr.exampleKo}</div>
      </div>
      <div className="mt-3">
        <ListenButton text={expr.en} tutorId={tutorId} />
      </div>
    </div>
  );
}

/** "이렇게 말하면 더 자연스러워요" — 따라 말하기 카드 */
export function SuggestionCardView({ card, tutorId }: { card: SuggestionCard; tutorId: string }) {
  return (
    <div className="rounded-2xl bg-emerald-500/15 border border-emerald-400/40 p-4 backdrop-blur-md animate-[slideUp_0.35s_ease]">
      <div className="text-[11px] font-semibold text-emerald-300 mb-1">💬 이렇게 말해보세요</div>
      <div className="text-lg font-bold text-white">{card.en}</div>
      {card.ko && <div className="text-sm text-white/70 mt-0.5">{card.ko}</div>}
      <div className="mt-3 flex items-center justify-between">
        <ListenButton text={card.en} tutorId={tutorId} />
        <span className="text-[11px] text-emerald-300/80">🎤 버튼을 누르고 따라 말해보세요</span>
      </div>
    </div>
  );
}

/** 교정 카드 (러닝모드 즉시 표시 / 리포트) */
export function CorrectionCardView({ card, tutorId }: { card: CorrectionCard; tutorId: string }) {
  const typeLabel: Record<string, string> = {
    grammar: "문법",
    article: "관사",
    tense: "시제",
    preposition: "전치사",
    konglish: "콩글리시",
    awkward: "어색한 표현",
    "word-choice": "단어 선택",
  };
  return (
    <div className="rounded-2xl bg-amber-500/15 border border-amber-400/40 p-4 backdrop-blur-md animate-[slideUp_0.35s_ease]">
      <div className="text-[11px] font-semibold text-amber-300 mb-1.5">✏️ {typeLabel[card.type] ?? "교정"}</div>
      <div className="text-sm text-white/50 line-through">{card.original}</div>
      <div className="text-base font-bold text-white mt-1">{card.better}</div>
      {card.ko && <div className="text-sm text-white/70 mt-0.5">{card.ko}</div>}
      {card.reason && <div className="mt-2 text-xs text-amber-200/90">💡 {card.reason}</div>}
      <div className="mt-3">
        <ListenButton text={card.better} tutorId={tutorId} />
      </div>
    </div>
  );
}

/** 리포트용 뒤집기 카드 (원문 → 교정문) */
export function FlipCard({ card, tutorId }: { card: CorrectionCard; tutorId: string }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <button
      onClick={() => setFlipped((f) => !f)}
      className="w-full text-left rounded-2xl border p-4 transition-all duration-300 bg-white/5 border-white/10 hover:border-white/25"
    >
      {!flipped ? (
        <>
          <div className="text-[11px] text-white/40 mb-1">내가 한 말 (탭해서 교정문 보기)</div>
          <div className="text-base text-white/80">{card.original}</div>
        </>
      ) : (
        <>
          <div className="text-[11px] text-emerald-300 mb-1">더 자연스러운 표현</div>
          <div className="text-base font-bold text-white">{card.better}</div>
          <div className="text-sm text-white/60 mt-0.5">{card.ko}</div>
          {card.reason && <div className="mt-1.5 text-xs text-amber-200/90">💡 {card.reason}</div>}
          <div className="mt-2" onClick={(e) => e.stopPropagation()}>
            <ListenButton text={card.better} tutorId={tutorId} />
          </div>
        </>
      )}
    </button>
  );
}
