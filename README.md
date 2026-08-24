# 아바타튜터 (Avatar Tutor)

튜터 친구 3명과 **채팅·영상통화**를 오가며 배우는 영어 회화 앱.
러닝모드 한 유닛을 처음부터 끝까지(복습 → 새 표현 → 상황 연습 → 프리토킹 → 리포트) 몰입감 있게 플레이할 수 있다.

## 핵심 아키텍처

대화 품질은 아바타 API 내장 기능에 맡기지 않는다. **두뇌(LLM)·귀(STT)·입(TTS)을 직접 연결한 자체 파이프라인** 위에, 아바타는 표시 레이어로만 얹는다.

```
[푸시투토크 녹음] → STT(Whisper) → 파이프라인(Claude: 페르소나+기억+교정+러닝엔진) → TTS(OpenAI/ElevenLabs) → [아바타 레이어 L0~L2]
```

| 역할 | 기본 | 폴백 |
|---|---|---|
| 두뇌 (LLM) | Anthropic Claude (`claude-sonnet-5`) | 목(mock) LLM — 키 없이 전체 흐름 시연 |
| 귀 (STT) | OpenAI `gpt-4o-transcribe` | `whisper-1` 자동 폴백 → 키 없으면 목 |
| 입 (TTS) | OpenAI `gpt-4o-mini-tts` (튜터별 목소리) | ElevenLabs 어댑터 교체 가능 → 키 없으면 브라우저 speechSynthesis |
| 발음 평가 | Azure Pronunciation Assessment | STT 재인식 유사도 근사 채점 |
| 아바타 | L0 프로필+파형 (무료) | L1 루프 영상 → L2 실시간 API(Anam/Simli) |

## 실행 방법

```bash
npm install
npm run dev   # http://localhost:3000
```

### 목(mock) 모드 — 키 없이 실행
`.env.local` 없이 실행하면 LLM/STT/TTS가 전부 시뮬레이션으로 동작한다.
UI 흐름·러닝모드 단계 진행·게임화 이펙트를 키 없이 확인할 수 있다 (대화 품질은 없음).

### 실연동 모드
```bash
cp .env.example .env.local   # 후 키 입력
```

| 키 | 발급처 | 용도 |
|---|---|---|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys | 튜터 대화·교정·기억·능동 메시지 전부 |
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys | STT + TTS |
| `ELEVENLABS_API_KEY` (선택) | https://elevenlabs.io | TTS 교체 (`TTS_PROVIDER=elevenlabs`) |
| `AZURE_SPEECH_KEY` (선택) | https://portal.azure.com (Speech Service) | 음소 단위 발음 채점 |
| `VAPID_*` (선택) | `npx web-push generate-vapid-keys` | PWA 푸시 알림 |
| `ANAM_API_KEY` / `SIMLI_API_KEY` (선택) | https://anam.ai / https://simli.com | L2 실시간 아바타 |

## 아바타 레이어 전환 (L0 → L2)

`.env.local`의 `NEXT_PUBLIC_AVATAR_LAYER`로 전환한다. 상위 단계가 실패하면 자동으로 하위 단계로 폴백한다.

- **L0 (기본, 무료)** — 튜터 프로필 사진 + 말할 때 파형/입모양 애니메이션
- **L1 (무료)** — 사전 생성 루프 영상. `public/avatars/video/{tutorId}-idle.mp4`와 `{tutorId}-talk.mp4`를 넣으면 자동 감지된다 (예: `mia-idle.mp4`)
- **L2 (실시간 API)** — `AVATAR_L2_PROVIDER=anam|simli` + 해당 키 설정. 서버가 세션 토큰을 발급(`/api/avatar/session`, `src/core/avatar/l2.ts`)하며, 클라이언트 스트림 연결은 제공자 SDK(`@anam-ai/js-sdk` / `simli-client`)를 `AvatarView.tsx`의 표시된 통합 지점에 연결하면 완성된다. SDK 미연결/실패 시 L1→L0 폴백.

