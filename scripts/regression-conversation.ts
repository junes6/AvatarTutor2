import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chatMock } from "../src/core/llm/mock";
import { hasExplicitEndIntent } from "../src/core/pipeline/intent";
import { isLikelyRepeatAttempt } from "../src/core/pronunciation";
import { getScenarios, getUnits } from "../src/core/content";
import type { LLMMessage } from "../src/core/llm";
import type { SessionRecord, TutorTurnOutput } from "../src/core/types";
import { getBrowserVoiceProfile, selectBrowserVoice } from "../src/hooks/useAudioPlayer";

interface MockReply {
  reply: string;
  reply_ko: string;
  end_call: boolean;
  correction?: { original: string; better: string } | null;
  suggestion?: { en: string; ko: string } | null;
}

function testEndIntent() {
  const cases: Array<[string, boolean]> = [
    ["그만큼 프로젝트가 어려웠어", false],
    ["숙제를 끝낼 수 없어서 힘들어", false],
    ["I can't stop thinking about the project", false],
    ["I have to go to the store tomorrow", false],
    ["I went to a goodbye party", false],
    ["그만", true],
    ["그만해", true],
    ["그만 좀 해", true],
    ["이제 그만할게", true],
    ["끝", true],
    ["끝내줘", true],
    ["나 이제 가야 해", true],
    ["나 갈게", true],
    ["오늘은 그만하고 싶어", true],
    ["이제 끊어야겠다", true],
    ["통화 끝내자", true],
    ["Bye, I have to go", true],
    ["Bye, I have to go now", true],
    ["I gotta go", true],
    ["Thank you, bye", true],
    ["Thanks, I have to go", true],
    ["See ya", true],
    ["I need to leave", true],
    ["Can we stop now?", true],
    ["I'm done for today", true],
  ];
  for (const [text, expected] of cases) {
    assert.equal(hasExplicitEndIntent(text), expected, `end intent mismatch: ${text}`);
  }
}

function testRepeatIntent() {
  const target = "I'm from Korea.";
  const cases: Array<[string, boolean]> = [
    ["I am from Korea", true],
    ["I'm from Korea", true],
    ["I am from", true],
    ["What does 'I'm from Korea' mean?", false],
    ["Can you explain that again?", false],
    ["What are we doing next?", false],
    ["I have a question about the lesson", false],
  ];
  for (const [text, expected] of cases) {
    assert.equal(isLikelyRepeatAttempt(target, text), expected, `repeat intent mismatch: ${text}`);
  }
}

function testTutorVoiceProfilesStayDistinct() {
  const profiles = ["mia", "oliver", "jack"].map((id) => getBrowserVoiceProfile(id));
  assert.equal(new Set(profiles.map((profile) => profile.lang)).size, 3, "tutors need distinct locales");
  assert.equal(new Set(profiles.map((profile) => profile.pitch)).size, 3, "tutors need distinct pitches");
  assert.equal(new Set(profiles.map((profile) => profile.rate)).size, 3, "tutors need distinct base rates");

  const voices = [
    { name: "Samantha", lang: "en-US", localService: true, default: false },
    { name: "Daniel", lang: "en-GB", localService: true, default: false },
    { name: "Lee", lang: "en-AU", localService: true, default: false },
  ] as SpeechSynthesisVoice[];
  assert.equal(selectBrowserVoice("mia", voices)?.name, "Samantha");
  assert.equal(selectBrowserVoice("oliver", voices)?.name, "Daniel");
  assert.equal(selectBrowserVoice("jack", voices)?.name, "Lee");
}

