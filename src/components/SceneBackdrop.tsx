"use client";

// 장면 배경 — 배경 사진을 차분한 통화 공간으로 정리하고 환경음을 낮게 유지한다.

import { useEffect, useRef } from "react";

interface Props {
  image?: string;
  ambience?: string;
  title?: string;
  titleKo?: string;
}

export default function SceneBackdrop({ image, ambience, title, titleKo }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (ambience) {
      const audio = new Audio(ambience);
      audio.loop = true;
      audio.volume = 0.08;
      audio.play().catch(() => {}); // 자동재생 차단/파일 없음 → 무시
      audioRef.current = audio;
    }
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, [ambience]);

  return (
    <div className="call-scene-backdrop" aria-hidden="true">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" />
      ) : (
        <div className="call-scene-fallback" />
      )}
      <div className="call-scene-soften" />
      <div className="call-scene-glow call-scene-glow-one" />
      <div className="call-scene-glow call-scene-glow-two" />
      {(title || titleKo) && <span className="sr-only">{titleKo ?? title}</span>}
    </div>
  );
}
