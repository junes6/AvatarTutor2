"use client";

// 채팅방 나가기 — 사유는 궁합 모델을 갱신하는 신호지만 강제하지 않는다.

import { useState } from "react";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import type { LeaveReason } from "@/core/types";

const REASONS: { id: LeaveReason; label: string }[] = [
  { id: "mismatch", label: "대화가 잘 안 맞아요" },
  { id: "too-hard", label: "너무 어려워요" },
  { id: "too-easy", label: "너무 쉬워요" },
  { id: "slow", label: "응답이 느려요" },
  { id: "none", label: "그냥요" },
];

interface Props {
  tutorName: string;
  onClose: () => void;
  onLeave: (reason: LeaveReason) => void;
}

export default function LeaveSheet({ tutorName, onClose, onLeave }: Props) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);
  const [selected, setSelected] = useState<LeaveReason | null>(null);

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div
        ref={dialogRef}
        className="compact-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" />
        <h2 id="leave-title" className="text-[19px] font-semibold">{tutorName}와의 채팅방을 나갈까요?</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-white/55">
          대화 기록은 보관되고 언제든 다시 시작할 수 있어요. 레벨·복습 큐·XP는 그대로 남아요.
        </p>

        <div className="reason-list">
          {REASONS.map((reason) => (
            <button
              key={reason.id}
              type="button"
              className={`reason-item ${selected === reason.id ? "is-selected" : ""}`}
              onClick={() => setSelected(reason.id)}
              aria-pressed={selected === reason.id}
            >
              {reason.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="sheet-secondary flex-1">
            돌아가기
          </button>
          <button type="button" onClick={() => onLeave(selected ?? "none")} className="sheet-danger flex-1">
            {selected ? "나가기" : "건너뛰고 나가기"}
          </button>
        </div>
      </div>
    </div>
  );
}