async function testCafeCompletion() {
  const system = [
    "# 시나리오 롤플레이",
    "- 장소/상황: Cafe (카페) — 카페 주문 상황",
    "- 당신의 역할: 카페 바리스타",
    "- 학습자의 역할: 주문하러 온 손님",
    "- 학습 목표: 음료를 주문하고 결제하기",
  ].join("\n");
  const messages: LLMMessage[] = [
    { role: "assistant", content: "Hi! What can I get started for you?" },
  ];
  const say = async (text: string): Promise<MockReply> => {
    messages.push({ role: "user", content: text });
    const result = await chatMock({ system, messages, feature: "regression" });
    const reply = JSON.parse(result.text) as MockReply;
    messages.push({ role: "assistant", content: reply.reply });
    return reply;
  };

  assert.match((await say("Can I get an iced latte?")).reply, /size/i);
  assert.match((await say("Medium, please")).reply, /for here|to go/i);
  assert.match((await say("To go, please")).reply, /card/i);
  const completed = await say("That's all, thanks.");
  assert.match(completed.reply, /all set|order is complete/i);
  assert.doesNotMatch(completed.reply, /which drink|what can i get/i);
  assert.equal(completed.end_call, false, "role-play completion should not force-close the call");
}

async function testMockPersonaVariety() {
  const tutors = ["Mia Carter", "Oliver Bennett", "Jack Riley"];
  const inputs = ["Hello!", "I had a normal day.", "I like drawing."];
  const allReplies = new Set<string>();

  for (const input of inputs) {
    const repliesForInput = new Set<string>();
    for (const tutor of tutors) {
      const result = await chatMock({
        system: `- 이름: ${tutor}\n# 채팅 모드`,
        messages: [{ role: "user", content: input }],
        feature: "regression-persona",
      });
      const parsed = JSON.parse(result.text) as MockReply;
      const questionCount = (parsed.reply.match(/\?/g) ?? []).length;
      assert.ok(questionCount <= 1, `${tutor} asked too many questions for: ${input}`);
      assert.doesNotMatch(parsed.reply, /What happened just before that/i, `${tutor} used the broken generic fallback`);
      repliesForInput.add(parsed.reply);
      allReplies.add(parsed.reply);
    }
    assert.equal(repliesForInput.size, tutors.length, `personas sound identical for: ${input}`);
  }

  assert.equal(allReplies.size, tutors.length * inputs.length, "the nine persona/input replies should all be distinct");
}

async function testMockHintSafety() {
  const knownResult = await chatMock({
    system: "# 힌트 생성\n## 학습자가 하고 싶은 말\n오늘 너무 피곤해요",
    messages: [{ role: "user", content: "힌트를 생성해 주세요." }],
    feature: "regression-hint",
  });
  const known = JSON.parse(knownResult.text) as { primary?: { en: string }; unavailable?: boolean };
  assert.equal(known.unavailable, undefined);
  assert.equal(known.primary?.en, "I'm tired today.");
  assert.doesNotMatch(known.primary?.en ?? "", /[가-힣]/, "mock hint embedded Korean inside the English listen target");

  const unknownResult = await chatMock({
    system: "# 힌트 생성\n## 학습자가 하고 싶은 말\n양자역학의 불확정성 원리를 쉽게 설명하고 싶어요",
    messages: [{ role: "user", content: "힌트를 생성해 주세요." }],
    feature: "regression-hint",
  });
  const unknown = JSON.parse(unknownResult.text) as { primary?: { en: string }; unavailable?: boolean; message?: string };
  assert.equal(unknown.unavailable, true);
  assert.equal(unknown.primary, undefined, "unknown Korean must not become a fake listenable English hint");
  assert.ok(unknown.message, "unavailable hint should explain the limitation honestly");
}

async function testMockSituationHints() {
  const cases = [
    ["cafe", "아이스 라테 한 잔 주세요"],
    ["airport", "창가 자리로 주세요"],
    ["hotel", "와이파이 비밀번호가 뭐예요"],
    ["restaurant", "메뉴판을 주세요"],
    ["interview", "제 장점은 책임감이 강한 것입니다"],
    ["date", "주말에 뭐 하는 걸 좋아해요"],
    ["hospital", "어제부터 머리가 아파요"],
    ["shopping", "이거 입어 봐도 될까요"],
  ] as const;

  for (const [situation, korean] of cases) {
    const result = await chatMock({
      system: `# 힌트 생성\n## 학습자가 하고 싶은 말\n${korean}`,
      messages: [{ role: "user", content: "힌트를 생성해 주세요." }],
      feature: `regression-hint-${situation}`,
    });
    const parsed = JSON.parse(result.text) as { primary?: { en: string }; unavailable?: boolean };
    assert.notEqual(parsed.unavailable, true, `${situation} core hint was unavailable: ${korean}`);
    assert.ok(parsed.primary?.en, `${situation} core hint did not return an English sentence`);
    assert.doesNotMatch(parsed.primary?.en ?? "", /[가-힣]/, `${situation} hint embedded Korean in the listen target`);
  }
}

