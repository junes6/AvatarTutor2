// 온보딩 API — 레벨테스트 평가 + 완료 처리(첫 친구의 첫 메시지 발송)

import { NextResponse } from "next/server";
import { transcribe } from "@/core/stt";
import { loadPrompt } from "@/core/prompts";
import { chatLLM } from "@/core/llm";
import { parseJsonLoose } from "@/core/pipeline/parse";
import { getUser, saveUser, addIntimacy } from "@/core/gamification";
import { getPersona } from "@/core/content";
import { appendTutorMessage } from "@/core/chat";
import { resetLearnerLevelProfile } from "@/core/levelAdaptation";
import { onboardingGreeting } from "@/core/onboardingGreeting";
import { parseProfile, sanitizeName } from "@/core/profile";
import { activeFriends, ensureRoster, rankCandidates } from "@/core/friends";
import { ensureSchedule } from "@/core/life";
import { normalizedScore } from "@/core/matching";
import { newMessage } from "@/core/chatStore";
import { schedule } from "@/core/deliveryQueue";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_JSON_BYTES = 16 * 1024;
const MAX_NAME_LENGTH = 24;
const MAX_NOTE_LENGTH = 1_000;
/** 첫 매칭 인원 — core/friends의 INITIAL_FRIENDS와 같은 값을 유지한다. */
const INITIAL_FRIEND_COUNT = 2;

function privateJson(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  return NextResponse.json(data, { ...init, headers });
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    const contentLength = Number(req.headers.get("content-length") ?? 0);
    const maxRequestBytes = contentType.includes("multipart/form-data")
      ? MAX_AUDIO_BYTES + 1024 * 1024
      : MAX_JSON_BYTES;
    if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
      return privateJson({ error: "request too large" }, { status: 413 });
    }

    // 1분 발화 레벨테스트
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const audio = form.get("audio");
      if (!(audio instanceof Blob)) return privateJson({ error: "audio required" }, { status: 400 });
      if (audio.size === 0 || audio.size > MAX_AUDIO_BYTES) {
        return privateJson({ error: "invalid audio size" }, { status: audio.size > MAX_AUDIO_BYTES ? 413 : 400 });
      }
      if (audio.type && !audio.type.toLowerCase().startsWith("audio/")) {
        return privateJson({ error: "invalid audio type" }, { status: 415 });
      }
      const buf = Buffer.from(await audio.arrayBuffer());
      const stt = await transcribe(buf, audio.type || "audio/webm", {
        feature: "leveltest",
        durationSec: Math.min(90, Math.max(0, Number(form.get("durationSec") ?? 60) || 0)),
        signal: req.signal,
      });
      const system = loadPrompt("level-test", { transcript: stt.text || "(발화 없음)" });
      const res = await chatLLM({
        system,
        messages: [{ role: "user", content: "레벨을 평가해 주세요." }],
        maxTokens: 300,
        feature: "leveltest",
        signal: req.signal,
      });
      const parsed = parseJsonLoose<{ level?: number; note?: string }>(res.text);
      const level = Math.max(1, Math.min(5, parsed?.level ?? 2));
      const note = typeof parsed?.note === "string" ? parsed.note.slice(0, MAX_NOTE_LENGTH) : "";
      return privateJson({ transcript: stt.text, level, note });
    }

    // 온보딩 완료
    if (!contentType.includes("application/json")) {
      return privateJson({ error: "application/json required" }, { status: 415 });
    }
    const body = await req.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return privateJson({ error: "invalid request" }, { status: 400 });
    }
    // 프로필만 보내면 어떤 친구가 배정될지 미리 보여준다 (저장하지 않는다).
    if (body.action === "preview") {
      const profile = parseProfile(body.profile);
      if (!profile) return privateJson({ error: "invalid profile" }, { status: 400 });
      const picks = rankCandidates(undefined, profile).slice(0, INITIAL_FRIEND_COUNT);
      return privateJson({
        matches: picks.map((pick) => {
          const persona = getPersona(pick.tutorId);
          return {
            id: persona.id,
            koName: persona.koName,
            name: persona.name,
            emoji: persona.emoji,
            color: persona.color,
            bio: persona.bio,
            job: persona.job,
            nationality: persona.nationality,
            profileImage: persona.profileImage,
            score: normalizedScore(pick.score),
            reasons: pick.reasons,
          };
        }),
      });
    }

    if (body.action === "complete") {
      const { level, note } = body as { level: number; note?: string };
      const cleanName = sanitizeName(body.name, MAX_NAME_LENGTH);
      if (!cleanName) {
        return privateJson({ error: `name must be 1-${MAX_NAME_LENGTH} characters` }, { status: 400 });
      }
      if (typeof level !== "number" || !Number.isInteger(level) || level < 1 || level > 5) {
        return privateJson({ error: "level must be between 1 and 5" }, { status: 400 });
      }
      const profile = parseProfile(body.profile);
      if (!profile) return privateJson({ error: "invalid profile" }, { status: 400 });
      if (typeof note !== "undefined" && typeof note !== "string") {
        return privateJson({ error: "invalid note" }, { status: 400 });
      }

      const user = getUser();
      // 모바일 중복 탭이나 네트워크 재시도에도 첫 메시지/친밀도를 한 번만 반영한다.
      if (user.onboarded) return privateJson({ ok: true, alreadyCompleted: true });
      user.onboarded = true;
      user.name = cleanName;
      user.level = level;
      user.profile = profile;
      if (note) user.levelTestNote = note.trim().slice(0, MAX_NOTE_LENGTH);
      saveUser(user);
      resetLearnerLevelProfile(user.level);

      // 첫 매칭은 프로필 기반 2명. 한 번에 많은 친구를 주지 않는다.
      const roster = ensureRoster(profile);
      const assigned = activeFriends(roster).map((friend) => friend.tutorId);
      if (assigned.length > 0) {
        user.firstTutorId = assigned[0];
        saveUser(user);
      }

      for (const [index, id] of assigned.entries()) {
        const persona = getPersona(id);
        const greeting = onboardingGreeting(persona, cleanName, level);
        if (index === 0) {
          appendTutorMessage(id, greeting.en, greeting.ko);
        } else {
          // 두 사람이 동시에 말을 걸면 봇처럼 보인다 — 두 번째부터는 잠시 뒤 도착시킨다.
          const dueAt = Date.now() + index * 75_000;
          schedule({
            tutorId: id,
            message: newMessage({ role: "tutor", text: greeting.en, ko: greeting.ko, read: false }),
            dueAt,
            typingFrom: dueAt - 6_000,
            reason: "intro",
            push: { title: persona.koName, body: greeting.en.slice(0, 120), url: `/chat/${id}` },
          });
        }
        addIntimacy(id, 1);
        // 첫 대화부터 근황을 말할 수 있도록 라이프 스케줄을 미리 만들어 둔다.
        void ensureSchedule(id).catch(() => {});
      }

      return privateJson({ ok: true, friends: assigned });
    }

    return privateJson({ error: "unknown action" }, { status: 400 });
  } catch (error) {
    if (error instanceof SyntaxError) return privateJson({ error: "invalid JSON" }, { status: 400 });
    console.error("[api/onboarding]", error);
    return privateJson({ error: "onboarding request failed" }, { status: 500 });
  }
}
