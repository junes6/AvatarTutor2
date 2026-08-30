"use client";

// 칭찬 이펙트 — 점수 팡(콘페티), 콤보 카운터, XP 상승 애니메이션.
// trigger 값이 바뀔 때마다 터진다.

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
  // 애니메이션 종료 뒤에는 CSS가 투명 상태를 유지한다. 파생 상태와 타이머를
  // 두지 않고 trigger를 key로 사용하면 같은 효과를 더 안정적으로 재시작한다.
  const particles = trigger > 0 ? createParticles(trigger) : [];

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
      {xpGain !== null && xpGain > 0 && (
        <div
          key={`xp-${trigger}-${xpGain}`}
          className="absolute left-1/2 top-[30%] -translate-x-1/2 text-3xl font-black text-amber-300 drop-shadow-lg animate-[xpFloat_1.5s_ease-out_forwards]"
        >
          +{xpGain} XP
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
      {bannerText && (
        <div className="absolute inset-x-0 top-[42%] flex justify-center">
          <div key={`banner-${trigger}-${bannerText}`} className="px-6 py-3 rounded-2xl bg-white/10 backdrop-blur-lg border border-white/20 text-xl font-bold text-white animate-[bannerIn_2.2s_ease_forwards]">
            {bannerText}
          </div>
        </div>
      )}
    </div>
  );
}

function seeded(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function createParticles(trigger: number): Particle[] {
  return Array.from({ length: 28 }, (_, index) => ({
    id: trigger * 100 + index,
    x: 10 + seeded(trigger * 101 + index) * 80,
    color: COLORS[index % COLORS.length],
    delay: seeded(trigger * 211 + index) * 0.25,
    size: 6 + seeded(trigger * 307 + index) * 8,
    drift: (seeded(trigger * 401 + index) - 0.5) * 120,
  }));
}
