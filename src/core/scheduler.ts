// 서버 측 스케줄러 — 앱을 닫아도 예약된 답장이 도착하고 웹 푸시가 나가야 한다.
// 클라이언트 폴링(/api/tick)만으로는 브라우저를 닫은 순간 대화가 멈춘다.

import { tick } from "./proactive";

const INTERVAL_MS = 60_000;
/** 서버 기동 직후에는 잠깐 여유를 둔다 (첫 요청과 겹치지 않게). */
const FIRST_RUN_DELAY_MS = 15_000;

const globalScheduler = globalThis as typeof globalThis & {
  __avatarTutorScheduler?: { timer: NodeJS.Timeout; running: boolean };
};

async function runOnce() {
  const state = globalScheduler.__avatarTutorScheduler;
  if (!state || state.running) return;
  state.running = true;
  try {
    const result = await tick();
    if (result.delivered > 0 || result.generated) {
      console.log(`[scheduler] delivered=${result.delivered} generated=${result.generated ?? "none"}`);
    }
  } catch (error) {
    console.error("[scheduler] tick failed:", error);
  } finally {
    state.running = false;
  }
}

/**
 * 프로세스당 한 번만 시작한다. dev의 모듈 재평가에도 타이머가 중복되지 않도록
 * globalThis에 상태를 붙인다.
 */
export function startScheduler(): boolean {
  if (globalScheduler.__avatarTutorScheduler) return false;
  const timer = setInterval(() => void runOnce(), INTERVAL_MS);
  // 서버가 종료를 기다리게 만들지 않는다.
  timer.unref?.();
  globalScheduler.__avatarTutorScheduler = { timer, running: false };
  setTimeout(() => void runOnce(), FIRST_RUN_DELAY_MS).unref?.();
  return true;
}

export function stopScheduler() {
  const state = globalScheduler.__avatarTutorScheduler;
  if (!state) return;
  clearInterval(state.timer);
  delete globalScheduler.__avatarTutorScheduler;
}

export const SCHEDULER_INTERVAL_MS = INTERVAL_MS;
