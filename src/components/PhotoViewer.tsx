"use client";

/* eslint-disable @next/next/no-img-element */

// 사진 전체보기 — 탭하면 열리고, 그 장면으로 즉석 롤플레이를 열 수 있다.

import { useDialogFocus } from "@/hooks/useDialogFocus";
import type { ChatPhoto } from "@/core/types";

interface Props {
  photo: ChatPhoto;
  caption?: string;
  onClose: () => void;
  /** 사진 속 장면으로 상황극을 시작할 수 있으면 전달된다 */
  onRoleplay?: () => void;
}

export default function PhotoViewer({ photo, caption, onClose, onRoleplay }: Props) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);

  return (
    <div className="photo-viewer" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="사진 보기"
        tabIndex={-1}
        className="photo-viewer-body"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="photo-viewer-close" onClick={onClose} aria-label="닫기">×</button>
        <img src={photo.url} alt={photo.alt} />
        {caption && <p className="photo-viewer-caption">{caption}</p>}

        <div className="photo-viewer-actions">
          {onRoleplay && (
            <button type="button" className="photo-roleplay" onClick={onRoleplay}>
              이 장면으로 상황극 하기
            </button>
          )}
        </div>

        {photo.credit ? (
          <a className="photo-credit" href={photo.credit.link} target="_blank" rel="noreferrer noopener">
            사진: {photo.credit.name} ({photo.source})
          </a>
        ) : photo.source === "local" ? (
          <span className="photo-credit">샘플 이미지 — 사진 API 키를 연결하면 실제 사진이 옵니다</span>
        ) : null}
      </div>
    </div>
  );
}
