// 서버 기동 시 한 번 실행 — 예약 발송 스케줄러를 띄운다.
// 브라우저를 닫아도 친구의 답장이 도착하고 웹 푸시가 나가야 하기 때문이다.

export async function register() {
  // Edge 런타임에는 파일 저장소가 없으므로 Node 서버에서만 돈다.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.CHAT_SCHEDULER_ENABLED === "0") return;
  const { startScheduler, SCHEDULER_INTERVAL_MS } = await import("./core/scheduler");
  if (startScheduler()) {
    console.log(`[scheduler] started — checking the delivery queue every ${SCHEDULER_INTERVAL_MS / 1000}s`);
  }
}
