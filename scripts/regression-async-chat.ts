/**
 * 비동기 친구 구조 회귀 — 지연 큐, 생활 리듬, 궁합 엔진, 코칭 카드, 라이프 스케줄을
 * 각각 단독으로 검증한다. 각 모듈은 서버 라우트 없이 import만으로 테스트된다.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LearnerProfile } from "../src/core/types";

const tempRoot = fs.realpathSync(os.tmpdir());
const storeDir = fs.mkdtempSync(path.join(tempRoot, "avatar-tutor-async-"));
process.env.STORE_DIR = storeDir;
process.env.SESSION_LOG_DIR = path.join(storeDir, "logs");
process.env.FRIEND_INTRO_DELAY_MS = "0";

async function main() {
  try {
    // ── 1. 생활 리듬: 지연 구간과 수면 처리 ──
    const { classifyBand, isAwake, localHour, nextAwakeAt, planDelivery, typingDurationMs } =
      await import("../src/core/rhythm");

    const seoulNoon = Date.parse("2026-08-31T03:00:00Z"); // 서울 정오 = 런던 04:00
    assert.equal(Math.round(localHour("Asia/Seoul", seoulNoon)), 12);
    assert.equal(Math.round(localHour("Europe/London", seoulNoon)), 4);

    const londonRhythm = { timezone: "Europe/London", wakeHour: 7, sleepHour: 23, replySpeed: 1 };
    assert.equal(isAwake(londonRhythm, seoulNoon), false, "04:00 London must count as asleep");
    const wake = nextAwakeAt(londonRhythm, seoulNoon);
    assert.ok(wake > seoulNoon, "next wake must be in the future");
    assert.equal(Math.round(localHour("Europe/London", wake)), 7);

    // 자정을 넘겨 자는 리듬(10시 기상 · 새벽 3시 취침)도 랩어라운드가 맞아야 한다.
    const nightOwl = { timezone: "Europe/London", wakeHour: 10, sleepHour: 3, replySpeed: 1 };
    assert.equal(isAwake(nightOwl, Date.parse("2026-08-31T00:00:00Z")), true, "01:00 London is still before bedtime");
    assert.equal(isAwake(nightOwl, seoulNoon), false, "04:00 London is after a 03:00 bedtime");
    assert.equal(isAwake(nightOwl, Date.parse("2026-08-31T10:00:00Z")), true, "11:00 London is after waking up");

    assert.equal(classifyBand("lol 😂"), "short");
    assert.equal(classifyBand("That sounds fun. What did you eat there?"), "normal");
    assert.equal(
      classifyBand(
        "Okay so basically what happened was that the whole team went to the market in the morning and " +
          "then we cooked everything together and it turned into a very long but very good day for all of us.",
      ),
      "long",
    );

    // 지연은 구간 안에 들어가야 하고, 입력 중 표시는 항상 후반부다.
    const fixedRandom = () => 0.5;
    const awakeRhythm = { timezone: "Asia/Seoul", wakeHour: 7, sleepHour: 23, replySpeed: 1 };
    for (const [text, min, max] of [
      ["haha", 3_000, 8_000],
      ["That sounds fun. What did you eat there?", 10_000, 25_000],
      [
        "Okay so basically what happened was that the whole team went to the market in the morning and then we " +
          "cooked everything together and it turned into a very long but very good day for all of us.",
        25_000,
        45_000,
      ],
    ] as const) {
      const plan = planDelivery({ rhythm: awakeRhythm, text, now: seoulNoon, random: fixedRandom });
      const delay = plan.dueAt - seoulNoon;
      assert.ok(delay >= min && delay <= max, `delay ${delay} outside [${min}, ${max}] for "${text.slice(0, 24)}"`);
      assert.ok(plan.typingFrom > seoulNoon, "typing must start after the message was composed");
      assert.ok(plan.typingFrom < plan.dueAt, "typing must start before the message arrives");
      assert.ok(
        plan.dueAt - plan.typingFrom <= delay * 0.6 + 1,
        "typing indicator must only cover the latter part of the wait",
      );
      assert.equal(plan.sleptThrough, false);
    }

    assert.ok(typingDurationMs("one two three", 20_000) < typingDurationMs("one two three four five six seven eight", 20_000));

    // 자는 친구에게 보내면 다음 활동 시간대로 미뤄진다.
    const slept = planDelivery({ rhythm: londonRhythm, text: "Are you free later?", now: seoulNoon, random: fixedRandom });
    assert.equal(slept.sleptThrough, true);
    assert.ok(slept.dueAt >= wake, "a sleeping friend must answer after waking up");
    assert.ok(slept.dueAt - wake <= 35 * 60_000);

    // "지금 대화 중"은 지연을 완전히 건너뛴다.
    const live = planDelivery({ rhythm: londonRhythm, text: "Hi", now: seoulNoon, live: true });
    assert.equal(live.dueAt, seoulNoon);
    assert.equal(live.band, "instant");

    // 여행 중에는 응답이 더 느려진다.
    const home = planDelivery({ rhythm: awakeRhythm, text: "Sure, sounds good", now: seoulNoon, random: fixedRandom });
    const abroad = planDelivery({
      rhythm: awakeRhythm,
      text: "Sure, sounds good",
      now: seoulNoon,
      travelling: true,
      random: fixedRandom,
    });
    assert.ok(abroad.dueAt > home.dueAt, "travelling must slow replies down");

    // ── 2. 지연 큐: 예약 → 도착 ──
    const { schedule, flushDue, flushTutor, typingStatus, pendingFor, cancelTutor, clearQueue } =
      await import("../src/core/deliveryQueue");
    const { getChat, newMessage } = await import("../src/core/chatStore");

    clearQueue();
    const now = Date.now();
    schedule({
      tutorId: "mia",
      message: newMessage({ role: "tutor", text: "Just landed!", read: false }),
      dueAt: now + 60_000,
      typingFrom: now + 55_000,
      reason: "reply",
      push: null,
    });
    assert.equal(pendingFor("mia").length, 1);
    assert.equal(getChat("mia").messages.length, 0, "a scheduled reply must not appear before it is due");
    assert.equal(typingStatus("mia", now).typing, false, "typing must stay off during the early wait");
    assert.equal(typingStatus("mia", now + 56_000).typing, true, "typing must turn on near the end of the wait");

    assert.equal((await flushDue(now + 30_000)).length, 0, "nothing may arrive before it is due");
    const delivered = await flushDue(now + 61_000);
    assert.equal(delivered.length, 1);
    assert.equal(getChat("mia").messages.length, 1);
    assert.equal(getChat("mia").messages[0].text, "Just landed!");
    assert.equal(getChat("mia").messages[0].read, false, "arrived messages must count as unread");

    // 토글을 켜면 밀린 답장이 즉시 도착한다.
    schedule({
      tutorId: "mia",
      message: newMessage({ role: "tutor", text: "And one more thing", read: false }),
      dueAt: now + 3_600_000,
      typingFrom: now + 3_595_000,
      reason: "reply",
      push: null,
    });
    const flushed = await flushTutor("mia");
    assert.equal(flushed.length, 1);
    assert.equal(getChat("mia").messages.length, 2);
    assert.equal(pendingFor("mia").length, 0);

    // 떠난 친구의 예약은 남지 않는다.
    schedule({
      tutorId: "jack",
      message: newMessage({ role: "tutor", text: "hey", read: false }),
      dueAt: now + 60_000,
      typingFrom: now + 55_000,
      reason: "proactive",
      push: null,
    });
    assert.equal(cancelTutor("jack"), 1);
    assert.equal(pendingFor("jack").length, 0);
    clearQueue();

    // ── 3. 궁합 엔진 ──
    const { getPersonas, getPersona } = await import("../src/core/content");
    const { rankTutors, updateModelOnLeave, updateModelOnEngagement, EMPTY_MODEL, engagementScore } =
      await import("../src/core/matching");
    const personas = getPersonas();
    assert.equal(personas.length, 8, "the roster must offer eight personas");

    const calmProfile: LearnerProfile = {
      ageBand: "30s",
      occupation: "office",
      interests: ["coffee", "books", "outdoors"],
      goal: "work",
      style: "calm",
    };
    const calmRanked = rankTutors({ personas, profile: calmProfile, includeEngagement: false });
    assert.equal(
      getPersona(calmRanked[0].tutorId).tags.temperament,
      "calm",
      "a learner who wants calm conversation must be matched with a calm friend",
    );

    // 관심사·목적이 같다면 성향 선택이 순위를 뒤집는다.
    const neutral: Omit<LearnerProfile, "style"> = { ageBand: "20s", occupation: "other", interests: [], goal: "hobby" };
    const calmPick = rankTutors({ personas, profile: { ...neutral, style: "calm" }, includeEngagement: false })[0];
    const livelyPick = rankTutors({ personas, profile: { ...neutral, style: "lively" }, includeEngagement: false })[0];
    assert.equal(getPersona(calmPick.tutorId).tags.temperament, "calm");
    assert.equal(getPersona(livelyPick.tutorId).tags.temperament, "lively");
    assert.notEqual(calmPick.tutorId, livelyPick.tutorId, "style must change who is recommended");

    // 관심사가 강하게 겹치면 성향보다 그쪽이 우선하되, 점수는 분명히 움직여야 한다.
    const { scoreTutor } = await import("../src/core/matching");
    const calmFriend = getPersona(calmRanked[0].tutorId);
    const calmScore = scoreTutor(calmFriend, calmProfile, EMPTY_MODEL, { includeEngagement: false }).score;
    const livelyScore = scoreTutor(
      calmFriend,
      { ...calmProfile, style: "lively" },
      EMPTY_MODEL,
      { includeEngagement: false },
    ).score;
    assert.ok(calmScore > livelyScore, "a calm friend must score higher for a learner who asked for calm");

    // 활발한 친구에서 이탈 → 차분한 성향 가중 (기획서의 예시 그대로)
    const livelyFriend = personas.find((persona) => persona.tags.temperament === "lively")!;
    const afterLeave = updateModelOnLeave({ ...EMPTY_MODEL, weights: {} }, livelyFriend, "mismatch");
    assert.ok(afterLeave.weights["temperament:lively"] < 0, "leaving must penalise that temperament");
    assert.ok(afterLeave.weights["temperament:calm"] > 0, "leaving a lively friend must favour calm friends");

    // "너무 어려워요"는 느린 템포를 밀어 준다.
    const afterHard = updateModelOnLeave({ ...EMPTY_MODEL, weights: {} }, livelyFriend, "too-hard");
    assert.ok(afterHard.weights["tempo:slow"] > 0);
    assert.ok(afterHard.weights["tempo:fast"] < 0);

    // "응답이 느려요"는 빠른 템포를 밀어 준다.
    const slowFriend = personas.find((persona) => persona.tags.tempo === "slow")!;
    const afterSlow = updateModelOnLeave({ ...EMPTY_MODEL, weights: {} }, slowFriend, "slow");
    assert.ok(afterSlow.weights["tempo:fast"] > 0);
    assert.ok(afterSlow.weights["tempo:slow"] < 0);

    // 행동 신호: 단답 반복과 무응답은 음수, 지속 대화와 통화는 양수
    const engaged = {
      tutorMessages: 10,
      learnerMessages: 11,
      shortReplies: 0,
      calls: 2,
      callSeconds: 600,
      lastLearnerMessageAt: Date.now(),
      currentStreakTurns: 8,
      longestStreakTurns: 8,
    };
    const disengaged = {
      tutorMessages: 10,
      learnerMessages: 2,
      shortReplies: 7,
      calls: 0,
      callSeconds: 0,
      lastLearnerMessageAt: Date.now() - 6 * 86_400_000,
      currentStreakTurns: 0,
      longestStreakTurns: 1,
    };
    assert.ok(engagementScore(engaged) > 0, "long conversations and calls are positive signals");
    assert.ok(engagementScore(disengaged) < 0, "short replies and silence are negative signals");
    const strengthened = updateModelOnEngagement({ ...EMPTY_MODEL, weights: {} }, livelyFriend, engaged);
    assert.ok(strengthened.weights[`temperament:${livelyFriend.tags.temperament}`] > 0);

    // ── 4. 친구 로스터: 첫 매칭 2명 → 이탈 → 새 친구 예약 ──
    const { getUser, saveUser } = await import("../src/core/gamification");
    const user = getUser();
    user.onboarded = true;
    user.name = "테스터";
    user.profile = { ...calmProfile, interests: [...calmProfile.interests] };
    saveUser(user);

    const friends = await import("../src/core/friends");
    const roster = friends.ensureRoster();
    assert.equal(friends.activeFriends(roster).length, 2, "the first matching must assign exactly two friends");

    const [firstFriend] = friends.activeFriends(roster);
    const leaveResult = friends.leaveFriend(firstFriend.tutorId, "mismatch");
    assert.equal(leaveResult.left?.status, "left");
    assert.ok(leaveResult.pendingIntro, "leaving must schedule a replacement friend");
    assert.equal(leaveResult.pendingIntro?.introducedBy, firstFriend.tutorId, "the new friend must arrive as an introduction");
    assert.equal(friends.activeFriends().length, 1);
    assert.equal(friends.leftFriends().length, 1, "the archived conversation must be kept, not deleted");
    assert.ok(friends.dueIntro(), "FRIEND_INTRO_DELAY_MS=0 must make the intro due immediately");

    // 나갔던 친구와 언제든 다시 대화할 수 있어야 한다.
    friends.restoreFriend(firstFriend.tutorId);
    assert.equal(friends.getRelation(firstFriend.tutorId)?.status, "active");

    // 학습 데이터는 계정에 귀속된다 — 친구가 바뀌어도 그대로다.
    const afterChurn = getUser();
    assert.equal(afterChurn.level, user.level);
    assert.deepEqual(afterChurn.profile, user.profile);

    // ── 5. 코칭 카드 ──
    const coaching = await import("../src/core/coaching");
    assert.equal(coaching.needsCoaching("오늘 회사에서 야근했어"), true);
    assert.equal(coaching.needsCoaching("I worked late today"), false, "English input needs a correction, not a coaching card");
    assert.equal(coaching.needsCoaching("ㅋㅋ"), false, "reaction-only Korean must not trigger a card");

    const card = coaching.sanitizeCoachingCard(
      {
        primary: { en: "I had to work late today.", ko: "오늘 야근해야 했어." },
        variants: [
          { style: "casual", en: "Ugh, I got stuck at work again.", ko: "아 또 회사에 붙잡혔어." },
          { style: "polite", en: "I had to stay late at the office today.", ko: "오늘 사무실에 늦게까지 있어야 했어요." },
          { style: "casual", en: "duplicate", ko: "중복" },
        ],
        tip: "'야근'은 영어로 한 단어가 아니라 work late로 풉니다.",
      },
      "오늘 회사에서 야근했어",
    );
    assert.ok(card);
    assert.equal(card!.variants.length, 2, "exactly one casual and one polite variant must survive");
    assert.deepEqual(card!.variants.map((variant) => variant.style).sort(), ["casual", "polite"]);
    assert.equal(coaching.sanitizeCoachingCard({ primary: { ko: "번역만" } }, "..."), null);

    assert.equal(coaching.practiceHint(card!), "I had to work late today.");
    assert.equal(coaching.practiceHint(card!, "polite"), "I had to stay late at the office today.");
    assert.equal(coaching.matchesPracticeTarget("I had to work late today.", "i had to work late today"), true);
    assert.equal(coaching.matchesPracticeTarget("I had to work late today.", "I had to work late!"), true);
    assert.equal(coaching.matchesPracticeTarget("I had to work late today.", "I like pizza"), false);

    // ── 6. 라이프 스케줄: 여행의 연속성 ──
    const life = await import("../src/core/life");
    const { todayStr, addDays } = await import("../src/core/store");
    const persona = getPersona("jack");
    const events = life.buildFallbackSchedule(persona, todayStr(), 21);
    assert.ok(events.length > 0);
    const travel = events.find((event) => event.kind === "travel");
    assert.ok(travel, "a three week schedule must include one trip");
    assert.ok(travel!.endDate > travel!.startDate, "a trip must span several consecutive days");
    assert.notEqual(travel!.timezone, persona.rhythm.timezone, "travelling must shift the time zone");
    const recovery = events.find((event) => event.startDate === addDays(travel!.endDate, 1));
    assert.ok(recovery, "coming home must continue the story instead of ending it");

    // 여행 기간에는 집 근처 일정이 겹치지 않는다.
    const midTrip = addDays(travel!.startDate, 1);
    const overlapping = events.filter((event) => event.startDate <= midTrip && event.endDate >= midTrip);
    assert.equal(overlapping.length, 1, "no home-town plans may overlap a trip");
    assert.equal(overlapping[0].kind, "travel");

    const lifeSchedule = { tutorId: "jack", generatedAt: Date.now(), coversUntil: addDays(todayStr(), 21), events, usedPhotos: [], lastPostedDate: "", postsToday: 0 };
    assert.equal(life.currentEvent(lifeSchedule, midTrip)?.kind, "travel", "a trip always wins over routine events");
    assert.equal(life.canPostToday(lifeSchedule, todayStr()), true);
    assert.equal(life.canPostToday({ ...lifeSchedule, lastPostedDate: todayStr(), postsToday: 1 }, todayStr()), false);

    // ── 7. 사진 폴백 ──
    const { fetchPhoto, photosConfigured } = await import("../src/core/photos");
    assert.equal(photosConfigured(), false, "no photo key must be reported honestly");
    const photo = await fetchPhoto("bali rice terrace beach");
    assert.equal(photo.source, "local", "without a key the local sample must be labelled as such");
    assert.ok(fs.existsSync(path.join(process.cwd(), "public", photo.url.replace(/^\//, ""))), "the local sample must exist");
    const foodPhoto = await fetchPhoto("ramen bowl closeup");
    assert.notEqual(foodPhoto.url, photo.url, "different keywords must resolve to different scenes");

    // ── 8. 상황극 복구 ──
    const roleplay = await import("../src/core/roleplay");
    const scenarios = roleplay.availableScenarios();
    assert.equal(scenarios.length, 8, "all eight scenarios must be available");
    assert.ok(scenarios.every((scenario) => scenario.locked === false), "no scenario may stay locked");
    const briefing = roleplay.buildBriefing("cafe");
    assert.ok(briefing);
    assert.equal(briefing!.expressions.length, 3, "the briefing must offer three usable expressions");

    const cafe = scenarios.find((scenario) => scenario.id === "cafe")!;
    const turns = [
      { id: "1", role: "user" as const, text: "Can I get a medium iced americano please", ts: 1 },
      { id: "2", role: "tutor" as const, text: "Sure, what can I get you?", ts: 2 },
      { id: "3", role: "user" as const, text: "My cat is sleeping on the sofa again", ts: 3 },
    ];
    assert.equal(roleplay.offTopicStreak(turns, cafe), 1, "only the trailing off-topic turns count");
    const drifted = [...turns, { id: "4", role: "user" as const, text: "Do you know a good movie about robots", ts: 4 }];
    assert.equal(roleplay.offTopicStreak(drifted, cafe), 2);
    assert.ok(roleplay.recoveryHint(2, cafe).length > 0, "two off-topic turns must trigger a Korean hint");
    assert.equal(roleplay.recoveryHint(1, cafe), "", "one stray turn must not break character");

    // ── 9. 음성 메시지 ──
    const voice = await import("../src/core/voiceNote");
    const note = voice.buildVoiceNote("Hey, I just got back from the market and I found something amazing.");
    assert.ok(note.durationSec > 2 && note.durationSec < 20);
    assert.equal(note.peaks.length, 36);
    assert.deepEqual(
      note.peaks,
      voice.buildVoiceNote("Hey, I just got back from the market and I found something amazing.").peaks,
      "the same message must always render the same waveform",
    );
    assert.equal(voice.suitsVoice("ok"), false);
    assert.equal(voice.suitsVoice("Hey, how was your weekend? I went hiking."), true);

    console.log("async friend regression: rhythm, delivery queue, matching, churn, coaching, life, photos, roleplay, voice passed");
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