async function testLearningOpeningsStayEnglishOnly() {
  for (const unit of getUnits()) {
    const system = [
      "# 러닝모드 진행자",
      "## 오늘의 유닛",
      `- 유닛: ${unit.title} (${unit.titleKo}) — ${unit.topic}`,
      "## 현재 단계: review",
      "- 현재 단계에서 오간 튜터 턴 수: 0",
      "- 복습 대상: (없음)",
    ].join("\n");
    const result = await chatMock({
      system,
      messages: [{
        role: "user",
        content: "(시스템: 방금 영상통화가 연결되었습니다. 학습자는 아직 아무 말도 하지 않았습니다.)",
      }],
      feature: `regression-learning-opening-${unit.id}`,
    });
    const parsed = JSON.parse(result.text) as MockReply;
    assert.doesNotMatch(parsed.reply, /[가-힣]/, `${unit.id} mixed Korean into the English spoken reply`);
    assert.match(parsed.reply_ko, /[가-힣]/, `${unit.id} did not provide a Korean subtitle`);
    assert.doesNotMatch(parsed.reply_ko, /[A-Za-z]/, `${unit.id} mixed the English title into the Korean subtitle`);
  }
}

async function testScenarioOpeningTranslations() {
  const expectedKo: Record<string, string> = {
    cafe: "안녕하세요, 어서 오세요. 무엇을 준비해 드릴까요?",
    airport: "좋은 아침입니다. 여권을 보여주시겠어요?",
    hotel: "호텔에 오신 걸 환영합니다. 예약하셨나요?",
    restaurant: "안녕하세요. 주문하시겠어요, 아니면 추천을 받아보시겠어요?",
    interview: "오늘 와주셔서 감사합니다. 먼저 간단히 자기소개해 주시겠어요?",
    date: "안녕하세요, 만나서 정말 반가워요. 여기 찾아오기 쉬웠어요?",
    hospital: "안녕하세요. 오늘 어디가 불편하세요?",
    shopping: "안녕하세요! 무엇을 찾고 계신지 알려주시면 도와드릴게요.",
  };

  for (const scenario of getScenarios()) {
    const system = [
      "# 시나리오 롤플레이",
      `- 장소/상황: ${scenario.title} (${scenario.titleKo}) — ${scenario.descriptionKo}`,
      `- 당신의 역할: ${scenario.tutorRole}`,
      `- 학습자의 역할: ${scenario.learnerRole}`,
      `- 학습 목표: ${scenario.goalKo}`,
      `- 첫 역할 대사 "${scenario.openingLine}"`,
    ].join("\n");
    const result = await chatMock({
      system,
      messages: [{
        role: "user",
        content: "(시스템: 방금 영상통화가 연결되었습니다. 학습자는 아직 아무 말도 하지 않았습니다.)",
      }],
      feature: `regression-scenario-opening-${scenario.id}`,
    });
    const parsed = JSON.parse(result.text) as MockReply;
    assert.equal(parsed.reply, scenario.openingLine, `${scenario.id} did not use its configured opening line`);
    assert.equal(parsed.reply_ko, expectedKo[scenario.id], `${scenario.id} opening subtitle does not translate the spoken line`);
    assert.doesNotMatch(parsed.reply_ko, /상황:|역할:|목표:/, `${scenario.id} repeated briefing text in the live subtitle`);
  }
}

