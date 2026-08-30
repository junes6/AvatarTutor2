import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SessionRecord } from "../src/core/types";
import { getReportDurationLabel, getReportExpressions, isReportSessionComplete } from "../src/lib/reportPresentation";
import { RequestTimeoutError, withRequestTimeout } from "../src/lib/requestTimeout";

function assertHomePageSource() {
  const homeSource = readFileSync(resolve(process.cwd(), "src/app/page.tsx"), "utf8");
  const roomSource = readFileSync(resolve(process.cwd(), "src/app/chat/[tutorId]/page.tsx"), "utf8");

  for (const forbiddenPattern of ["snap-x", "overflow-x-auto", "snap-start", "practice-rail"]) {
    assert.equal(
      homeSource.includes(forbiddenPattern),
      false,
      `home must not reintroduce the horizontal rail pattern: ${forbiddenPattern}`,
    );
  }

  // 홈은 카톡형 채팅 목록이다: 프로필 · 미리보기 · 시간 · 안 읽은 수.
  assert.match(homeSource, /className="chat-row"/, "home must render the KakaoTalk-style chat list rows");
  assert.match(homeSource, /className="chat-row-preview"/, "chat rows must show a last-message preview");
  assert.match(homeSource, /className="chat-row-badge"/, "chat rows must show an unread badge");
  assert.match(homeSource, /listTime\(friend\.lastMessage\.ts\)/, "chat rows must show the last-message time");
  assert.match(
    homeSource,
    /router\.push\(`\/chat\/\$\{friend\.id\}`\)/,
    "chat rows must open the conversation",
  );
  assert.match(homeSource, /<TabBar\b/, "home must keep the two-screen tab bar");

  // 통화는 채팅방 상단바의 부가 기능으로 재배치되었다.
  assert.match(roomSource, /className="icon-button is-call"/, "the chat room top bar must expose the call button");
  assert.match(
    roomSource,
    /aria-label=\{`\$\{tutor\.koName\}와 통화`\}/,
    "the call button must be labelled",
  );
  assert.match(roomSource, /className=\{`live-toggle/, "the chat room must expose the instant-reply toggle");
  assert.match(roomSource, /<CoachingCardView\b/, "the chat room must attach Korean-input coaching cards");
  assert.match(roomSource, /className="day-divider"/, "the chat room must keep date dividers");
  assert.match(roomSource, /className="msg-quote"/, "the chat room must render quoted replies");
  assert.match(roomSource, /reaction-picker/, "the chat room must support long-press emoji reactions");
}

function assertCallCoachSource() {
  const callSource = readFileSync(resolve(process.cwd(), "src/app/call/[tutorId]/page.tsx"), "utf8");
  const cardsSource = readFileSync(resolve(process.cwd(), "src/components/Cards.tsx"), "utf8");
  const globalCss = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

  assert.match(
    callSource,
    /const activeCoach = correctionCard[\s\S]*?: suggestionCard[\s\S]*?: expressionCard/,
    "call coaching must keep correction > suggestion > expression priority",
  );
  assert.equal(
    callSource.includes("(expressionCard || suggestionCard || correctionCard)"),
    false,
    "call coaching must not render independent cards together",
  );
  assert.match(callSource, /aria-live="polite"[\s\S]*aria-atomic="true"/, "new coaching must be announced");

  const toolRow = callSource.match(/<div className="call-tool-row"[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.equal((toolRow.match(/<ToolButton\b/g) ?? []).length, 5, "call dock must keep one compact five-tool row");
  assert.match(toolRow, /label="한국어"/, "language help must be a compact single utility toggle");
  assert.match(toolRow, /ariaLabel=\{inputLanguage === "ko-KR"/, "language toggle must keep a descriptive accessible label");
  assert.equal(callSource.includes("call-language-switch"), false, "the separate language row must stay removed");
  assert.equal(
    (cardsSource.match(/className="call-coach-actions"/g) ?? []).length,
    3,
    "every coaching card must expose its action footer",
  );

  const coachPanelRules = [...globalCss.matchAll(/[^{}]*\.call-coach-panel[^{}]*\{([^}]*)\}/g)];
  assert.ok(coachPanelRules.length > 0, "coaching panel styles must exist");
  for (const [, declarations] of coachPanelRules) {
    assert.equal(/max-height\s*:/.test(declarations), false, "coaching panel must not clip content with max-height");
    assert.equal(/overflow(?:-y)?\s*:\s*(auto|scroll)/.test(declarations), false, "coaching panel must not become a nested scroll area");
  }
  assert.match(
    globalCss,
    /\.coach-listen-button\s*\{[\s\S]*?min-height:\s*44px/,
    "listen actions must remain at least 44px tall",
  );
  for (const [selector, minimum] of [
    ["icon-button", 44],
    ["composer-send", 44],
    ["composer-icon", 44],
    ["coach-listen", 44],
    ["tab-item", 44],
    ["reason-item", 44],
    ["call-tool-button", 44],
    ["call-round-action", 44],
    ["ptt-button", 54],
    ["call-close-button", 44],
    ["call-context-pill", 44],
  ] as const) {
    const rules = [...globalCss.matchAll(new RegExp(`\\.${selector}[^{}]*\\{([^}]*)\\}`, "g"))];
    assert.ok(rules.length > 0, `${selector} styles must exist`);
    assert.ok(
      rules.some(([, declarations]) => {
        const values = [...declarations.matchAll(/(?:min-)?height\s*:\s*(\d+)px/g)].map((match) => Number(match[1]));
        return values.some((value) => value >= minimum);
      }),
      `${selector} must expose a ${minimum}px or larger touch target`,
    );
  }
  assert.match(
    globalCss,
    /\.call-live-shell\.has-coach \.avatar-view\s*\{\s*display:\s*none;/,
    "short call screens must hide the avatar while coaching is visible",
  );
  assert.match(globalCss, /grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/, "utility row must use five equal columns");
  assert.equal(globalCss.includes("call-language-switch"), false, "obsolete language-row CSS must stay removed");
  assert.equal(globalCss.includes(":has(.call-coach-panel)"), false, "coach layout must use explicit state instead of :has hacks");
}

async function main() {
  assertHomePageSource();
  assertCallCoachSource();

  const success = await withRequestTimeout(async (signal) => {
    assert.equal(signal.aborted, false);
    return "ok";
  }, 100);
  assert.equal(success, "ok");

  let observedAbort = false;
  const startedAt = Date.now();
  await assert.rejects(
    withRequestTimeout(
      (signal) => new Promise<never>(() => {
        signal.addEventListener("abort", () => { observedAbort = true; }, { once: true });
      }),
      10,
    ),
    RequestTimeoutError,
  );
  assert.equal(observedAbort, true, "timed-out requests must receive an abort signal");
  assert.ok(Date.now() - startedAt < 500, "timeout recovery must stay bounded");

  const interruptedLearning: SessionRecord = {
    id: "sreporttest",
    tutorId: "oliver",
    mode: "learning",
    unitId: "unit-1",
    startedAt: 1_000,
    endedAt: 1_000,
    turns: [],
    corrections: [],
    judgments: [],
    xpEarned: 0,
    pronunciationScores: [],
    stageState: {
      stage: "review",
      reviewItems: [],
      reviewIndex: 0,
      introIndex: 0,
      practicedIds: [],
      roleplayUsedIds: [],
      turnsInStage: 0,
      combo: 0,
    },
  };
  const expressions = [{ id: "one" }, { id: "two" }, { id: "three" }];
  assert.equal(isReportSessionComplete(interruptedLearning), false);
  assert.deepEqual(getReportExpressions(interruptedLearning, expressions), []);
  assert.equal(getReportDurationLabel(interruptedLearning), "0초");

  interruptedLearning.stageState!.introIndex = 1;
  interruptedLearning.stageState!.practicedIds = ["two"];
  assert.deepEqual(getReportExpressions(interruptedLearning, expressions).map((item) => item.id), ["one", "two"]);
  interruptedLearning.stageState!.introIndex = 0;
  interruptedLearning.stageState!.practicedIds = [];
  interruptedLearning.stageState!.reviewItems = [{ expressionId: "old", en: "Old", ko: "이전", result: "pass" }];
  const expressionPool = [{ id: "old" }, ...expressions];
  assert.deepEqual(
    getReportExpressions(interruptedLearning, expressionPool, expressions).map((item) => item.id),
    ["old"],
  );
  interruptedLearning.stageState!.stage = "done";
  assert.equal(isReportSessionComplete(interruptedLearning), true);
  assert.deepEqual(getReportExpressions(interruptedLearning, expressions), expressions);

  console.log("mobile UI recovery regression: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
