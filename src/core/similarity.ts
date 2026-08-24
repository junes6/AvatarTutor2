// 문장 유사도 채점 — 따라 말하기 판정 + 발음 근사 채점(폴백)에 사용.

function normalize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// 단어 배열 기준 편집거리
function levenshtein(a: string[], b: string[]): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

/** 0~100 점수. 축약형('m ↔ am 등)은 관대하게 처리 */
export function sentenceSimilarity(target: string, said: string): number {
  const expand = (s: string) =>
    s
      .replace(/\bi'm\b/gi, "i am")
      .replace(/\byou're\b/gi, "you are")
      .replace(/\bit's\b/gi, "it is")
      .replace(/\bthat's\b/gi, "that is")
      .replace(/\bcan't\b/gi, "cannot")
      .replace(/\bwon't\b/gi, "will not")
      .replace(/\bi'd\b/gi, "i would")
      .replace(/\bi'll\b/gi, "i will")
      .replace(/\bi've\b/gi, "i have")
      .replace(/\bdon't\b/gi, "do not");
  const a = normalize(expand(target));
  const b = normalize(expand(said));
  if (a.length === 0 || b.length === 0) return 0;
  const dist = levenshtein(a, b);
  const ratio = 1 - dist / Math.max(a.length, b.length);
  return Math.max(0, Math.round(ratio * 100));
}

/** 단어별 매칭 여부 (UI 하이라이트용) */
export function wordMatches(target: string, said: string): { word: string; score: number }[] {
  const saidSet = new Set(normalize(said));
  return normalize(target).map((word) => ({ word, score: saidSet.has(word) ? 100 : 0 }));
}
