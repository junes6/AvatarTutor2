import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CorrectionCard, SessionRecord, TurnLog, UserState } from "../src/core/types";

const correction: CorrectionCard = {
  original: "Yesterday I go to school",
  better: "Yesterday I went to school.",
  ko: "어제 학교에 갔어요.",
  reason: "과거 일이므로 went를 써요.",
  type: "tense",
};

function session(mode: SessionRecord["mode"] = "freetalk", turns: TurnLog[] = []): SessionRecord {
  return {
    id: `level-regression-${mode}`,
    tutorId: "mia",
    mode,
    startedAt: Date.now(),
    turns,
    corrections: [],
    judgments: [],
    xpEarned: 0,
    pronunciationScores: [],
  };
}

async function main() {
  const tempRoot = path.resolve(os.tmpdir());
  const storeDir = fs.mkdtempSync(path.join(tempRoot, "avatar-tutor-level-regression-"));
  try {
    process.env.STORE_DIR = storeDir;
    process.env.ANTHROPIC_API_KEY = "";

    const { DEFAULT_USER, getUser, saveUser } = await import("../src/core/gamification");
    const { readJSON } = await import("../src/core/store");
    const {
      correctionAllowedForTurn,
      effectiveSpeechRate,
      getLearnerLevelProfile,
      inferLearnerLevelEvidence,
      recordLearnerLevelEvidence,
      resetLearnerLevelProfile,
    } = await import("../src/core/levelAdaptation");
    const { buildSystemPrompt } = await import("../src/core/pipeline/systemPrompt");
    const { greetTurn, limitReplyToLevelBudget, runTurn } = await import("../src/core/pipeline/turn");
    const { chatMock } = await import("../src/core/llm/mock");
    const { getScenarios } = await import("../src/core/content");
    const { combineBrowserFallbackRate } = await import("../src/hooks/useAudioPlayer");
    const { POST: ttsPost } = await import("../src/app/api/tts/route");

    const user: UserState = {
      ...structuredClone(DEFAULT_USER),
      onboarded: true,
      name: "Level Regression Learner",
      level: 2,
    };
    saveUser(user);
    resetLearnerLevelProfile(2);

    // 연결 인사와 curated 역할 opening은 일반 턴 길이 절단에서 제외한다.
    // 실제 greetTurn → runTurn 경로에서도 세 번째 문장의 질문과 번역이 보존돼야 한다.
    const scenarioOpeningKo: Record<string, string> = {
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
      const greetingSession = { ...session("freetalk"), id: `greeting-${scenario.id}`, scenarioId: scenario.id };
      const greeting = await greetTurn(greetingSession);
      assert.equal(greeting.reply, scenario.openingLine, `${scenario.id} opening was cut by the level budget`);
      assert.equal(greeting.reply_ko, scenarioOpeningKo[scenario.id], `${scenario.id} opening translation was lost or mismatched`);
      if (scenario.openingLine.includes("?")) {
        assert.match(greeting.reply, /\?/, `${scenario.id} lost the opening question that hands the turn to the learner`);
      }
    }

    const limitedOpening = limitReplyToLevelBudget(
      "Hi! Welcome in. What can I get started for you?",
      2,
      34,
    );
    assert.match(limitedOpening, /What can I get started for you\?/i, "sentence limiter discarded the learner-facing question");
    assert.ok((limitedOpening.match(/\?/g) ?? []).length === 1);
    assert.match(
      limitReplyToLevelBudget(
        "I am very glad that you shared all of those useful details with me today. What would you like to discuss next?",
        2,
        5,
      ),
      /What would you like to discuss next\?/,
      "word limiter cut or removed the learner-facing question",
    );

    // 인사·한두 단어·한국어는 레벨 표본이 아니며, 복잡한 문장은 단순문보다
    // 높은 신호를 내야 한다.
    assert.equal(inferLearnerLevelEvidence("Hello!"), null);
    assert.equal(inferLearnerLevelEvidence("좋은 하루였어요"), null);
    const simple = inferLearnerLevelEvidence("I like drawing every day.");
    const advanced = inferLearnerLevelEvidence(
      "Although the deadline was demanding, I have been reorganising the project so that everyone can contribute, which has made the final proposal considerably clearer and more persuasive.",
    );
    assert.ok(simple && advanced);
    assert.ok(advanced.estimatedLevel > simple.estimatedLevel + 1.5, "complex English did not produce a stronger level signal");
    assert.ok(
      (inferLearnerLevelEvidence("Yesterday I go to school", correction)?.estimatedLevel ?? 5)
        < (inferLearnerLevelEvidence("Yesterday I go to school")?.estimatedLevel ?? 0),
      "a grounded correction did not reduce confidence in the observed sample",
    );

    const advancedText = "Although the deadline was demanding, I have been reorganising the project so that everyone can contribute, which has made the final proposal considerably clearer and more persuasive.";
    await runTurn({ session: session("freetalk"), userText: advancedText });
    await runTurn({ session: session("chat"), userText: advancedText });
    assert.equal(
      getLearnerLevelProfile(getUser().level).samples,
      2,
      "local call and local chat did not both feed the adaptive profile through runTurn",
    );
    resetLearnerLevelProfile(2);

    // 자연스러운 짧은 답을 여러 번 해도 하향 조정하지 않는다.
    for (let index = 0; index < 80; index++) {
      recordLearnerLevelEvidence({ text: "I like drawing every day.", mode: "freetalk" });
    }
    assert.equal(getUser().level, 2, "short natural replies incorrectly lowered the learner level");
    assert.ok(
      getLearnerLevelProfile(2).evidenceWeight <= 16.5,
      "old evidence grew without bound and would prevent later adaptation",
    );

    // 충분한 독립 표본 전에는 유지하고, 최소 표본이 모여도 한 번에 한 단계만 이동한다.
    resetLearnerLevelProfile(2);
    for (let index = 0; index < 5; index++) {
      const result = recordLearnerLevelEvidence({ text: advancedText, mode: index % 2 === 0 ? "freetalk" : "chat" });
      assert.equal(result.changed, false, `level changed before the sixth sample (sample ${index + 1})`);
    }
    const promoted = recordLearnerLevelEvidence({ text: advancedText, mode: "chat" });
    assert.equal(promoted.changed, true);
    assert.equal(promoted.previousLevel, 2);
    assert.equal(promoted.level, 3, "adaptive update skipped more than one level or failed to advance");

    const overplacedUser = getUser();
    overplacedUser.level = 4;
    saveUser(overplacedUser);
    resetLearnerLevelProfile(4);
    for (let index = 0; index < 7; index++) {
      const result = recordLearnerLevelEvidence({ text: correction.original, mode: "freetalk", correction });
      assert.equal(result.changed, false, `level dropped before enough repeated error evidence (sample ${index + 1})`);
    }
    const demoted = recordLearnerLevelEvidence({ text: correction.original, mode: "chat", correction });
    assert.equal(demoted.changed, true);
    assert.equal(demoted.previousLevel, 4);
    assert.equal(demoted.level, 3, "adaptive downgrade skipped more than one level or failed to adjust");

    // 러닝모드 모범문장·따라 말하기·외부 채널은 프로필을 전혀 쓰지 않는다.
    const beforeExcluded = readJSON<unknown>("learner-level-adaptation", null);
    recordLearnerLevelEvidence({ text: advancedText, mode: "learning" });
    recordLearnerLevelEvidence({
      text: advancedText,
      mode: "freetalk",
      judgment: { target: advancedText, said: advancedText, score: 100, pass: true, method: "similarity" },
    });
    recordLearnerLevelEvidence({ text: advancedText, mode: "chat", externalConversation: true });
    assert.deepEqual(
      readJSON<unknown>("learner-level-adaptation", null),
      beforeExcluded,
      "excluded channels or rote repetition mutated the local level profile",
    );

    // 실제 프롬프트의 길이·어휘·질문·교정 강도가 레벨마다 달라야 한다.
    const latest = getUser();
    latest.level = 1;
    saveUser(latest);
    resetLearnerLevelProfile(1);
    const levelOnePrompt = buildSystemPrompt(session("freetalk"), undefined, { userText: "I like drawing." });
    assert.match(levelOnePrompt, /보통 8~18단어/);
    assert.match(levelOnePrompt, /yes\/no 또는 두 선택지/);
    assert.match(levelOnePrompt, /뜻을 막는 핵심 오류/);

    latest.level = 5;
    saveUser(latest);
    resetLearnerLevelProfile(5);
    const levelFivePrompt = buildSystemPrompt(session("freetalk"), undefined, { userText: "I like drawing." });
    assert.match(levelFivePrompt, /보통 28~58단어/);
    assert.match(levelFivePrompt, /뉘앙스·레지스터/);
    assert.notEqual(levelOnePrompt, levelFivePrompt, "level-specific prompts are identical");

    // API 키가 없는 mock 대화도 같은 입력을 초급에서는 짧은 선택 질문으로,
    // 상급에서는 자연스러운 확장 질문으로 다르게 처리한다.
    const mockInput = "I reorganised my bookshelf this afternoon.";
    const mockAtLevel = async (level: number) => {
      const result = await chatMock({
        system: `- 이름: Mia Carter\n- 영어 레벨: ${level}/5\n# 채팅 모드`,
        messages: [{ role: "user", content: mockInput }],
        feature: `regression-mock-level-${level}`,
      });
      return JSON.parse(result.text) as { reply: string; correction: CorrectionCard | null };
    };
    const beginnerMock = await mockAtLevel(1);
    const advancedMock = await mockAtLevel(5);
    assert.notEqual(beginnerMock.reply, advancedMock.reply, "mock replies ignore the configured learner level");
    assert.ok(beginnerMock.reply.split(/\s+/).length <= 18, "beginner mock reply exceeded its short-turn budget");
    assert.match(beginnerMock.reply, /good or difficult/i, "beginner mock did not use a simple choice question");

    // 교정 카드는 레벨·모드별 간격을 지키며, 간격이 지나면 다시 열린다.
    const history: TurnLog[] = [
      { id: "u1", role: "user", text: correction.original, ts: 1 },
      { id: "t1", role: "tutor", text: "I understood you.", ts: 2, correction },
    ];
    const correctionSession = session("freetalk", history);
    assert.equal(correctionAllowedForTurn(correctionSession, 1), false);
    assert.equal(
      correctionAllowedForTurn(session("chat", [
        { id: "cu1", role: "user", text: correction.original, ts: 1, correction },
        { id: "ct1", role: "tutor", text: "I understood you.", ts: 2 },
      ]), 2),
      false,
      "persisted chat corrections were not included in the cooldown",
    );
    assert.match(
      buildSystemPrompt(session("freetalk", [...history]), undefined, { userText: "Yesterday I go home" }),
      /이번 턴 교정 카드:[^\n]*보류/,
      "the correction budget was not communicated to the model",
    );
    correctionSession.turns.push(
      { id: "u2", role: "user", text: "It was busy.", ts: 3 },
      { id: "t2", role: "tutor", text: "That sounds busy.", ts: 4 },
      { id: "u3", role: "user", text: "I had a meeting.", ts: 5 },
      { id: "t3", role: "tutor", text: "Meetings can take energy.", ts: 6 },
    );
    assert.equal(correctionAllowedForTurn(correctionSession, 1), true);
    const blockedMock = await chatMock({
      system: buildSystemPrompt(session("chat", history.slice(0, 2)), undefined, { userText: correction.original }),
      messages: [{ role: "user", content: correction.original }],
      feature: "regression-correction-budget",
    });
    const blockedOutput = JSON.parse(blockedMock.text) as { reply: string; correction: CorrectionCard | null };
    assert.equal(blockedOutput.correction, null, "mock ignored the correction cooldown");
    assert.doesNotMatch(blockedOutput.reply, /you mean/i, "mock mentioned a correction during the cooldown");

    // 속도는 같은 사용자 설정에서 레벨과 함께 단조 증가하고, 같은 레벨에서는
    // 느림/기본/빠름 선호를 그대로 보존한다.
    const byLevel = [1, 2, 3, 4, 5].map((level) => effectiveSpeechRate(level, 1));
    assert.deepEqual(byLevel, [0.84, 0.92, 1, 1.06, 1.12]);
    for (let index = 1; index < byLevel.length; index++) assert.ok(byLevel[index] > byLevel[index - 1]);
    assert.ok(effectiveSpeechRate(3, 0.8) < effectiveSpeechRate(3, 1));
    assert.ok(effectiveSpeechRate(3, 1.2) > effectiveSpeechRate(3, 1));

    const ttsUser = getUser();
    ttsUser.level = 1;
    ttsUser.settings.speechRate = 0.8;
    saveUser(ttsUser);
    const ttsResponse = await ttsPost(new Request("http://localhost/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "How are you today?", tutorId: "mia", speed: 1 }),
    }));
    assert.equal(ttsResponse.status, 200);
    const ttsPayload = await ttsResponse.json() as { audio: unknown; fallbackRate: number };
    assert.equal(ttsPayload.audio, null, "keyless regression unexpectedly returned provider audio");
    assert.equal(ttsPayload.fallbackRate, 0.75, "TTS API dropped the level × user speed rate");
    assert.equal(
      combineBrowserFallbackRate(0.7, ttsPayload.fallbackRate),
      0.525,
      "browser fallback did not combine replay speed with adaptive speed",
    );

    // 변경 후 프로필은 새 레벨을 앵커로 다시 시작해 연속 점프를 막는다.
    resetLearnerLevelProfile(5);
    const profile = getLearnerLevelProfile(5);
    assert.equal(profile.anchorLevel, 5);
    assert.equal(profile.samples, 0);

    console.log("level adaptation regressions: evidence, gradual update, exclusions, prompts, cadence, and speech rate passed");
  } finally {
    const resolvedStoreDir = path.resolve(storeDir);
    const expectedPrefix = `${tempRoot}${path.sep}avatar-tutor-level-regression-`;
    if (resolvedStoreDir.startsWith(expectedPrefix)) fs.rmSync(resolvedStoreDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
