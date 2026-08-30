"use client";

// 대화 스크립트 — 발화 확인, 일반/느린 재생, 번역, 내 음성과 원어민 음성 비교.

import { useState } from "react";
import { useAudioPlayer, type PlayableAudio } from "@/hooks/useAudioPlayer";
import { useDialogFocus } from "@/hooks/useDialogFocus";

export interface ClientTurn {
  id: string;
  role: "user" | "tutor";
  text: string;
  ko?: string;
  audio?: PlayableAudio | null;
  userBlob?: Blob;
}

interface Props {
  turns: ClientTurn[];
  tutorId: string;
  onClose: () => void;
}

export default function TranscriptSheet({ turns, tutorId, onClose }: Props) {
  const [showKo, setShowKo] = useState<Record<string, boolean>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const player = useAudioPlayer(tutorId);
  const dialogRef = useDialogFocus<HTMLElement>(onClose);
  const playbackBusy = player.phase !== "idle";

  const playTurn = (turn: ClientTurn, rate: number) => {
    const key = `${turn.id}-${rate}`;
    if (playbackBusy) {
      if (activeKey === key) player.stop();
      return;
    }
    setActiveKey(key);
    if (turn.role === "user" && turn.userBlob) {
      player.playBlob(turn.userBlob, rate);
      return;
    }
    if (turn.audio) {
      player.play(turn.audio, turn.text, { rate });
      return;
    }
    void player.playTTS(turn.text, { rate });
  };

  const playNative = (turn: ClientTurn) => {
    const key = `${turn.id}-native`;
    if (playbackBusy) {
      if (activeKey === key) player.stop();
      return;
    }
    setActiveKey(key);
    void player.playTTS(turn.text);
  };

  return (
    <div className="apple-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="apple-bottom-sheet transcript-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transcript-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="apple-sheet-handle" />
        <header className="apple-sheet-header">
          <div>
            <span>이번 통화</span>
            <h2 id="transcript-title">대화 스크립트</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="스크립트 닫기"><CloseIcon /></button>
        </header>

        <div className="transcript-list">
          {turns.length === 0 && (
            <div className="transcript-empty">
              <ScriptIcon />
              <strong>아직 기록된 대화가 없어요</strong>
              <span>첫 문장을 말하면 여기에 바로 표시됩니다.</span>
            </div>
          )}

          {turns.map((turn, index) => (
            <article key={turn.id} className={`transcript-turn ${turn.role === "user" ? "is-user" : "is-tutor"}`}>
              <div className="transcript-turn-meta">
                <span>{turn.role === "user" ? "나" : "튜터"}</span>
                <span>{index + 1}</span>
              </div>
              <p className="transcript-text">{turn.text}</p>
              {showKo[turn.id] && turn.ko && <p className="transcript-translation">{turn.ko}</p>}

              <div className="transcript-actions">
                <PlaybackButton
                  label="듣기"
                  active={playbackBusy && activeKey === `${turn.id}-1`}
                  loading={player.phase === "loading" && activeKey === `${turn.id}-1`}
                  disabled={playbackBusy && activeKey !== `${turn.id}-1`}
                  onClick={() => playTurn(turn, 1)}
                  icon={<PlayIcon />}
                />
                <PlaybackButton
                  label="천천히"
                  active={playbackBusy && activeKey === `${turn.id}-0.7`}
                  loading={player.phase === "loading" && activeKey === `${turn.id}-0.7`}
                  disabled={playbackBusy && activeKey !== `${turn.id}-0.7`}
                  onClick={() => playTurn(turn, 0.7)}
                  icon={<SlowIcon />}
                />
                {turn.role === "tutor" && turn.ko && (
                  <button
                    type="button"
                    onClick={() => setShowKo((state) => ({ ...state, [turn.id]: !state[turn.id] }))}
                    className={`transcript-action ${showKo[turn.id] ? "is-active" : ""}`}
                    aria-pressed={!!showKo[turn.id]}
                  >
                    <TranslateIcon /> {showKo[turn.id] ? "해석 닫기" : "해석"}
                  </button>
                )}
                {turn.role === "user" && turn.userBlob && (
                  <PlaybackButton
                    label="원어민 비교"
                    active={playbackBusy && activeKey === `${turn.id}-native`}
                    loading={player.phase === "loading" && activeKey === `${turn.id}-native`}
                    disabled={playbackBusy && activeKey !== `${turn.id}-native`}
                    onClick={() => playNative(turn)}
                    icon={<CompareIcon />}
                  />
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function PlaybackButton({ label, active, loading, disabled, onClick, icon }: { label: string; active: boolean; loading: boolean; disabled: boolean; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`transcript-action ${active ? "is-active" : ""}`} aria-pressed={active} disabled={disabled}>
      {loading ? <span className="mini-spinner" /> : active ? <PauseIcon /> : icon} {loading ? "준비 중" : label}
    </button>
  );
}

const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
function CloseIcon() { return <Svg><path d="m7 7 10 10M17 7 7 17" /></Svg>; }
function ScriptIcon() { return <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M8.5 8h7M8.5 12h7M8.5 16h4" /></svg>; }
function PlayIcon() { return <Svg><path d="m9 7 8 5-8 5V7Z" /></Svg>; }
function PauseIcon() { return <Svg><path d="M9 7v10M15 7v10" /></Svg>; }
function SlowIcon() { return <Svg><path d="M7 15a5 5 0 0 1 10 0v1H7v-1ZM17 14h2a1.5 1.5 0 1 1 0 3h-2M9 16v2m6-2v2M5 15H3" /></Svg>; }
function TranslateIcon() { return <Svg><path d="M4 5h10M9 3v2M6 8c1 3 3 5 6 6M12 8c-1 3-3 5-6 6M14 20l3-8 3 8M15 17h4" /></Svg>; }
function CompareIcon() { return <Svg><path d="M8 8a4 4 0 1 1 4 4H8V8ZM16 16a4 4 0 1 1-4-4h4v4Z" /></Svg>; }
