"use client";

// 효과음 — 에셋 없이 WebAudio로 생성 (딩, 팡, 레벨업, 통화 연결음)

let ctx: AudioContext | null = null;
function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.15) {
  const c = getCtx();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(gain, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + start + dur);
  osc.connect(g).connect(c.destination);
  osc.start(c.currentTime + start);
  osc.stop(c.currentTime + start + dur + 0.05);
}

/** 정답/통과 팡 */
export function sfxSuccess() {
  tone(523, 0, 0.15, "triangle", 0.2);
  tone(659, 0.08, 0.15, "triangle", 0.2);
  tone(784, 0.16, 0.25, "triangle", 0.2);
}

/** 콤보 상승 */
export function sfxCombo(combo: number) {
  const base = 523 + Math.min(combo, 8) * 60;
  tone(base, 0, 0.1, "square", 0.08);
  tone(base * 1.5, 0.07, 0.15, "square", 0.08);
}

/** 스테이지 클리어 / 유닛 완료 */
export function sfxLevelUp() {
  [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.3, "triangle", 0.18));
}

/** 가벼운 팝 (카드 등장 등) */
export function sfxPop() {
  tone(880, 0, 0.08, "sine", 0.1);
}

/** 실패/다시 */
export function sfxRetry() {
  tone(330, 0, 0.15, "sine", 0.12);
  tone(294, 0.12, 0.2, "sine", 0.12);
}

/** 통화 연결음 — stop 함수 반환 */
export function sfxRingtone(): () => void {
  const c = getCtx();
  let stopped = false;
  const ring = () => {
    if (stopped) return;
    tone(440, 0, 0.35, "sine", 0.1);
    tone(480, 0, 0.35, "sine", 0.1);
    tone(440, 0.5, 0.35, "sine", 0.1);
    tone(480, 0.5, 0.35, "sine", 0.1);
  };
  ring();
  const iv = setInterval(ring, 2500);
  return () => {
    stopped = true;
    clearInterval(iv);
    void c;
  };
}

/** 통화 종료 */
export function sfxHangup() {
  tone(400, 0, 0.12, "sine", 0.12);
  tone(300, 0.14, 0.2, "sine", 0.12);
}

/** 메시지 수신 */
export function sfxMessage() {
  tone(740, 0, 0.1, "sine", 0.12);
  tone(988, 0.09, 0.16, "sine", 0.12);
}
