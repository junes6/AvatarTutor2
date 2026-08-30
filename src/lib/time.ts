// 카톡과 같은 시간 표기 규칙 — 목록은 압축, 말풍선은 시:분, 구분선은 날짜.

const listFormatter = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit" });
const dateFormatter = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" });
const dividerFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});

function startOfDay(ts: number): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function daysApart(a: number, b: number): number {
  return Math.round((startOfDay(a) - startOfDay(b)) / 86_400_000);
}

/** 채팅 목록의 오른쪽 위 시간 — 오늘은 시각, 어제는 "어제", 그 전은 날짜. */
export function listTime(ts: number, now = Date.now()): string {
  if (!ts) return "";
  const diff = daysApart(now, ts);
  if (diff <= 0) return listFormatter.format(new Date(ts));
  if (diff === 1) return "어제";
  if (diff < 7) return `${diff}일 전`;
  return dateFormatter.format(new Date(ts));
}

/** 말풍선 옆 시각 */
export function bubbleTime(ts: number): string {
  if (!ts) return "";
  return listFormatter.format(new Date(ts));
}

/** 날짜 구분선 */
export function dayDivider(ts: number, now = Date.now()): string {
  const diff = daysApart(now, ts);
  if (diff <= 0) return "오늘";
  if (diff === 1) return "어제";
  return dividerFormatter.format(new Date(ts));
}

/** 같은 날인지 — 구분선을 넣을 위치 판단용 */
export function sameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

/** "3분 뒤", "2시간 뒤" 같은 상대 시각 */
export function relativeFuture(ts: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((ts - now) / 1000));
  if (seconds < 60) return `${seconds}초 뒤`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}분 뒤`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 뒤`;
  return `${Math.round(hours / 24)}일 뒤`;
}
