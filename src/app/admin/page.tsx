"use client";

// 관리자 — 일별 사용량과 원가 추정

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface DailyUsage {
  date: string;
  llmInputTokens: number;
  llmOutputTokens: number;
  sttSeconds: number;
  ttsChars: number;
  costUsd: number;
  costKrw: number;
  calls: number;
}

interface AdminData {
  daily: DailyUsage[];
  providers: { llm: string; stt: string; tts: string; pronunciation: string };
  pricing: Record<string, number>;
}

export default function AdminPage() {
  const router = useRouter();
  const [data, setData] = useState<AdminData | null>(null);

  useEffect(() => {
    fetch("/api/admin")
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-line border-t-emerald-400 rounded-full animate-spin" />
      </div>
    );
  }

  const total = data.daily.reduce((acc, d) => acc + d.costUsd, 0);

  return (
    <div className="px-5 py-6 pb-14">
      <header className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push("/settings")} className="min-h-11 px-2 text-ink-secondary text-lg">
          ←
        </button>
        <h1 className="text-lg font-bold">사용량 · 원가</h1>
      </header>

      <div className="rounded-2xl bg-fill border border-line p-4 mb-4">
        <div className="text-xs text-ink-secondary mb-2">연결된 제공자</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Provider label="LLM" value={data.providers.llm} />
          <Provider label="STT" value={data.providers.stt} />
          <Provider label="TTS" value={data.providers.tts} />
          <Provider label="발음평가" value={data.providers.pronunciation} />
        </div>
      </div>

      <div className="rounded-2xl bg-amber-500/10 border border-amber-500/25 p-4 mb-4 text-center">
        <div className="text-2xl font-black text-amber-300">${total.toFixed(3)}</div>
        <div className="text-[11px] text-ink-secondary mt-0.5">누적 원가 추정 (약 {Math.round(total * (data.pricing.usdToKrw ?? 1380)).toLocaleString()}원)</div>
      </div>

      {data.daily.length === 0 && <div className="text-center text-ink-secondary text-sm py-10">아직 기록된 사용량이 없어요</div>}

      <div className="space-y-2">
        {data.daily.map((d) => (
          <div key={d.date} className="rounded-2xl bg-fill border border-line p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="font-bold text-sm">{d.date}</span>
              <span className="text-sm font-black text-amber-300">
                ${d.costUsd.toFixed(3)} <span className="text-[10px] text-ink-secondary">≈{d.costKrw.toLocaleString()}원</span>
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1 text-center text-[10px] text-ink-secondary">
              <div>
                <div className="text-ink font-semibold">{(d.llmInputTokens / 1000).toFixed(1)}K</div>
                입력 토큰
              </div>
              <div>
                <div className="text-ink font-semibold">{(d.llmOutputTokens / 1000).toFixed(1)}K</div>
                출력 토큰
              </div>
              <div>
                <div className="text-ink font-semibold">{(d.sttSeconds / 60).toFixed(1)}분</div>
                STT
              </div>
              <div>
                <div className="text-ink font-semibold">{(d.ttsChars / 1000).toFixed(1)}K자</div>
                TTS
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-ink-secondary mt-4">
        * 텍스트·STT·TTS의 단순 추정치이며, Realtime 음성 비용은 아직 포함하지 않습니다.
      </p>
    </div>
  );
}

function Provider({ label, value }: { label: string; value: string }) {
  const isMock = value === "mock";
  return (
    <div className="rounded-lg bg-fill px-3 py-2">
      <span className="text-ink-secondary">{label}</span>{" "}
      <span className={isMock ? "text-amber-300" : "text-emerald-300"}>{value}</span>
    </div>
  );
}
