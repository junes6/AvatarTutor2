"use client";

// 말하기 힌트 — 한국어 의도를 자연스러운 영어 문장으로 바꾸고 바로 들어본다.

import { useRef, useState } from "react";
import { useRecorder } from "@/hooks/useRecorder";
import { stopGlobalAudioPlayback, useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useDialogFocus } from "@/hooks/useDialogFocus";

interface HintResult {
  primary: { en: string; ko: string };
  natural?: { en: string; ko: string };
}

interface Props {
  tutorId: string;
  lastTutorLine: string;
  onClose: () => void;
}

export default function HintSheet({ tutorId, lastTutorLine, onClose }: Props) {
  const [korean, setKorean] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState<string | null>(null);
  const [result, setResult] = useState<HintResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const recorder = useRecorder({ language: "ko-KR" });
  const player = useAudioPlayer(tutorId);
  const dialogRef = useDialogFocus<HTMLElement>(onClose);
  const requestGuardRef = useRef(false);
  const micActionRef = useRef(false);
  const isRecording = recorder.phase === "requesting" || recorder.phase === "recording" || recorder.phase === "finalizing";
  const isListening = player.phase !== "idle";

  const requestHint = async (body: BodyInit, isForm: boolean) => {
    if (requestGuardRef.current) return;
    requestGuardRef.current = true;
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await fetch("/api/hint", {
        method: "POST",
        ...(isForm ? {} : { headers: { "Content-Type": "application/json" } }),
        body,
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        setErrorMessage(data.error || "힌트를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.");
      } else if (!data.primary?.en || !data.primary?.ko) {
        setErrorMessage("지금은 알맞은 표현을 만들지 못했어요. 문장을 조금 바꿔 다시 시도해 주세요.");
      } else {
        setResult(data);
      }
    } catch {
      setErrorMessage("힌트를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      requestGuardRef.current = false;
      setLoading(false);
    }
  };

  const submitText = () => {
    if (!korean.trim()) return;
    void requestHint(JSON.stringify({ korean: korean.trim(), lastTutorLine }), false);
  };

  const toggleMic = async () => {
    if (loading || recorder.phase === "finalizing") return;
    if (recorder.phase === "requesting") {
      recorder.cancel();
      micActionRef.current = false;
      return;
    }
    if (micActionRef.current) return;
    micActionRef.current = true;
    try {
      if (recorder.phase === "recording") {
        const recording = await recorder.stop();
        if (!recording) {
          setErrorMessage("조금 더 길게 말한 뒤 다시 완료해 주세요.");
          return;
        }
        const spokenText = recording.transcript?.trim() ?? "";
        if (spokenText) setKorean(spokenText);
        recorder.resetTranscript();
        const form = new FormData();
        form.append("audio", recording.blob, "hint.webm");
        form.append("lastTutorLine", lastTutorLine);
        if (spokenText) form.append("text", spokenText);
        await requestHint(form, true);
      } else {
        stopGlobalAudioPlayback();
        await recorder.start();
      }
    } finally {
      micActionRef.current = false;
    }
  };

  const listen = (text: string, key: string) => {
    if (isListening) {
      if (listening === key) player.stop();
      return;
    }
    setListening(key);
    void player.playTTS(text);
  };

  return (
    <div className="apple-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="apple-bottom-sheet hint-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hint-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="apple-sheet-handle" />
        <header className="apple-sheet-header">
          <div>
            <span>말이 막힐 때</span>
            <h2 id="hint-title">뭐라고 말하지?</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="힌트 닫기"><CloseIcon /></button>
        </header>

        {!result ? (
          <div className="hint-compose">
            <p>하고 싶은 말을 한국어로 알려주세요. 지금 대화에 맞는 영어로 바꿔드릴게요.</p>
            <label htmlFor="hint-korean">하고 싶은 말</label>
            <div className="hint-input-row">
              <input
                id="hint-korean"
                value={recorder.liveTranscript || korean}
                onChange={(event) => setKorean(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submitText();
                  }
                }}
                placeholder="예: 사실 매운 음식을 잘 못 먹어요"
                maxLength={500}
                enterKeyHint="done"
                disabled={isRecording}
                autoFocus
                data-dialog-initial-focus
              />
              <button
                type="button"
                onClick={() => void toggleMic()}
                className={`hint-mic-button ${isRecording ? "is-active" : ""}`}
                aria-label={recorder.phase === "requesting" ? "마이크 연결 취소" : recorder.phase === "finalizing" ? "말 인식 중" : recorder.phase === "recording" ? "녹음 마치기" : "한국어로 말하기"}
                aria-pressed={isRecording}
                disabled={loading || recorder.phase === "finalizing"}
              >
                {isRecording ? <StopIcon /> : <MicIcon />}
              </button>
            </div>
            {isRecording && (
              <div className="hint-recording-status" role="status" aria-live="polite" aria-atomic="true">
                <span /> {recorder.phase === "requesting"
                  ? "마이크 연결 중 · 다시 누르면 취소돼요."
                  : recorder.phase === "finalizing"
                    ? "말한 내용을 확인하고 있어요."
                    : "한국어로 듣고 있어요. 다시 누르면 완료돼요."}
              </div>
            )}
            {(errorMessage || recorder.error) && <div className="hint-error" role="alert">{errorMessage || recorder.error?.message}</div>}
            <button type="button" onClick={submitText} disabled={loading || !korean.trim() || isRecording} className="apple-primary-button">
              {loading ? <><span className="mini-spinner light" /> 문장 만드는 중</> : <>영어 표현 보기 <ArrowRightIcon /></>}
            </button>
          </div>
        ) : (
          <div className="hint-results">
            {[result.primary, result.natural].filter(Boolean).map((hint, index) => (
              <article key={index} className={index === 0 ? "is-primary" : ""}>
                <span>{index === 0 ? "바로 말해보세요" : "조금 더 자연스럽게"}</span>
                <h3>{hint!.en}</h3>
                <p>{hint!.ko}</p>
                <button
                  type="button"
                  onClick={() => listen(hint!.en, String(index))}
                  disabled={isListening && listening !== String(index)}
                  aria-pressed={isListening && listening === String(index)}
                >
                  {isListening && listening === String(index) && player.phase === "loading" ? (
                    <span className="mini-spinner" />
                  ) : (
                    <SpeakerIcon />
                  )}{" "}
                  {isListening && listening === String(index) ? "중지" : "듣기"}
                </button>
              </article>
            ))}
            <div className="hint-result-actions">
              <button type="button" onClick={() => { setResult(null); setKorean(""); setErrorMessage(""); }}>다른 문장 물어보기</button>
              <button type="button" onClick={onClose} className="apple-primary-button">이 표현으로 말하기</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

const Svg = ({ children, size = 18 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
function CloseIcon() { return <Svg><path d="m7 7 10 10M17 7 7 17" /></Svg>; }
function MicIcon() { return <Svg size={22}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></Svg>; }
function StopIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3" /></svg>; }
function SpeakerIcon() { return <Svg><path d="M11 5 7 9H3v6h4l4 4V5ZM15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12" /></Svg>; }
function ArrowRightIcon() { return <Svg><path d="M5 12h14M14 7l5 5-5 5" /></Svg>; }
