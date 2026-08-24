"use client";

// 장면 배경 — 화이트아웃 전환 + 타이틀 + 환경음 루프 (파일 없으면 조용히 무시)

import { useEffect, useRef, useState } from "react";

interface Props {
  image?: string;
  ambience?: string;
  title?: string;
  titleKo?: string;
}

export default function SceneBackdrop({ image, ambience, title, titleKo }: Props) {
  const [phase, setPhase] = useState<"white" | "title" | "done">("white");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("title"), 500);
    const t2 = setTimeout(() => setPhase("done"), 2200);
    if (ambience) {
      const audio = new Audio(ambience);
      audio.loop = true;
      audio.volume = 0.12;
      audio.play().catch(() => {}); // 자동재생 차단/파일 없음 → 무시
      audioRef.current = audio;
    }
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, [ambience]);

  return (
    <>
      {/* 배경 이미지 */}
      <div className="absolute inset-0 -z-10">
        {image ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/55" />
          </>
        ) : (
          <div className="w-full h-full bg-gradient-to-b from-slate-900 via-slate-950 to-black" />
        )}
      </div>
      {/* 화이트아웃 + 타이틀 */}
      {phase !== "done" && (
        <div
          className={`absolute inset-0 z-40 flex items-center justify-center bg-white transition-opacity duration-700 ${
            phase === "white" ? "opacity-100" : "opacity-0"
          }`}
          style={{ pointerEvents: "none" }}
        />
      )}
      {phase === "title" && title && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center pointer-events-none animate-[fadeInOut_1.7s_ease]">
          <div className="text-4xl font-bold text-white drop-shadow-lg">{title}</div>
          {titleKo && <div className="mt-2 text-lg text-white/80">{titleKo}</div>}
        </div>
      )}
    </>
  );
}
