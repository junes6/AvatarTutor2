"use client";

// 칭찬 이펙트 — 점수 팡(콘페티), 콤보 카운터, XP 상승 애니메이션.
// trigger 값이 바뀔 때마다 터진다.

import { useEffect, useState } from "react";

interface Particle {
  id: number;
  x: number;
  color: string;
  delay: number;
  size: number;
  drift: number;
}

const COLORS = ["#F472B6", "#FBBF24", "#34D399", "#60A5FA", "#A78BFA", "#F87171"];

interface Props {
  trigger: number; // 증가할 때마다 콘페티 발사
  combo: number;
  xpGain: number | null; // "+15 XP" 팝업
  bannerText?: string | null; // 스테이지 전환 배너
}

export default function CelebrationLayer({ trigger, combo, xpGain, bannerText }: Props) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const [xpPop, setXpPop] = useState<{ id: number; amount: number } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    if (trigger === 0) return;
    const batch: Particle[] = Array.from({ length: 28 }, (_, i) => ({
      id: trigger * 100 + i,
      x: 10 + Math.random() * 80,
      color: COLORS[i % COLORS.length],
      delay: Math.random() * 0.25,
      size: 6 + Math.random() * 8,
      drift: (Math.random() - 0.5) * 120,
    }));
    setParticles(batch);
    const t = setTimeout(() => setParticles([]), 1800);
    return () => clearTimeout(t);
  }, [trigger]);

  useEffect(() => {
    if (xpGain === null || xpGain <= 0) return;
    setXpPop({ id: Date.now(), amount: xpGain });
    const t = setTimeout(() => setXpPop(null), 1600);
    return () => clearTimeout(t);
  }, [xpGain]);

  useEffect(() => {
    if (!bannerText) return;
    setBanner(bannerText);
    const t = setTimeout(() => setBanner(null), 2200);
    return () => clearTimeout(t);
  }, [bannerText]);

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {/* 콘페티 */}
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute rounded-sm animate-[confetti_1.6s_ease-out_forwards]"
          style={{
            left: `${p.x}%`,
            top: "35%",
            width: p.size,
            height: p.size * 0.6,
            background: p.color,
            animationDelay: `${p.delay}s`,
            ["--drift" as string]: `${p.drift}px`,
          }}
        />
      ))}
      {/* XP 팝업 */}
      {xpPop && (
        <div
          key={xpPop.id}
          className="absolute left-1/2 top-[30%] -translate-x-1/2 text-3xl font-black text-amber-300 drop-shadow-lg animate-[xpFloat_1.5s_ease-out_forwards]"
        >
          +{xpPop.amount} XP
        </div>
      )}
      {/* 콤보 */}
      {combo >= 2 && (
        <div className="absolute right-4 top-24 flex flex-col items-center animate-[popIn_0.3s_ease]">
          <div className="text-2xl font-black text-orange-400 drop-shadow">🔥 {combo}</div>
          <div className="text-[10px] text-orange-300 font-bold tracking-widest">COMBO</div>
        </div>
      )}
      {/* 스테이지 배너 */}
      {banner && (
        <div className="absolute inset-x-0 top-[42%] flex justify-center">
          <div className="px-6 py-3 rounded-2xl bg-white/10 backdrop-blur-lg border border-white/20 text-xl font-bold text-white animate-[bannerIn_2.2s_ease]">
            {banner}
          </div>
        </div>
      )}
    </div>
  );
}