async function testCorrectionDoesNotReEchoTheError() {
  const original = "Yesterday I go to Busan";
  const result = await chatMock({
    system: "- 이름: Mia Carter\n# 채팅 모드",
    messages: [{ role: "user", content: original }],
    feature: "regression-correction-follow-up",
  });
  const parsed = JSON.parse(result.text) as MockReply;

  assert.equal(parsed.correction?.better, "Yesterday I went to Busan");
  assert.match(parsed.reply, /Yesterday I went to Busan/);
  assert.doesNotMatch(parsed.reply, /Yesterday I go to Busan/);
  assert.match(parsed.reply, /from the trip/i, "the follow-up should refer to the trip naturally");
  assert.equal((parsed.reply.match(/\?/g) ?? []).length, 1, "the correction turn should ask only one follow-up question");
}

const airportSystem = [
  "- 이름: Jack Riley",
  "- 영어 레벨: 2",
  "# 시나리오 롤플레이",
  "- 장소/상황: Airport (공항) — 출국장 체크인 카운터",
  "- 당신의 역할: 체크인 카운터 직원",
  "- 학습자의 역할: 탑승 수속하는 여행객",
  "- 학습 목표: 여권과 목적지 확인 후 수하물 부치기",
].join("\n");

async function testAirportRepairsInvalidAnswers() {
  const forgotText = "sorry I'm I'm forgot forgot";
  const forgotResult = await chatMock({
    system: airportSystem,
    messages: [
      { role: "assistant", content: "Good morning. May I see your passport, please?" },
      { role: "user", content: forgotText },
    ],
    feature: "regression-airport-forgot-passport",
  });
  const forgot = JSON.parse(forgotResult.text) as MockReply;
  assert.doesNotMatch(forgot.reply, /(?:have|received|checked) your passport/i, "a forgotten passport was falsely accepted");
  assert.match(forgot.reply, /forgot your passport/i, "the missing passport was not acknowledged");
  assert.match(forgot.reply, /retrieve it\?/i, "the role-play did not stay on the unresolved passport step");
  assert.equal(forgot.correction?.better, "I'm sorry, I forgot my passport.");

  const recoveredPassportResult = await chatMock({
    system: airportSystem,
    messages: [
      { role: "assistant", content: "Can you retrieve your passport?" },
      { role: "user", content: "I found it. Here's my passport." },
    ],
    feature: "regression-airport-recovered-passport",
  });
  const recoveredPassport = JSON.parse(recoveredPassportResult.text) as MockReply;
  assert.match(recoveredPassport.reply, /can see your passport/i);
  assert.match(recoveredPassport.reply, /Which city are you flying to/i);

  const agreementOnlyResult = await chatMock({
    system: airportSystem,
    messages: [
      { role: "assistant", content: "Can you retrieve your passport?" },
      { role: "user", content: "Sure." },
    ],
    feature: "regression-airport-passport-agreement-only",
  });
  const agreementOnly = JSON.parse(agreementOnlyResult.text) as MockReply;
  assert.doesNotMatch(agreementOnly.reply, /can see your passport|which city|how many bags/i, "agreement alone was treated as presenting a passport");
  assert.match(agreementOnly.reply, /show the document|show me your passport/i, "agreement should stay on the document handoff step");

  const numericResult = await chatMock({
    system: airportSystem,
    messages: [
      { role: "assistant", content: "Thank you, I can see your passport. Which city are you flying to today?" },
      { role: "user", content: "100" },
    ],
    feature: "regression-airport-numeric-destination",
  });
  const numeric = JSON.parse(numericResult.text) as MockReply;
  assert.doesNotMatch(numeric.reply, /destination as ['\"]?100/i, "the number 100 was accepted as a destination");
  assert.match(numeric.reply, /need a city name/i, "the invalid destination did not get a grounded recovery message");
  assert.match(numeric.reply, /Which city are you flying to\?/i, "the model advanced instead of asking for the city again");
}

async function testKoreanScenarioHelpAndPipelinePreservation() {
  const korean = "여권을 깜빡했어요";
  const mockResult = await chatMock({
    system: airportSystem,
    messages: [
      { role: "assistant", content: "Good morning. May I see your passport, please?" },
      { role: "user", content: korean },
    ],
    feature: "regression-airport-korean-help",
  });
  const mock = JSON.parse(mockResult.text) as MockReply;
  assert.equal(mock.suggestion?.en, "I'm sorry, I forgot my passport.");
  assert.equal(mock.suggestion?.ko, "죄송하지만 여권을 깜빡했어요.");
  assert.match(mock.reply, /forgot my passport/i, "the learner's Korean meaning was not taught in English");
  assert.doesNotMatch(mock.reply, /(?:have|received|checked) your passport/i, "Korean help contradicted the missing passport");

  const missedFlightResult = await chatMock({
    system: airportSystem,
    messages: [
      { role: "assistant", content: "Good morning. May I see your passport, please?" },
      { role: "user", content: "비행기를 놓칠 것 같아요" },
    ],
    feature: "regression-airport-korean-missed-flight",
  });
  const missedFlight = JSON.parse(missedFlightResult.text) as MockReply;
  assert.equal(missedFlight.suggestion?.en, "I think I'm going to miss my flight.");
  assert.doesNotMatch(missedFlight.suggestion?.en ?? "", /help saying this/i);
  assert.match(missedFlight.reply, /worried about missing your flight/i);
  assert.doesNotMatch(missedFlight.reply, /have .* as your destination/i);

  const unknownKoreanResult = await chatMock({
    system: airportSystem,
    messages: [
      { role: "assistant", content: "Good morning. May I see your passport, please?" },
      { role: "user", content: "양자역학 이야기를 하고 싶어요" },
    ],
    feature: "regression-airport-unknown-korean",
  });
  const unknownKorean = JSON.parse(unknownKoreanResult.text) as MockReply;
  assert.equal(unknownKorean.suggestion, null, "unknown Korean must not teach an unrelated stock sentence");
  assert.doesNotMatch(unknownKorean.reply, /I need help saying this in English/i);

  // runTurn에서 일반 freetalk suggestion을 제거하는 안전장치가 한국어 도움
  // 카드까지 지우지 않는지 실제 파이프라인 경로로 확인한다.
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "avatar-tutor-scenario-regression-"));
  const previousStoreDir = process.env.STORE_DIR;
  try {
    process.env.STORE_DIR = storeDir;
    process.env.ANTHROPIC_API_KEY = "";
    const { DEFAULT_USER, saveUser } = await import("../src/core/gamification");
    const { applyScenarioGroundingGuard, runTurn } = await import("../src/core/pipeline/turn");
    saveUser({ ...structuredClone(DEFAULT_USER), onboarded: true, name: "Scenario Tester", level: 2 });
    const session: SessionRecord = {
      id: "scenario-korean-help",
      tutorId: "jack",
      mode: "freetalk",
      scenarioId: "airport",
      startedAt: Date.now(),
      turns: [{
        id: "opening",
        role: "tutor",
        text: "Good morning. May I see your passport, please?",
        ko: "좋은 아침입니다. 여권을 보여주시겠어요?",
        ts: Date.now(),
      }],
      corrections: [],
      judgments: [],
      xpEarned: 0,
      pronunciationScores: [],
    };
    const result = await runTurn({ session, userText: korean });
    assert.equal(result.suggestion?.en, "I'm sorry, I forgot my passport.", "pipeline removed the Korean-to-English coaching card");
    assert.ok(result.events.includes("scenario-expression-help"), "Korean help turn did not expose progress feedback data");
    assert.equal(session.turns.at(-1)?.suggestion?.en, result.suggestion?.en, "the coaching suggestion was not stored with the turn");

    const freeTalkSession: SessionRecord = {
      id: "freetalk-korean-help",
      tutorId: "mia",
      mode: "freetalk",
      startedAt: Date.now(),
      turns: [{
        id: "freetalk-opening",
        role: "tutor",
        text: "How has your day been?",
        ko: "오늘 하루는 어땠어요?",
        ts: Date.now(),
      }],
      corrections: [],
      judgments: [],
      xpEarned: 0,
      pronunciationScores: [],
    };
    const freeTalkHelp = await runTurn({ session: freeTalkSession, userText: "오늘 너무 피곤해요" });
    assert.equal(freeTalkHelp.suggestion?.en, "I'm tired today.", "scenario-less freetalk removed Korean-to-English help");
    assert.equal(freeTalkHelp.suggestion?.ko, "오늘 피곤해요.");
    assert.match(freeTalkHelp.reply, /tired today/i, "freetalk did not teach the meaning the learner expressed");
    assert.ok(freeTalkHelp.events.includes("freetalk-expression-help"), "freetalk Korean help did not expose a progress event");
    assert.equal(freeTalkSession.turns.at(-1)?.suggestion?.en, freeTalkHelp.suggestion.en, "freetalk help was not stored with the tutor turn");

    const unsafeBase: TutorTurnOutput = {
      reply: "Thank you, I have your passport. Which city are you flying to today?",
      reply_ko: "여권을 받았습니다.",
      correction: null,
      suggestion: null,
      new_expression: null,
      used_expressions: [],
      stage_signal: "stay",
      end_call: false,
    };
    const guardedPassport = applyScenarioGroundingGuard(
      unsafeBase,
      "airport",
      "I forgot my passport",
      "May I see your passport?",
    );
    assert.doesNotMatch(guardedPassport.reply, /thank you[^.]*have your passport|(?:received|checked) your passport/i, "pipeline guard exposed a false passport receipt");
    assert.match(guardedPassport.reply, /can't complete check-in/i);

    const silentlyAdvancedPassport = applyScenarioGroundingGuard(
      { ...unsafeBase, reply: "All right. How many bags are you checking?" },
      "airport",
      "I forgot my passport",
      "May I see your passport?",
    );
    assert.match(silentlyAdvancedPassport.reply, /can't complete check-in/i, "missing passport silently advanced without echoing a false receipt");
    assert.doesNotMatch(silentlyAdvancedPassport.reply, /how many bags/i);

    const agreementGuard = applyScenarioGroundingGuard(
      { ...unsafeBase, reply: "Great. Which city are you flying to?" },
      "airport",
      "Of course.",
      "May I see your passport?",
    );
    assert.match(agreementGuard.reply, /still need to see your passport/i, "agreement alone bypassed the passport presentation step");
    assert.doesNotMatch(agreementGuard.reply, /which city/i);

    const falseReceiptWithoutAdvance = applyScenarioGroundingGuard(
      { ...unsafeBase, reply: "Thank you, I have your passport." },
      "airport",
      "Sure.",
      "May I see your passport?",
    );
    assert.match(falseReceiptWithoutAdvance.reply, /still need to see your passport/i, "agreement alone was turned into a false passport receipt");

    const guardedDestination = applyScenarioGroundingGuard(
      { ...unsafeBase, reply: "I have your destination as '100'. How many bags would you like to check?" },
      "airport",
      "100",
      "Which city are you flying to today?",
    );
    assert.doesNotMatch(guardedDestination.reply, /destination as ['\"]?100/i, "pipeline guard exposed a numeric destination");
    assert.match(guardedDestination.reply, /need a city name/i);

    const silentlyAdvancedDestination = applyScenarioGroundingGuard(
      { ...unsafeBase, reply: "Thanks. How many bags would you like to check?" },
      "airport",
      "100",
      "Which city are you flying to today?",
    );
    assert.match(silentlyAdvancedDestination.reply, /need a city name/i, "numeric destination silently advanced without echoing the invalid value");
    assert.doesNotMatch(silentlyAdvancedDestination.reply, /how many bags/i);
  } finally {
    if (previousStoreDir === undefined) delete process.env.STORE_DIR;
    else process.env.STORE_DIR = previousStoreDir;
    fs.rmSync(storeDir, { recursive: true, force: true });
  }
}

async function main() {
  testEndIntent();
  testRepeatIntent();
  testTutorVoiceProfilesStayDistinct();
  await testCafeCompletion();
  await testMockPersonaVariety();
  await testMockHintSafety();
  await testMockSituationHints();
  await testLearningOpeningsStayEnglishOnly();
  await testScenarioOpeningTranslations();
  await testCorrectionDoesNotReEchoTheError();
  await testAirportRepairsInvalidAnswers();
  await testKoreanScenarioHelpAndPipelinePreservation();
  console.log("conversation regressions: 12 groups passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
