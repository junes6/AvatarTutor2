/**
 * simulate.ts — UI 없이 대화 파이프라인을 실행하는 CLI (외부 검증용)
 *
 * 학습자 발화 텍스트 배열을 넣으면 STT를 건너뛰고
 * 튜터 응답·교정 카드·판정 결과를 JSON으로 출력한다.
 *
 * 사용법:
 *   npx tsx scripts/simulate.ts --mode freetalk --tutor mia --say "Hi! I am agree with you" --say "Yesterday I go to Busan"
 *   npx tsx scripts/simulate.ts --mode learning --tutor oliver --unit unit-01 --file utterances.json
 *   npx tsx scripts/simulate.ts --mode chat --tutor jack --say "what did you cook today?"
 *
 * 옵션:
 *   --mode      freetalk | learning | chat            (기본 freetalk)
 *   --tutor     mia | oliver | jack                   (기본 mia)
 *   --unit      러닝모드 유닛 id (예: unit-01)
 *   --scenario  프리토킹 시나리오 id (예: cafe)
 *   --say       학습자 발화 (여러 번 지정 가능)
 *   --file      발화 배열 JSON 파일 (["...", "..."])
 *   --persist   실제 data/store 에 기록 (기본: 임시 폴더로 격리)
 *
 * 동작:
 *   - 직전 턴에 suggestion(따라 말하기 카드)이 있으면 다음 발화를
 *     따라 말하기 시도로 간주해 유사도 판정을 수행한다 (앱과 동일).
 *   - ANTHROPIC_API_KEY 가 없으면 목(mock) LLM으로 동작한다.
 *   - 전체 로그를 logs/simulate-*.json 으로 내보낸다.
 */

import fs from "fs";
import os from "os";
import path from "path";

// .env.local / .env 로드 (없으면 무시)
for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(path.join(process.cwd(), f));
  } catch {}
}

function parseArgs(argv: string[]) {
  const args: { mode: string; tutor: string; unit?: string; scenario?: string; say: string[]; file?: string; persist: boolean } = {
    mode: "freetalk",
    tutor: "mia",
    say: [],
    persist: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode") args.mode = argv[++i];
    else if (a === "--tutor") args.tutor = argv[++i];
    else if (a === "--unit") args.unit = argv[++i];
    else if (a === "--scenario") args.scenario = argv[++i];
    else if (a === "--say") args.say.push(argv[++i]);
    else if (a === "--file") args.file = argv[++i];
    else if (a === "--persist") args.persist = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  // 기본: 사용자 상태를 오염시키지 않도록 임시 스토어로 격리
  if (!args.persist) {
    process.env.STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "avatar-tutor-sim-"));
  }

  // STORE_DIR 설정 이후에 코어 모듈 로드
  const { createSession, saveSession, exportSessionLog } = await import("../src/core/session");
  const { runTurn, greetTurn } = await import("../src/core/pipeline/turn");
  const { sentenceSimilarity, wordMatches } = await import("../src/core/similarity");
  const { getUser, saveUser } = await import("../src/core/gamification");
  const { isMockLLM } = await import("../src/core/config");

  let utterances = args.say;
  if (args.file) {
    utterances = [...utterances, ...(JSON.parse(fs.readFileSync(args.file, "utf8")) as string[])];
  }
  if (utterances.length === 0) {
    console.error("발화가 없습니다. --say 또는 --file 로 입력하세요.");
    process.exit(1);
  }

  // 시뮬레이션용 기본 사용자
  const user = getUser();
  if (!user.onboarded) {
    user.onboarded = true;
    user.name = "시뮬레이터";
    saveUser(user);
  }

  const session = createSession(args.tutor, args.mode as "freetalk" | "learning" | "chat", {
    unitId: args.unit,
    scenarioId: args.scenario,
  });

  const output: Record<string, unknown>[] = [];

  const greeting = await greetTurn(session);
  saveSession(session);
  output.push({
    turn: 0,
    kind: "greeting",
    reply: greeting.reply,
    reply_ko: greeting.reply_ko,
    stage: session.stageState?.stage ?? null,
    usage: greeting.usage,
  });

  let pendingSuggestion: string | null = greeting.suggestion?.en ?? null;

  for (let i = 0; i < utterances.length; i++) {
    const userText = utterances[i];

    // 직전 턴 suggestion → 따라 말하기 판정 (STT 재인식 대신 텍스트 유사도)
    let judgment;
    if (pendingSuggestion) {
      const score = sentenceSimilarity(pendingSuggestion, userText);
      judgment = {
        target: pendingSuggestion,
        said: userText,
        score,
        pass: score >= 70,
        method: "similarity" as const,
        wordScores: wordMatches(pendingSuggestion, userText),
      };
    }

    const result = await runTurn({ session, userText, judgment });
    saveSession(session);
    pendingSuggestion = result.suggestion?.en ?? null;

    output.push({
      turn: i + 1,
      userText,
      judgment: judgment ?? null,
      reply: result.reply,
      reply_ko: result.reply_ko,
      correction: result.correction,
      suggestion: result.suggestion,
      new_expression: result.new_expression,
      used_expressions: result.used_expressions,
      stage: session.stageState?.stage ?? null,
      events: result.events,
      end_call: result.end_call,
      usage: result.usage,
    });

    if (result.end_call) break;
  }

  session.endedAt = Date.now();
  saveSession(session);
  exportSessionLog(session);

  const totalUsage = session.turns.reduce(
    (acc, t) => ({
      inputTokens: acc.inputTokens + (t.usage?.inputTokens ?? 0),
      outputTokens: acc.outputTokens + (t.usage?.outputTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0 },
  );

  console.log(
    JSON.stringify(
      {
        meta: {
          mode: args.mode,
          tutor: args.tutor,
          unit: args.unit ?? null,
          scenario: args.scenario ?? null,
          llm: isMockLLM() ? "mock" : process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
          sessionId: session.id,
          logFile: `logs/session-${session.id}.json`,
        },
        turns: output,
        summary: {
          corrections: session.corrections,
          judgments: session.judgments.map((j) => ({ target: j.target, score: j.score, pass: j.pass })),
          xpEarned: session.xpEarned,
          finalStage: session.stageState?.stage ?? null,
          totalUsage,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
