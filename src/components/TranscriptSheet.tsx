"use client";

// 다시듣기 시트 — 문장 단위 재생 · 0.7배속 · 번역 토글 · 내 발음 vs 원어민 비교

import { useState } from "react";
import { fetchTTS, type PlayableAudio } from "@/hooks/useAudioPlayer";

export interface ClientTurn {
  id: string;
  role: "user" | "tutor";
  text: string;
  ko?: string;
  audio?: PlayableAudio | null; // 튜터 발화의 TTS (턴 응답에 포함됨)
  userBlob?: Blob; // 내 발화 녹음
}

interface Props {
  turns: ClientTurn[];
  tutorId: string;
  onClose: () => void;
}

export default function TranscriptSheet({ turns, tutorId, onClose }: Props) {
  const [showKo, setShowKo] = useState<Record<string, boolean>>({});
  const [playing, setPlaying] = useState<string | null>(null);

  const playAudio = (src: string, rate: number, key: string) => {
    const el = new Audio(src);
    el.playbackRate = rate;
    setPlaying(key);
    el.onended = () => setPlaying(null);
    el.play().catch(() => setPlaying(null));
  };

  const playTurn = async (t: ClientTurn, rate: number) => {
    const key = t.id + rate;
    if (t.role === "user" && t.userBlob) {
      playAudio(URL.createObjectURL(t.userBlob), rate, key);
      return;
    }
    if (t.audio) {
      playAudio(`data:${t.audio.mime};base64,${t.audio.audioBase64}`, rate, key);
      return;
    }
    const audio = await fetchTTS(t.text, tutorId);
    if (audio) playAudio(`data:${audio.mime};base64,${audio.audioBase64}`, rate, key);
  };

  /** 내 발화를 원어민 TTS로 (비교 재생) */
  const playNative = async (t: ClientTurn) => {
    const audio = await fetchTTS(t.text, tutorId);
    if (audio) playAudio(`data:${audio.mime};base64,${audio.audioBase64}`, 1.0, t.id + "native");
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div
        className="bg-slate-900 rounded-t-3xl max-h-[75vh] flex flex-col border-t border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h3 className="font-bold text-white">대화 다시듣기</h3>
          <button onClick={onClose} className="text-white/50 text-sm px-3 py-1 rounded-full bg-white/10">
            닫기
          </button>
        </div>
        <div className="overflow-y-auto p-4 space-y-3">
          {turns.length === 0 && <div className="text-white/40 text-sm text-center py-8">아직 대화가 없어요</div>}
          {turns.map((t) => (
            <div key={t.id} className={`rounded-xl p-3 ${t.role === "user" ? "bg-emerald-500/10" : "bg-white/5"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] text-white/40 mb-0.5">{t.role === "user" ? "나" : "튜터"}</div>
                  <div className="text-sm text-white">{t.text}</div>
                  {showKo[t.id] && t.ko && <div className="text-xs text-white/60 mt-1">{t.ko}</div>}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <button
                  onClick={() => playTurn(t, 1.0)}
                  className={`px-2.5 py-1 rounded-full text-[11px] ${playing === t.id + 1 ? "bg-emerald-500 text-white" : "bg-white/10 text-white/80"}`}
                >
                  ▶ 재생
                </button>
                <button
                  onClick={() => playTurn(t, 0.7)}
                  className="px-2.5 py-1 rounded-full text-[11px] bg-white/10 text-white/80"
                >
                  0.7×
                </button>
                {t.role === "tutor" && t.ko && (
                  <button
                    onClick={() => setShowKo((s) => ({ ...s, [t.id]: !s[t.id] }))}
                    className="px-2.5 py-1 rounded-full text-[11px] bg-white/10 text-white/80"
                  >
                    {showKo[t.id] ? "번역 숨기기" : "번역 보기"}
                  </button>
                )}
                {t.role === "user" && t.userBlob && (
                  <button onClick={() => playNative(t)} className="px-2.5 py-1 rounded-full text-[11px] bg-indigo-500/30 text-indigo-200">
                    원어민 발음과 비교
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
