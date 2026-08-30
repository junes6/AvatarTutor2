"use client";

// 상황극 브리핑 — 시작 전에 상황·내 역할·미션·쓸만한 표현 3개를 보여주고,
// "준비됐어요"를 눌러야 시작한다.

import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import type { RoleplayBriefing } from "@/core/types";

interface Props {
  briefing: RoleplayBriefing;
  tutorId: string;
  onClose: () => void;
  onReady: () => void;
}

export default function RoleplayBriefingSheet({ briefing, tutorId, onClose, onReady }: Props) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);
  const player = useAudioPlayer(tutorId);

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div
        ref={dialogRef}
        className="briefing-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="briefing-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" />
        <span className="briefing-eyebrow">상황극 브리핑</span>
        <h2 id="briefing-title">{briefing.titleKo}</h2>
        <p className="briefing-situation">{briefing.situationKo}</p>

        <div className="briefing-roles">
          <div>
            <span>내 역할</span>
            <strong>{briefing.learnerRoleKo}</strong>
          </div>
          <div>
            <span>상대 역할</span>
            <strong>{briefing.tutorRoleKo}</strong>
          </div>
        </div>

        <div className="briefing-mission">
          <span>미션</span>
          <p>{briefing.missionKo}</p>
        </div>

        {briefing.expressions.length > 0 && (
          <div className="briefing-expressions">
            <span className="briefing-section-label">이럴 때 쓰면 좋아요</span>
            {briefing.expressions.map((expression) => (
              <div key={expression.en} className="briefing-expression">
                <div>
                  <p>{expression.en}</p>
                  <small>{expression.ko}</small>
                </div>
                <button
                  type="button"
                  className={`briefing-listen ${player.speaking ? "is-speaking" : ""}`}
                  onClick={() => void player.playTTS(expression.en, { tutorId })}
                  aria-label={`"${expression.en}" 듣기`}
                >
                  <SpeakerIcon />
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="briefing-tip">막히면 잠깐 역할을 벗고 한국어로 도와줄게요. 편하게 시작해요.</p>

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="sheet-secondary flex-1">나중에</button>
          <button type="button" onClick={onReady} className="sheet-done flex-1">준비됐어요</button>
        </div>
      </div>
    </div>
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
