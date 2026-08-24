"use client";

// 푸시투토크 버튼 — 누르는 동안 녹음(파형 표시), 떼면 전송, 위로 슬라이드하면 취소.
// 튜터가 말하는 중에는 비활성 표시되지만 탭하면 즉시 튜터 음성을 멈추고 내 차례로.

import { useRef, useState } from "react";
import { useRecorder, type RecorderResult } from "@/hooks/useRecorder";

const CANCEL_DISTANCE = 80;

interface Props {
  onResult: (r: RecorderResult) => void;
  onInterrupt?: () => void; // 튜터 말 끊기
  tutorSpeaking: boolean;
  busy: boolean; // 서버 처리 중
}

export default function PushToTalkButton({ onResult, onInterrupt, tutorSpeaking, busy }: Props) {
  const { start, stop, cancel, isRecording, level } = useRecorder();
  const [inCancelZone, setInCancelZone] = useState(false);
  const startYRef = useRef(0);
  const activeRef = useRef(false);

  const handleDown = async (e: React.PointerEvent) => {
    if (busy) return;
    if (tutorSpeaking) {
      onInterrupt?.();
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    startYRef.current = e.clientY;
    setInCancelZone(false);
    activeRef.current = true;
    const ok = await start();
    if (!ok) {
      activeRef.current = false;
      alert("마이크 권한이 필요해요. 브라우저 설정에서 허용해 주세요.");
    }
  };

  const handleMove = (e: React.PointerEvent) => {
    if (!activeRef.current) return;
    setInCancelZone(startYRef.current - e.clientY > CANCEL_DISTANCE);
  };

  const handleUp = async () => {
    if (!activeRef.current) return;
    activeRef.current = false;
    if (inCancelZone) {
      cancel();
      setInCancelZone(false);
      return;
    }
    const result = await stop();
    setInCancelZone(false);
    if (result) onResult(result);
  };

  const size = isRecording ? 96 + level * 28 : 80;
  const disabled = busy;
  const showInterrupt = tutorSpeaking && !isRecording;

  return (
    <div className="relative flex flex-col items-center select-none touch-none">
      {isRecording && (
        <div
          className={`absolute -top-12 text-sm font-medium px-3 py-1 rounded-full transition-colors ${
            inCancelZone ? "bg-red-500 text-white" : "bg-white/10 text-white/70"
          }`}
        >
          {inCancelZone ? "놓으면 취소돼요" : "↑ 위로 밀면 취소"}
        </div>
      )}
      {/* 파형 링 */}
      {isRecording && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className="rounded-full border-2 border-emerald-400/60 animate-ping"
            style={{ width: size + 30, height: size + 30 }}
          />
        </div>
      )}
      <button
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        onContextMenu={(e) => e.preventDefault()}
        disabled={disabled}
        className={`relative rounded-full flex items-center justify-center transition-all duration-100 shadow-xl ${
          isRecording
            ? inCancelZone
              ? "bg-red-500"
              : "bg-emerald-500"
            : showInterrupt
              ? "bg-white/15 backdrop-blur"
              : busy
                ? "bg-white/10"
                : "bg-emerald-600 active:bg-emerald-500"
        }`}
        style={{ width: size, height: size }}
        aria-label={isRecording ? "녹음 중 — 놓으면 전송" : "누르고 말하기"}
      >
        {busy ? (
          <div className="w-8 h-8 border-3 border-white/30 border-t-white rounded-full animate-spin" />
        ) : isRecording ? (
          <WaveBars level={level} />
        ) : showInterrupt ? (
          <span className="text-2xl">✋</span>
        ) : (
          <MicIcon />
        )}
      </button>
      <div className="mt-2 text-xs text-white/50 h-4">
        {busy ? "생각 중..." : isRecording ? "듣고 있어요" : showInterrupt ? "탭하면 내 차례" : "누르고 말하기"}
      </div>
    </div>
  );
}

function WaveBars({ level }: { level: number }) {
  const bars = [0.4, 0.8, 1.0, 0.7, 0.5];
  return (
    <div className="flex items-center gap-1 h-8">
      {bars.map((b, i) => (
        <div
          key={i}
          className="w-1.5 bg-white rounded-full transition-all duration-75"
          style={{ height: 6 + b * level * 26 + (isFinite(level) ? Math.random() * level * 6 : 0) }}
        />
      ))}
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
      <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" />
      <path d="M19 11a7 7 0 0 1-14 0H3a9 9 0 0 0 8 8.94V22h2v-2.06A9 9 0 0 0 21 11h-2z" />
    </svg>
  );
}
