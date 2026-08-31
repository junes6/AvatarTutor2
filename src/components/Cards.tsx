"use client";

// 표현 카드 · 교정 카드 · "이렇게 말해보세요" 카드

import { useState } from "react";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import type { CorrectionCard, SuggestionCard, Expression } from "@/core/types";

function ListenButton({ text, tutorId, speed = 1.0 }: { text: string; tutorId: string; speed?: number }) {
  const player = useAudioPlayer(tutorId);
  const [activeRate, setActiveRate] = useState<number | null>(null);
  const busy = player.phase !== "idle";

  const play = (rate: number) => {
    if (busy) {
      if (activeRate === rate) player.stop();
      return;
    }
    setActiveRate(rate);
    void player.playTTS(text, { rate });
  };

  const labelFor = (rate: number, idleLabel: string) => {
    const active = busy && activeRate === rate;
    if (!active) return idleLabel;
    return player.phase === "loading" ? "…" : "중지";
  };

  return (
    <div className="call-coach-listen-actions">
      <button
        type="button"
        onClick={() => play(speed)}
        disabled={busy && activeRate !== speed}
        className="coach-listen-button"
        aria-label={`${text} 듣기`}
        aria-pressed={busy && activeRate === speed}
      >
        <SpeakerIcon />
        {labelFor(speed, "듣기")}
      </button>
      <button
        type="button"
        onClick={() => play(0.7)}
        disabled={busy && activeRate !== 0.7}
        className="coach-listen-button"
        aria-label={`${text} 천천히 듣기`}
        aria-pressed={busy && activeRate === 0.7}
      >
        <SpeakerIcon />
        {labelFor(0.7, "천천히")}
      </button>
    </div>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 10v4h3l4 3V7L8 10H5Z" />
      <path d="M15 9.5a4 4 0 0 1 0 5M17.5 7a7.2 7.2 0 0 1 0 10" />
    </svg>
  );
}

/** 러닝모드: 새 표현 소개 카드 */
export function ExpressionCardView({ expr, tutorId }: { expr: Expression; tutorId: string }) {
  return (
    <div className="call-coach-card is-expression">
      <div className="call-coach-label">새 표현</div>
      <div className="call-coach-title">{expr.en}</div>
      <div className="call-coach-ko">{expr.ko}</div>
      <div className="call-coach-example italic">
        {expr.example}
        <div className="not-italic">{expr.exampleKo}</div>
      </div>
      <div className="call-coach-actions">
        <ListenButton text={expr.en} tutorId={tutorId} />
        <span className="call-coach-prompt">듣고 소리 내어 따라 해보세요</span>
      </div>
    </div>
  );
}

/** "이렇게 말하면 더 자연스러워요" — 따라 말하기 카드 */
export function SuggestionCardView({ card, tutorId }: { card: SuggestionCard; tutorId: string }) {
  return (
    <div className="call-coach-card is-suggestion">
      <div className="call-coach-label">이렇게 말해보세요</div>
      <div className="call-coach-title">{card.en}</div>
      {card.ko && <div className="call-coach-ko">{card.ko}</div>}
      <div className="call-coach-actions">
        <ListenButton text={card.en} tutorId={tutorId} />
        <span className="call-coach-prompt">마이크를 눌러 따라 말하기</span>
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
    <div className="call-coach-card is-correction">
      <div className="call-coach-label">{typeLabel[card.type] ?? "표현"} 다듬기</div>
      <div className="call-coach-original">{card.original}</div>
      <div className="call-coach-title">{card.better}</div>
      {card.ko && <div className="call-coach-ko">{card.ko}</div>}
      {card.reason && <div className="call-coach-reason">{card.reason}</div>}
      <div className="call-coach-actions">
        <ListenButton text={card.better} tutorId={tutorId} />
        <span className="call-coach-prompt">자연스러운 문장을 다시 들어보세요</span>
      </div>
    </div>
  );
}

/** 리포트용 뒤집기 카드 (원문 → 교정문) */
export function FlipCard({ card, tutorId }: { card: CorrectionCard; tutorId: string }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div className="w-full overflow-hidden rounded-2xl border border-line bg-fill transition-all duration-300 hover:border-line">
      <button
        type="button"
        onClick={() => setFlipped((value) => !value)}
        className="w-full p-4 text-left"
        aria-expanded={flipped}
        aria-label={flipped ? "내가 한 말 보기" : "더 자연스러운 표현 보기"}
      >
        {!flipped ? (
          <>
            <div className="mb-1 text-[11px] text-ink-secondary">내가 한 말 · 눌러서 교정 보기</div>
            <div className="text-base text-ink">{card.original}</div>
          </>
        ) : (
          <>
            <div className="mb-1 text-[11px] text-emerald-300">더 자연스러운 표현 · 눌러서 원문 보기</div>
            <div className="text-base font-bold text-ink">{card.better}</div>
            <div className="mt-0.5 text-sm text-ink-secondary">{card.ko}</div>
            {card.reason && <div className="mt-1.5 text-xs text-amber-200/90">💡 {card.reason}</div>}
          </>
        )}
      </button>
      {flipped && (
        <div className="-mt-1 px-4 pb-4">
          <ListenButton text={card.better} tutorId={tutorId} />
        </div>
      )}
    </div>
  );
}
