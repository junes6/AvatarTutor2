"use client";

// 한국어 입력 코칭 카드 — 대화 흐름을 끊지 않도록 말풍선 아래에 접힌 채로 붙고,
// 탭하면 펼쳐진다.

import { useState } from "react";
import type { CoachingCard } from "@/core/types";

interface Props {
  card: CoachingCard;
  /** 듣기 버튼 — 상위에서 TTS 재생을 담당한다 */
  onSpeak: (text: string) => void;
  /** "따라 써보기" — 입력창에 문장을 깔아 준다 */
  onPractice: (text: string) => void;
  speakingText?: string | null;
  /** 이미 따라 쓰기에 성공한 카드 */
  completed?: boolean;
}

const STYLE_LABEL = { casual: "편하게", polite: "정중하게" } as const;

export default function CoachingCardView({ card, onSpeak, onPractice, speakingText, completed }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`coach-card ${open ? "is-open" : ""} ${completed ? "is-done" : ""}`}>
      <button
        type="button"
        className="coach-card-head"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="coach-card-tag">영어로는 이렇게 말해요</span>
        <span className="coach-card-peek">{card.primary.en}</span>
        <ChevronIcon className={open ? "is-open" : ""} />
      </button>

      {open && (
        <div className="coach-card-body">
          <CoachLine
            label="자연스럽게"
            en={card.primary.en}
            ko={card.primary.ko}
            primary
            speaking={speakingText === card.primary.en}
            onSpeak={onSpeak}
          />
          {card.variants.map((variant) => (
            <CoachLine
              key={variant.style}
              label={STYLE_LABEL[variant.style]}
              en={variant.en}
              ko={variant.ko}
              speaking={speakingText === variant.en}
              onSpeak={onSpeak}
            />
          ))}

          {card.tip && <p className="coach-card-tip">{card.tip}</p>}

          <button type="button" className="coach-practice" onClick={() => onPractice(card.primary.en)}>
            {completed ? "다시 써보기" : "따라 써보기"}
          </button>
        </div>
      )}
    </div>
  );
}

function CoachLine({
  label,
  en,
  ko,
  primary,
  speaking,
  onSpeak,
}: {
  label: string;
  en: string;
  ko: string;
  primary?: boolean;
  speaking?: boolean;
  onSpeak: (text: string) => void;
}) {
  return (
    <div className={`coach-line ${primary ? "is-primary" : ""}`}>
      <span className="coach-line-label">{label}</span>
      <div className="coach-line-body">
        <p className="coach-line-en">{en}</p>
        {ko && <p className="coach-line-ko">{ko}</p>}
      </div>
      <button
        type="button"
        className={`coach-listen ${speaking ? "is-speaking" : ""}`}
        onClick={() => onSpeak(en)}
        aria-label={`"${en}" 듣기`}
      >
        <SpeakerIcon />
      </button>
    </div>
  );
}

function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={`coach-chevron ${className}`} viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5.5 7.5 4.5 5 4.5-5" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" />
      <path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.2 6.6a7.6 7.6 0 0 1 0 10.8" />
    </svg>
  );
}
