"use client";

// 음성 메시지 — 파형 + 재생 + 스크립트 토글.
// 오디오는 재생 시점에 /api/tts로 합성하므로 저장소에 파일이 쌓이지 않는다.

import { useState } from "react";
import { formatDuration } from "@/core/voiceNote";
import type { VoiceNote } from "@/core/types";

interface Props {
  voice: VoiceNote;
  mine: boolean;
  speaking: boolean;
  onSpeak: () => void;
}

export default function VoiceBubble({ voice, mine, speaking, onSpeak }: Props) {
  const [showScript, setShowScript] = useState(false);

  return (
    <div className={`voice-bubble ${mine ? "is-user" : ""} ${speaking ? "is-playing" : ""}`}>
      <div className="voice-row">
        <button
          type="button"
          className="voice-play"
          onClick={onSpeak}
          aria-label={speaking ? "재생 중" : "음성 메시지 재생"}
        >
          {speaking ? <PauseIcon /> : <PlayIcon />}
        </button>
        <div className="voice-wave" aria-hidden="true">
          {voice.peaks.map((peak, index) => (
            <i key={index} style={{ height: `${Math.max(12, peak * 100)}%` }} />
          ))}
        </div>
        <span className="voice-duration">{formatDuration(voice.durationSec)}</span>
      </div>
      <button
        type="button"
        className="voice-script-toggle"
        onClick={() => setShowScript((value) => !value)}
        aria-expanded={showScript}
      >
        {showScript ? "스크립트 닫기" : "스크립트 보기"}
      </button>
      {showScript && (
        <div className="voice-script">
          <p>{voice.script}</p>
          {voice.scriptKo && <p className="voice-script-ko">{voice.scriptKo}</p>}
        </div>
      )}
    </div>
  );
}

function PlayIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 5 8 5-8 5V5Z" /></svg>;
}

function PauseIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6" y="5" width="3" height="10" rx="1" /><rect x="11" y="5" width="3" height="10" rx="1" /></svg>;
}
