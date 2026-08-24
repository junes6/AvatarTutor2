// 프롬프트 로더 — 모든 시스템 프롬프트는 /prompts/*.md 파일에 있다.
// 파일만 수정하면 코드 변경 없이 튜터 동작이 바뀐다 (외부 검증 구조).

import fs from "fs";
import path from "path";

const PROMPTS_DIR = path.join(process.cwd(), "prompts");
const cache = new Map<string, { text: string; mtime: number }>();

export function loadPrompt(name: string, vars: Record<string, string> = {}): string {
  const file = path.join(PROMPTS_DIR, `${name}.md`);
  const stat = fs.statSync(file);
  const cached = cache.get(name);
  let text: string;
  if (cached && cached.mtime === stat.mtimeMs) {
    text = cached.text;
  } else {
    text = fs.readFileSync(file, "utf8");
    cache.set(name, { text, mtime: stat.mtimeMs });
  }
  // {{변수}} 치환 — 정의 안 된 변수는 빈 문자열
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}
