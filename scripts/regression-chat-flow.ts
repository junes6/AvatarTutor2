/**
 * 카톡형 채팅 흐름 회귀 — 한국어 입력 → 코칭 카드 → 예약 발송 → 도착 →
 * "지금 대화 중" 즉시 응답 → 따라 쓰기 보상까지를 실제 파이프라인으로 검증한다.
 * (목 LLM으로 동작하므로 API 키 없이 실행된다.)
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LearnerProfile } from "../src/core/types";

const tempRoot = fs.realpathSync(os.tmpdir());
const storeDir = fs.mkdtempSync(path.join(tempRoot, "avatar-tutor-flow-"));
process.env.STORE_DIR = storeDir;
process.env.SESSION_LOG_DIR = path.join(storeDir, "logs");
process.env.FRIEND_INTRO_DELAY_MS = "0";

const PROFILE: LearnerProfile = {
  ageBand: "20s",
  occupation: "office",
  interests: ["travel", "food", "music"],
  goal: "hobby",
  style: "lively",
};

async function main() {
  try {
    const { getUser, saveUser } = await import("../src/core/gamification");
    const { ensureRoster, activeFriends, getRelation, leaveFriend } = await import("../src/core/friends");
    const { chatTurn } = await import("../src/core/chat");
    const { getChat, isLive, setLive, markRead, unreadCount, toggleReaction } = await import("../src/core/chatStore");
    const { flushDue, pendingFor, clearQueue } = await import("../src/core/deliveryQueue");

    const user = getUser();
    user.onboarded = true;
    user.name = "테스터";
    user.level = 2;
    user.profile = PROFILE;
    saveUser(user);

    clearQueue();
    const roster = ensureRoster(PROFILE);
    const [friend] = activeFriends(roster);
    assert.ok(friend, "the first matching must assign a friend");
    const tutorId = friend.tutorId;

    // ── 1. 한국어로 쓰면 코칭 카드가 붙고, 답장은 예약된다 ──
    const korean = await chatTurn({ tutorId, text: "아이스 아메리카노 주세요" });
    assert.ok(korean.coaching, "Korean input must produce a coaching card");
    assert.ok(korean.coaching!.primary.en.length > 0);
    assert.ok(
      korean.coaching!.variants.some((variant) => variant.style === "polite"),
      "the card must offer a polite variant",
    );
    assert.ok(korean.scheduledFor !== null, "replies must be scheduled, not returned instantly");
    assert.ok(korean.typingFrom !== null && korean.typingFrom < korean.scheduledFor!);

    const afterSend = getChat(tutorId).messages;
    assert.equal(afterSend.length, 1, "only the learner message is committed while the reply is pending");
    assert.equal(afterSend[0].role, "user");
    assert.ok(afterSend[0].coaching, "the coaching card is attached to the learner bubble");
    assert.equal(pendingFor(tutorId).length, 1);

    // ── 2. 예약이 만료되면 도착한다 ──
    const delivered = await flushDue(korean.scheduledFor! + 1);
    assert.equal(delivered.length, 1);
    const arrived = getChat(tutorId).messages;
    assert.equal(arrived.length, 2);
    assert.equal(arrived[1].role, "tutor");
    assert.equal(arrived[1].read, false, "an arrived reply must show as unread");
    assert.equal(unreadCount(tutorId), 1);
    markRead(tutorId);
    assert.equal(unreadCount(tutorId), 0);

    // ── 3. 코칭 문장을 영어로 다시 쓰면 칭찬과 XP ──
    const xpBefore = getUser().xp;
    const practice = await chatTurn({ tutorId, text: korean.coaching!.primary.en });
    assert.equal(practice.practiceHit, true, "writing the coached sentence must be recognised");
    assert.ok(getUser().xp > xpBefore, "practising must award XP");
    assert.equal(practice.coaching, null, "an English attempt gets a correction path, not another card");

    // ── 4. "지금 대화 중"을 켜면 즉시 응답 ──
    setLive(tutorId, true);
    assert.equal(isLive(tutorId), true);
    const lengthBefore = getChat(tutorId).messages.length;
    const instant = await chatTurn({ tutorId, text: "What are you doing right now?" });
    assert.equal(instant.scheduledFor, null, "live mode must skip the delay queue");
    assert.equal(getChat(tutorId).messages.length, lengthBefore + 2, "both messages land immediately");
    assert.equal(getChat(tutorId).messages.at(-1)?.role, "tutor");

    setLive(tutorId, false);
    assert.equal(isLive(tutorId), false);

    // ── 5. 답장 인용과 이모지 반응 ──
    const target = getChat(tutorId).messages.at(-1)!;
    const quoted = await chatTurn({ tutorId, text: "That sounds nice!", replyToId: target.id });
    assert.equal(quoted.userMsg.replyTo?.id, target.id, "quoting must reference the original message");
    const reacted = toggleReaction(tutorId, target.id, "❤️");
    assert.equal(reacted?.reactions?.length, 1);
    assert.equal(toggleReaction(tutorId, target.id, "❤️")?.reactions, undefined, "tapping the same emoji removes it");

    // ── 6. 나가도 기록은 보관되고 궁합만 갱신된다 ──
    const beforeLeave = getChat(tutorId).messages.length;
    const result = leaveFriend(tutorId, "slow");
    assert.equal(result.left?.status, "left");
    assert.equal(result.left?.leaveReason, "slow");
    assert.equal(getChat(tutorId).messages.length, beforeLeave, "leaving must not delete the conversation");
    assert.equal(pendingFor(tutorId).length, 0, "a friend who left must not keep sending scheduled messages");
    assert.ok((getRelation(tutorId)?.stats.learnerMessages ?? 0) > 0, "relationship stats must survive leaving");

    console.log("chat flow regression: coaching card, delayed delivery, practice reward, live mode, quote/react, churn passed");
  } finally {
    delete process.env.STORE_DIR;
    delete process.env.SESSION_LOG_DIR;
    delete process.env.FRIEND_INTRO_DELAY_MS;
    if (storeDir.startsWith(`${tempRoot}${path.sep}`)) fs.rmSync(storeDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
