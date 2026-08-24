"use client";

// 힌트 시트 — 말이 막힐 때: 한국어 입력/발화 → "이렇게 말해보세요" 영어 문장 + 듣기

import { useState } from "react";
import { useRecorder } from "@/hooks/useRecorder";
import { fetchTTS } from "@/hooks/useAudioPlayer";

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
  const [result, setResult] = useState<HintResult | null>(null);
  const [error, setError] = useState("");
  const { start, stop, isRecording } = useRecorder();

  const requestHint = async (body: BodyInit, isForm: boolean) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/hint", {
        method: "POST",
        ...(isForm ? {} : { headers: { "Content-Type": "application/json" } }),
        body,
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else setResult(data);
    } catch {
      setError("힌트를 가져오지 못했어요. 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  };

  const submitText = () => {
    if (!korean.trim()) return;
    requestHint(JSON.stringify({ korean, lastTutorLine }), false);
  };

  const toggleMic = async () => {
    if (isRecording) {
      const r = await stop();
      if (r) {
        const form = new FormData();
        form.append("audio", r.blob, "hint.webm");
        form.append("lastTutorLine", lastTutorLine);
        requestHint(form, true);
      }
    } else {
      await start();
    }
  };

  const listen = async (text: string) => {
    const audio = await fetchTTS(text, tutorId);
    if (audio) new Audio(`data:${audio.mime};base64,${audio.audioBase64}`).play().catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div className="bg-slate-900 rounded-t-3xl p-5 border-t border-white/10" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-white mb-1">💡 뭐라고 말하지?</h3>
        <p className="text-xs text-white/50 mb-4">하고 싶은 말을 한국어로 쓰거나 말하면, 영어 문장을 알려드려요.</p>

        {!result && (
          <>
            <div className="flex gap-2">
              <input
                value={korean}
                onChange={(e) => setKorean(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitText()}
                placeholder="예: 나 사실 매운 걸 잘 못 먹어"
                className="flex-1 rounded-xl bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none focus:ring-2 ring-emerald-500"
              />
              <button
                onClick={toggleMic}
                className={`w-12 rounded-xl flex items-center justify-center text-lg ${isRecording ? "bg-red-500 animate-pulse" : "bg-white/10"}`}
              >
                🎤
              </button>
            </div>
            <button
              onClick={submitText}
              disabled={loading || !korean.trim()}
              className="mt-3 w-full rounded-xl bg-emerald-600 py-3 font-semibold text-white disabled:opacity-40"
            >
              {loading ? "생각 중..." : "영어로 알려줘"}
            </button>
          </>
        )}

        {error && <div className="mt-3 text-sm text-red-400">{error}</div>}

        {result && (
          <div className="space-y-3">
            {[result.primary, result.natural].filter(Boolean).map((h, i) => (
              <div key={i} className="rounded-2xl bg-emerald-500/15 border border-emerald-400/40 p-4">
                <div className="text-[11px] font-semibold text-emerald-300 mb-1">
                  {i === 0 ? "🗣️ 이렇게 말해보세요" : "✨ 조금 더 자연스럽게"}
                </div>
                <div className="text-lg font-bold text-white">{h!.en}</div>
                <div className="text-sm text-white/70">{h!.ko}</div>
                <button onClick={() => listen(h!.en)} className="mt-2 px-2.5 py-1 rounded-full bg-white/10 text-xs text-white/80">
                  🔊 듣기
                </button>
              </div>
            ))}
            <button onClick={() => { setResult(null); setKorean(""); }} className="w-full rounded-xl bg-white/10 py-2.5 text-sm text-white/70">
              다른 문장 물어보기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
