"use client";

// 길게 눌러 말하기 — 실시간 음량/문장 확인, 위로 밀어 취소, 튜터 발화 즉시 끊기.

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import {
  canStartRecording,
  useRecorder,
  type RecorderError,
  type RecorderPhase,
  type RecorderResult,
} from "@/hooks/useRecorder";
import { stopGlobalAudioPlayback } from "@/hooks/useAudioPlayer";

const CANCEL_DISTANCE = 72;

interface Props {
  onResult: (result: RecorderResult) => void;
  onEmpty?: () => void;
  onInterrupt?: () => void;
  onRecordingChange?: (recording: boolean) => void;
  onPhaseChange?: (phase: RecorderPhase) => void;
  onTranscriptChange?: (transcript: string) => void;
  onUnavailable?: (error: RecorderError) => void;
  /** 현재 녹음을 끊지 않고, 다음 녹음부터 적용할 Web Speech API 언어. */
  recognitionLanguage?: string;
  tutorSpeaking: boolean;
  busy: boolean;
}

export default function PushToTalkButton({
  onResult,
  onEmpty,
  onInterrupt,
  onRecordingChange,
  onPhaseChange,
  onTranscriptChange,
  onUnavailable,
  recognitionLanguage = "en-US",
  tutorSpeaking,
  busy,
}: Props) {
  const {
    start,
    stop,
    cancel,
    phase,
    level,
    liveTranscript,
    hasDetectedSpeech,
    isSpeechRecognitionSupported,
    error,
  } = useRecorder({ language: recognitionLanguage });
  const [inCancelZone, setInCancelZone] = useState(false);
  const inCancelZoneRef = useRef(false);
  const startYRef = useRef(0);
  const activeRef = useRef(false);
  const keyboardRef = useRef(false);
  const reportedErrorRef = useRef<RecorderError | null>(null);

  const isRecording = phase === "requesting" || phase === "recording" || phase === "finalizing";
  const isCapturing = phase === "recording";
  const isInputLocked = busy || phase === "finalizing";
  const isNativeDisabled = busy || phase === "finalizing";

  useEffect(() => {
    onRecordingChange?.(isRecording);
  }, [isRecording, onRecordingChange]);

  useEffect(() => {
    onPhaseChange?.(phase);
  }, [phase, onPhaseChange]);

  useEffect(() => {
    onTranscriptChange?.(liveTranscript);
  }, [liveTranscript, onTranscriptChange]);

  useEffect(() => {
    if (!error) {
      reportedErrorRef.current = null;
      return;
    }
    if (reportedErrorRef.current === error) return;
    reportedErrorRef.current = error;
    onUnavailable?.(error);
  }, [error, onUnavailable]);

  const begin = async () => {
    if (busy || activeRef.current || !canStartRecording(phase)) return;
    if (tutorSpeaking) onInterrupt?.();
    // 카드/힌트/스크립트 음성도 마이크에 다시 들어가지 않도록 모두 정리한다.
    stopGlobalAudioPlayback();
    inCancelZoneRef.current = false;
    setInCancelZone(false);
    activeRef.current = true;
    const started = await start();
    if (!started) activeRef.current = false;
  };

  const finish = async () => {
    if (!activeRef.current) return;
    activeRef.current = false;
    if (inCancelZoneRef.current) {
      cancel();
      onTranscriptChange?.("");
      inCancelZoneRef.current = false;
      setInCancelZone(false);
      return;
    }
    const completedRecording = phase === "recording";
    const result = await stop();
    inCancelZoneRef.current = false;
    setInCancelZone(false);
    if (result) onResult(result);
    else if (completedRecording) onEmpty?.();
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (busy || activeRef.current || !canStartRecording(phase)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    startYRef.current = event.clientY;
    void begin();
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!activeRef.current) return;
    const shouldCancel = startYRef.current - event.clientY > CANCEL_DISTANCE;
    inCancelZoneRef.current = shouldCancel;
    setInCancelZone(shouldCancel);
  };

  const handlePointerCancel = () => {
    if (!activeRef.current) return;
    activeRef.current = false;
    cancel();
    onTranscriptChange?.("");
    inCancelZoneRef.current = false;
    setInCancelZone(false);
  };

  const handleAssistiveClick = (event: MouseEvent<HTMLButtonElement>) => {
    // VoiceOver/TalkBack activates controls with a synthesized click and no
    // pointerdown/up pair. Treat that path as a start/stop toggle.
    if (event.detail !== 0 || busy || isInputLocked) return;
    event.preventDefault();
    if (activeRef.current) void finish();
    else void begin();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (
      (event.key !== " " && event.key !== "Enter") ||
      event.repeat ||
      busy ||
      activeRef.current ||
      !canStartRecording(phase)
    ) return;
    event.preventDefault();
    keyboardRef.current = true;
    void begin();
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if ((event.key !== " " && event.key !== "Enter") || !keyboardRef.current) return;
    event.preventDefault();
    keyboardRef.current = false;
    void finish();
  };

  const statusText = error?.message
    ?? (busy
      ? "답변을 준비하는 중"
      : phase === "requesting"
      ? "마이크 연결 중 · 놓으면 취소"
      : phase === "finalizing"
        ? "말을 확인하는 중"
        : phase === "recording"
          ? inCancelZone
            ? "놓으면 취소"
            : hasDetectedSpeech
              ? "잘 듣고 있어요"
              : "말해 주세요"
          : tutorSpeaking
            ? "눌러서 끊고 말하기"
             : "누르고 말하기");
  const actionLabel = phase === "requesting"
    ? "마이크 연결 취소"
    : phase === "recording"
      ? inCancelZone
        ? "녹음 취소"
        : "말하기 마치기"
      : phase === "finalizing"
        ? "말하기 처리 중"
        : busy
          ? "답변 준비 중"
          : tutorSpeaking
            ? "튜터 말을 끊고 말하기"
            : "말하기 시작";

  return (
    <div className="ptt-wrap">
      {phase === "recording" && (
        <div className={`ptt-cancel-hint ${inCancelZone ? "is-cancel" : ""}`} role="status">
          <ArrowUpIcon /> {inCancelZone ? "이제 놓으면 취소돼요" : "위로 밀면 취소"}
        </div>
      )}

      <button
        type="button"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => void finish()}
        onPointerCancel={handlePointerCancel}
        onClick={handleAssistiveClick}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onBlur={() => {
          if (keyboardRef.current) {
            keyboardRef.current = false;
            void finish();
          }
        }}
        onContextMenu={(event) => event.preventDefault()}
        disabled={isNativeDisabled}
        aria-disabled={isInputLocked}
        className={`ptt-button ${isCapturing ? "is-recording" : ""} ${isInputLocked ? "is-disabled" : ""} ${inCancelZone ? "is-cancel" : ""} ${tutorSpeaking ? "can-interrupt" : ""}`}
        style={{ "--voice-level": Math.max(0.05, level) } as React.CSSProperties}
        aria-label={actionLabel}
        aria-pressed={isCapturing}
        aria-busy={phase === "requesting" || phase === "finalizing"}
        aria-describedby="ptt-status"
      >
        <span className="ptt-aura" aria-hidden="true" />
        <span className="ptt-face">
          {busy || phase === "requesting" || phase === "finalizing" ? <SpinnerIcon /> : isRecording ? <WaveBars level={level} /> : <MicIcon />}
        </span>
      </button>

      <span id="ptt-status" className={`ptt-status ${error ? "is-error" : ""}`}>
        {statusText}
      </span>
      {!isSpeechRecognitionSupported && phase === "recording" && (
        <span className="sr-only">실시간 글자 표시는 통화 후 확정됩니다.</span>
      )}
    </div>
  );
}

function WaveBars({ level }: { level: number }) {
  const heights = [0.46, 0.8, 1, 0.7, 0.42];
  return (
    <span className="ptt-wave" aria-hidden="true">
      {heights.map((height, index) => (
        <i key={index} style={{ height: `${8 + height * Math.max(0.12, level) * 25}px` }} />
      ))}
    </span>
  );
}

function MicIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 10 6-6 6 6M12 4v16" />
    </svg>
  );
}

function SpinnerIcon() {
  return <span className="ptt-spinner" aria-hidden="true" />;
}
