// 파일 기반 JSON 저장소 — data/store/ 아래에 상태를 보관한다.
// 외부 DB 없이 감사(audit) 가능하도록 사람이 읽을 수 있는 JSON을 유지한다.

import fs from "fs";
import path from "path";

// STORE_DIR 환경변수로 저장 위치를 바꿀 수 있다 (simulate.ts가 임시 폴더로 격리할 때 사용)
const ROOT = process.env.STORE_DIR
  ? path.resolve(process.env.STORE_DIR)
  : path.join(process.cwd(), "data", "store");

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function fileFor(name: string) {
  // name 예: "user", "chats/mia", "sessions/abc123"
  const safe = name.replace(/[^a-zA-Z0-9_\-/]/g, "");
  return path.join(ROOT, ...safe.split("/")) + ".json";
}

export function readJSON<T>(name: string, fallback: T): T {
  const file = fileFor(name);
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (error) {
    // 손상된 상태를 기본값으로 조용히 가장하면 다음 저장에서 사용자 데이터가
    // 덮어써질 수 있다. 복구 가능한 운영 로그를 반드시 남긴다.
    console.error(`[store] failed to read ${file}`, error);
    return fallback;
  }
}

export function writeJSON<T>(name: string, data: T): void {
  const file = fileFor(name);
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, file);
  } catch (error) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw error;
  }
}

export function deleteJSON(name: string): boolean {
  const file = fileFor(name);
  try {
    fs.unlinkSync(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function listNames(dir: string): string[] {
  const full = path.join(ROOT, dir);
  try {
    return fs
      .readdirSync(full)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

export function todayStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return todayStr(d);
}

export function uid(prefix = ""): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