## 외부 검증 구조 (리뷰어용)

앱 실행 없이 repo만으로 대화 품질을 검증·개선할 수 있다.

1. **프롬프트 분리** — 모든 시스템 프롬프트는 [`prompts/*.md`](prompts/) 개별 파일. 파일만 고치면 동작이 바뀐다.
   - `tutor-base.md` 공통 규칙·JSON 출력 계약 / `correction-engine.md` 2트랙 교정(한국인 오류 패턴) / `learning-conductor.md` 러닝모드 단계 진행 / `freetalk.md`·`chat-mode.md`·`scenario-block.md` 모드별 / `proactive-message.md`·`memory-summarizer.md`·`hint.md`·`level-test.md`
2. **CLI 시뮬레이터** — STT를 건너뛰고 텍스트 발화로 파이프라인을 실행:
   ```bash
   npx tsx scripts/simulate.ts --mode freetalk --tutor mia --say "I am agree with you" --say "Yesterday I go to Busan"
   npx tsx scripts/simulate.ts --mode learning --tutor oliver --unit unit-01 --file utterances.json
   ```
   튜터 응답·교정 카드·따라말하기 판정·단계 진행·토큰 사용량을 JSON으로 출력한다.
   기본적으로 임시 스토어로 격리되며(`--persist`로 해제), 직전 턴에 suggestion 카드가 있으면 다음 발화를 따라 말하기 시도로 판정한다.
3. **세션 로그** — 모든 세션은 종료 시 `logs/session-*.json`으로 내보낸다 (발화·튜터 응답·교정 카드·점수·사용 토큰 포함). `logs/`는 gitignore.

## 주요 기능 지도

| 기능 | 코드 |
|---|---|
| 푸시투토크 (슬라이드 취소, 말 끊기) | `src/components/PushToTalkButton.tsx`, `src/hooks/useRecorder.ts` |
| 턴 파이프라인 | `src/core/pipeline/turn.ts` (+`systemPrompt.ts`, `parse.ts`) |
| 러닝모드 단계 엔진 (복습→소개→연습→롤플레이) | `src/core/learning/engine.ts` |
| 간격 반복 복습 큐 (당일→3일→7일) | `src/core/srs.ts` |
| 튜터 장기기억 | `src/core/memory.ts` |
| 친밀도·XP·스트릭 | `src/core/gamification.ts` |
| 능동 메시지 (아침/퀴즈/근황/보고싶다) | `src/core/proactive.ts` |
| 교정·표현 제안 | `prompts/correction-engine.md` |
| 발음 평가 (Azure→유사도 폴백) | `src/core/pronunciation.ts` |
| 사용량·원가 추정 | `src/core/usage.ts` → `/admin` |
| PWA (설치·푸시) | `public/manifest.webmanifest`, `public/sw.js` |

## 데이터

- 튜터 페르소나: [`data/personas.json`](data/personas.json) — 추가/수정만으로 튜터가 늘어난다
- 초급 10유닛(표현 50개): [`data/units.json`](data/units.json)
- 시나리오 8종: [`data/scenarios.json`](data/scenarios.json)
- 런타임 상태(JSON, gitignore): `data/store/` — 사용자·채팅·세션·SRS·기억·사용량

## 폴백 동작 정리

- LLM 키 없음 → 목 LLM (흐름 시연용)
- STT 키 없음 → 목 전사 / `gpt-4o-transcribe` 실패 → `whisper-1`
- TTS 키 없음·실패 → 브라우저 speechSynthesis
- Azure 키 없음·실패 → 유사도 근사 채점
- L2/L1 아바타 실패 → L0
- VAPID 키 없음 → 푸시 스킵 (인앱만)
- 시나리오 환경음 파일 없음 → 무음 진행
- 턴 전송 실패 → 재시도 버튼 (녹음 유지, 대화 로그 유실 없음)
