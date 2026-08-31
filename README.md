# 아바타튜터 (Avatar Tutor)

**카톡하는 외국인 친구.** 채팅이 메인이고, 통화는 그 친구와 가끔 하는 부가 기능이다.

화면은 셋뿐이다 — ① 채팅 목록(홈) ② 채팅방 ③ 마이페이지. 나머지는 시트로 뜬다.

## 이 앱이 다른 영어 앱과 다른 점

| | 흔한 AI 회화 앱 | 아바타튜터 |
|---|---|---|
| 응답 | 즉시 (봇 티가 난다) | **시간 텀을 둔다.** 짧은 리액션 3~8초, 일반 답변 10~25초, 긴 설명 25~45초. 친구가 자는 시간엔 다음 날 아침에 몰아서 답한다 |
| 한국어 입력 | "영어로 말해보세요" 재촉 | **지적하지 않는다.** 대화는 그대로 이어가고, 말풍선 아래 접힌 코칭 카드로 "영어로는 이렇게 말해요"를 붙인다 |
| 친구 | 고정 목록에서 선택 | **궁합으로 2명 배정.** 안 맞으면 나갈 수 있고, 이탈 사유가 궁합 모델을 갱신해 새 친구가 '친구의 소개'로 먼저 말을 건다 |
| 근황 | 매번 새로 지어냄 | **2~4주치 라이프 스케줄을 미리 생성.** 여행을 가면 그 기간 내내 그 도시 이야기가 이어지고 시차·응답 속도까지 바뀐다 |
| 목 모드 | 조용히 폴백 | **상시 배너로 알린다.** `/api/health`가 실제 호출로 키를 검증한다 |

## 디자인 시스템 — 노랑·블랙 토큰

**색은 `src/app/globals.css`의 토큰 블록에만 존재한다.** 컴포넌트 규칙과 Tailwind 유틸리티는 `var(--토큰)`만 쓰므로, 토큰 한 곳을 고치면 전 화면이 바뀐다. `npm run test:design`이 이 규칙을 강제한다 (토큰 밖 하드코딩 0건, 애플 블루 잔재 0건).

| 축 | 토큰 |
|---|---|
| 표면 | `--bg` `--surface` `--surface-alt` `--surface-raised` `--fill` `--fill-strong` `--line` `--overlay` |
| 텍스트 | `--ink` `--ink-secondary` `--ink-tertiary`(비활성 전용) |
| 브랜드 | `--yellow` `--yellow-deep` `--yellow-soft` `--on-yellow` `--on-yellow-soft` `--accent-text` |
| 상태 | `--success` `--danger` (+ `-soft` 배경) |
| 말풍선 | `--bubble-me-bg/text` `--bubble-you-bg/text` |
| 형태·여백 | `--radius-s/m/l/pill` `--shadow` `--pad`(20px) `--row-min`(72px) `--tap`(44px) |

적용 규칙:
- 포인트(노랑)는 **화면당 소수 지점에만** — 내 말풍선, 주요 액션, 안 읽은 배지, XP·스트릭, 진행 바.
- **노랑 위 텍스트·아이콘은 항상 블랙**(`--on-yellow`). `--ink`는 다크에서 밝아지므로 노랑 위에 쓰지 않는다.
- 흰 배경에서 노랑 글씨는 읽히지 않으므로, 강조 텍스트는 짙은 호박색 `--accent-text`를 쓴다.
- 그림자는 `--shadow` 한 종류. 비활성은 투명도가 아니라 `--ink-tertiary`로 표현한다.

### 테마
기본은 **라이트**. 설정 → 화면에서 라이트/다크/시스템을 고른다(`<html data-theme>` + localStorage, 첫 페인트 전 부트스트랩으로 깜빡임 없음).
**통화 화면만 테마와 무관하게 항상 어둡다** — 얼굴이 주인공이기 때문이다. 같은 토큰명을 어두운 값으로 다시 정의하는 스코프(`.surface-dark`, `.call-*`)라서 안쪽 규칙은 그대로 `var()`만 쓴다.

명암비는 실제 렌더된 색으로 검증했고(WCAG AA), 라이트·다크 양쪽에서 남은 미달은 비활성 컨트롤뿐이다(WCAG 예외).

## 핵심 아키텍처

대화 품질은 아바타 API 내장 기능에 맡기지 않는다. **두뇌(LLM)·귀(STT)·입(TTS)을 직접 연결한 자체 파이프라인** 위에, 아바타는 표시 레이어로만 얹는다.

```
[푸시투토크 녹음] → STT → 파이프라인(OpenAI/Claude: 페르소나+기억+교정+러닝엔진) → TTS → [아바타 레이어 L0~L2]
```

| 역할 | 기본 | 폴백 |
|---|---|---|
| 두뇌 (LLM) | OpenAI `gpt-5.6-terra` 또는 Anthropic Claude | 목(mock) LLM — 키 없이 전체 흐름 시연 |
| 귀 (STT) | OpenAI `gpt-4o-transcribe` | `whisper-1` 자동 폴백 → 키 없으면 목 |
| 입 (TTS) | OpenAI `gpt-4o-mini-tts` (튜터별 목소리) | ElevenLabs 어댑터 교체 가능 → 키 없으면 브라우저 speechSynthesis |
| 발음 평가 | Azure Pronunciation Assessment | STT 재인식 유사도 근사 채점 |
| 아바타 | L0 프로필+파형 (무료) | L1 루프 영상 → L2 실시간 API(Anam/Simli) |
| 사진 (친구 근황) | Unsplash → Pexels | `public/photos/` 로컬 샘플 (출처를 UI에 명시) |

### 비동기 채팅 파이프라인

```
[학습자 메시지] ─┬─→ runTurn (페르소나 + 라이프 컨텍스트 + 교정) ─→ 답장
                 └─→ buildCoachingCard (한국어일 때만)        ─→ 코칭 카드
                                   │
                       planDelivery (리듬·수면·여행) → deliveryQueue 예약
                                   │
                    /api/tick → flushDue → 채팅방 도착 + 웹 푸시
```

"지금 대화 중" 토글을 켜면 지연 큐를 건너뛰고 즉시 응답하며, 5분간 입력이 없으면 자동으로 꺼진다. 통화 중에는 지연 큐를 적용하지 않는다.

## 실행 방법

```bash
npm install
npm run dev -- -p 3001   # http://localhost:3001
```

같은 Wi-Fi의 휴대폰에서는 실행 로그의 `Network` 주소(예: `http://192.168.x.x:3001`)로 화면과 직접 입력 흐름을 확인할 수 있다. 다만 모바일 브라우저의 마이크·서비스워커·푸시는 **신뢰할 수 있는 HTTPS 주소**가 필요하므로, LAN HTTP 링크는 음성/PWA 실기용 배포 주소를 대신하지 않는다.

### 연결 상태 확인이 먼저다
목 모드를 숨기지 않는 것이 이 앱의 원칙이다. `/api/health`는 키가 "있는지"가 아니라 provider에 **실제 요청을 보내** 검증하고(5분 캐시), 대화 AI가 실연동이 아니면 앱 상단에 상시 배너가 뜬다.

```bash
npm run health     # tsx scripts/simulate.ts --health
```

```
⚠️  데모 모드 — 실제 대화가 아닙니다.
  ❌ 대화 AI (mock): missing-key — ANTHROPIC_API_KEY / OPENAI_API_KEY 가 모두 비어 있습니다.
  ➖ 사진 (local-samples): disabled — UNSPLASH/PEXELS 키가 없어 로컬 샘플 이미지를 사용합니다.
```

### 목(mock) 모드 — 키 없이 실행
`.env.local` 없이 실행하면 LLM/STT/TTS가 전부 시뮬레이션으로 동작한다.
UI 흐름·지연 큐·코칭 카드·궁합 엔진·러닝모드 단계 진행을 키 없이 확인할 수 있다. 자유로운 모든 문장에 대한 자연어 품질·실제 음성 인식 정확도·provider 지연은 키를 연결한 실연동 모드에서 별도로 검증해야 한다.

### 실연동 모드
```bash
cp .env.example .env.local   # 후 키 입력
```

| 키 | 발급처 | 용도 |
|---|---|---|
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys | OpenAI 튜터 대화 + STT + TTS + 선택적 Realtime |
| `ANTHROPIC_API_KEY` (선택) | https://console.anthropic.com/settings/keys | `LLM_PROVIDER=anthropic`일 때 튜터 대화 |
| `ELEVENLABS_API_KEY` (선택) | https://elevenlabs.io | TTS 교체 (`TTS_PROVIDER=elevenlabs`) |
| `AZURE_SPEECH_KEY` (선택) | https://portal.azure.com (Speech Service) | 음소 단위 발음 채점 |
| `VAPID_*` (선택) | `npx web-push generate-vapid-keys` | 예약 답장·능동 메시지의 PWA 푸시 알림 |
| `UNSPLASH_ACCESS_KEY` (선택) | https://unsplash.com/developers | 친구의 여행·일상 사진 (사진가 크레딧 표기 의무) |
| `PEXELS_API_KEY` (선택) | https://www.pexels.com/api/ | 사진 2순위 provider |
| `ANAM_API_KEY` / `SIMLI_API_KEY` (선택) | https://anam.ai / https://simli.com | L2 실시간 아바타 |

OpenAI 하나로 시작하려면 `.env.local`에 `LLM_PROVIDER=openai`, `OPENAI_API_KEY=발급받은_키`를 설정한다. 표준 키는 서버에서만 읽으며 브라우저로 반환하지 않는다. 이 설정만으로 현재 턴 파이프라인의 mock 두뇌가 OpenAI Responses API로 교체되고 STT/TTS도 실연동된다.

### Realtime 음성 연결 준비

브라우저·모바일용 `gpt-realtime-2.1` WebRTC 초기화 서버가 `POST /api/realtime/call?sessionId=...`에 준비되어 있다. `OPENAI_REALTIME_ENABLED=true`일 때만 열리고, 현재는 학습 진도·교정 저장을 우회하지 않도록 프리토킹 세션만 허용한다. 입력 전사는 `gpt-live-transcribe`, 튜터별 출력 음성은 서로 다른 Realtime voice로 설정된다. 실제 UI 전환은 API 키를 연결한 뒤 프리토킹 파일럿의 지연·중단·비용을 실기 검증하고 활성화한다.

## 아바타 레이어 전환 (L0 → L2)

`.env.local`의 `NEXT_PUBLIC_AVATAR_LAYER`로 전환한다. 상위 단계가 실패하면 자동으로 하위 단계로 폴백한다.

- **L0 (기본, 무료)** — 튜터 프로필 사진 + 말할 때 파형/입모양 애니메이션
- **L1 (무료)** — 사전 생성 루프 영상. `public/avatars/video/{tutorId}-idle.mp4`와 `{tutorId}-talk.mp4`를 넣으면 자동 감지된다 (예: `mia-idle.mp4`)
- **L2 (실시간 API)** — `AVATAR_L2_PROVIDER=anam|simli` + 해당 키 설정. 서버가 세션 토큰을 발급(`/api/avatar/session`, `src/core/avatar/l2.ts`)하며, 클라이언트 스트림 연결은 제공자 SDK(`@anam-ai/js-sdk` / `simli-client`)를 `AvatarView.tsx`의 표시된 통합 지점에 연결하면 완성된다. SDK 미연결/실패 시 L1→L0 폴백.

## 외부 검증 구조 (리뷰어용)

앱 실행 없이 repo만으로 대화 품질을 검증·개선할 수 있다.

1. **프롬프트 분리** — 모든 시스템 프롬프트는 [`prompts/*.md`](prompts/) 개별 파일. 파일만 고치면 동작이 바뀐다.
   - `tutor-base.md` 공통 규칙·JSON 출력 계약 / `correction-engine.md` 2트랙 교정(한국인 오류 패턴) / `learning-conductor.md` 러닝모드 단계 진행 / `freetalk.md`·`chat-mode.md`·`scenario-block.md` 모드별
   - 재기획으로 추가된 것: `coaching-card.md` 한국어 입력 코칭 / `life-schedule.md`·`life-post.md` 친구의 일상·여행 / `friend-intro.md` 새 친구의 첫 메시지
2. **CLI 시뮬레이터** — STT를 건너뛰고 텍스트 발화로 파이프라인을 실행:
   ```bash
   npx tsx scripts/simulate.ts --mode freetalk --tutor mia --say "I am agree with you" --say "Yesterday I go to Busan"
   npx tsx scripts/simulate.ts --mode learning --tutor oliver --unit unit-01 --file utterances.json
   ```
   튜터 응답·교정 카드·따라말하기 판정·단계 진행·토큰 사용량을 JSON으로 출력한다.
   기본적으로 임시 스토어로 격리되며(`--persist`로 해제), 직전 턴에 suggestion 카드가 있으면 다음 발화를 따라 말하기 시도로 판정한다.

   진단 모드는 세션을 만들지 않고 바로 끝난다:
   ```bash
   npm run health                                  # provider 연결을 실제 호출로 검증
   npm run matching                                # 프로필 → 친구 궁합 순위 + 이탈 시 재계산
   npx tsx scripts/simulate.ts --matching --profile '{"ageBand":"30s","occupation":"office","interests":["coffee","books","outdoors"],"goal":"work","style":"calm"}'
   ```
3. **모듈 단독 테스트** — 지연 큐·궁합 엔진·코칭 카드·라이프 스케줄은 서버 라우트 없이 import만으로 검증된다.
   ```bash
   npm run test:async     # regression-async-chat.ts + regression-chat-flow.ts
   npm run test:all       # 전체 회귀
   ```
4. **세션 로그** — 모든 세션은 종료 시 `logs/session-*.json`으로 내보낸다 (발화·튜터 응답·교정 카드·점수·사용 토큰 포함). `logs/`는 gitignore.

## 주요 기능 지도

| 기능 | 코드 |
|---|---|
| 푸시투토크 (슬라이드 취소, 말 끊기) | `src/components/PushToTalkButton.tsx`, `src/hooks/useRecorder.ts` |
| 턴 파이프라인 | `src/core/pipeline/turn.ts` (+`systemPrompt.ts`, `parse.ts`) |
| 러닝모드 단계 엔진 (복습→소개→연습→롤플레이) | `src/core/learning/engine.ts` |
| 간격 반복 복습 큐 (당일→3일→7일) | `src/core/srs.ts` |
| 튜터 장기기억 | `src/core/memory.ts` |
| 친밀도·XP·스트릭 | `src/core/gamification.ts` |
| 능동 메시지 (아침/퀴즈/근황/보고싶다/근황 사진) | `src/core/proactive.ts` |
| 비동기 응답 지연 계산 (리듬·수면·여행) | `src/core/rhythm.ts` |
| 예약 발송 큐 (도착·입력 중 표시·푸시) | `src/core/deliveryQueue.ts` |
| 한국어 입력 코칭 카드 | `src/core/coaching.ts`, `prompts/coaching-card.md` |
| 친구 궁합 엔진 (프로필 + 행동 신호) | `src/core/matching.ts` |
| 친구 관계·이탈·재유입 | `src/core/friends.ts` |
| 라이프 스케줄 (2~4주 여행·일상) | `src/core/life.ts`, `src/core/photos.ts` |
| 학습자 사진 인식 | `src/core/vision.ts` |
| 음성 메시지 (파형·스크립트) | `src/core/voiceNote.ts` |
| 상황극 브리핑·이탈 복구 | `src/core/roleplay.ts` |
| 연결 상태 실호출 검증 | `src/core/health.ts` → `/api/health` |
| 교정·표현 제안 | `prompts/correction-engine.md` |
| 점진적 수준 추정·난이도·음성 속도 조절 | `src/core/levelAdaptation.ts`, `prompts/level-adaptation.md` |
| 발음 평가 (Azure→유사도 폴백) | `src/core/pronunciation.ts` |
| 사용량·원가 추정 | `src/core/usage.ts` → `/admin` |
| PWA (설치·푸시) | `public/manifest.webmanifest`, `public/sw.js` |
| 카카오톡 공유·채널·AI 챗봇 스킬 | `src/lib/kakao.ts`, `src/app/api/kakao/skill/route.ts` |

주요 회귀는 `npm run test:all` 하나로 실행한다 (`test:conversation`, `test:systems`, `test:async`, `test:recorder`, `test:ui-recovery`, `test:progress`, `test:design`).

## 카카오톡 연동

앱의 카카오 버튼은 설정 상태에 따라 단계적으로 동작한다.

1. 키 없음: 모바일 OS 공유 시트를 열고, 지원하지 않는 환경에서는 대화 내용을 클립보드에 복사한다.
2. `NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY` 설정: Kakao JavaScript SDK의 카카오톡 공유를 사용한다.
3. `NEXT_PUBLIC_KAKAO_CHANNEL_ID`까지 설정: 카카오톡 채널의 **새** 1:1 채팅방을 연다. 앱 안의 비공개 대화 기록이나 세션은 넘기지 않는다.
4. 챗봇 관리자센터에서 튜터별 블록에 공개 배포된 `POST /api/kakao/skill?tutor=mia`를 스킬 URL로 등록하면 카카오톡 안에서도 같은 튜터 파이프라인이 새 대화로 답한다. `tutor=`에는 `data/personas.json`의 8명(`mia`, `emma`, `noah`, `oliver`, `chloe`, `jack`, `daniel`, `sophie`) 모두 쓸 수 있다. 하나의 진입 블록을 쓴다면 먼저 원하는 친구를 묻는 블록을 구성한다.
   - 한국어로 메시지를 보내면 앱과 동일한 **코칭 카드가 카카오 `itemCard`로 매핑**되어 함께 온다 (자연스럽게 / 편하게 / 정중하게 + "따라 써보기" 버튼).
   - 카카오 채널 대화는 앱의 로컬 프로필·기억·XP와 완전히 격리된다(`prompts/external-conversation.md`). 지연 큐도 적용하지 않고 즉시 응답한다.
5. 생성형 AI 응답이 5초를 넘을 수 있으므로 운영 봇은 AI 챗봇 콜백 권한을 신청하고 해당 블록에서 콜백을 켜는 것을 권장한다. 요청에 `callbackUrl`이 오면 이 엔드포인트는 즉시 `useCallback: true`를 반환하고 완성된 답변을 1회성 Kakao HTTPS URL로 전달한다.

카카오디벨로퍼스에서 JavaScript SDK 도메인과 제품 링크 도메인을 실제 배포 도메인으로 등록해야 한다. 운영 배포에서는 `KAKAO_SKILL_SECRET`이 필수이며, 챗봇 관리자센터의 스킬 헤더에 `x-avatar-tutor-secret: 동일값`을 등록한다(`x-api-key`도 지원). 카카오 챗봇 스킬 서버는 외부에서 접근 가능한 HTTPS 주소여야 하므로 로컬 주소는 등록할 수 없다.

현재 웹 앱은 로컬 JSON을 쓰는 개인용 단일 사용자 구조다. 공개 배포 시 `APP_BASIC_USER`와 강한 `APP_BASIC_PASSWORD`를 반드시 설정해야 하며, 둘 중 하나라도 빠진 운영 서버는 웹 화면과 일반 API를 503으로 차단한다. 카카오 스킬 경로만 별도의 `KAKAO_SKILL_SECRET`으로 인증한다. Basic 인증은 반드시 HTTPS 뒤에서 사용하고, 같은 계정을 여러 사람이 공유하면 앱 상태도 공유된다는 점에 유의한다.

대화 기록 저장소는 로컬 JSON이므로 단일 영속 Node 인스턴스에서만 카카오 대화 맥락이 안정적으로 이어진다. 서버리스·다중 인스턴스 또는 다중 사용자 운영 전에는 `src/core/store.ts`를 사용자별 공유 DB/KV로 교체하고 conversation 단위 트랜잭션을 적용해야 한다.

## 데이터

- 튜터 페르소나 **8명**: [`data/personas.json`](data/personas.json) — 추가/수정만으로 친구가 늘어난다.
  각 페르소나는 궁합용 `tags`(연령대·국가·직업·성향·템포·관심사·목적), 생활 `rhythm`(타임존·기상/취침·응답 템포), `life`(사는 도시·일상 소재·여행지·사진 키워드)를 가진다.
- 회화 수준 1~5의 11유닛(표현 55개): [`data/units.json`](data/units.json)
- 시나리오 8종(전부 잠금 해제, 브리핑용 핵심 표현 3개 포함): [`data/scenarios.json`](data/scenarios.json)
- 런타임 상태(JSON, gitignore): `data/store/` — 사용자·프로필·친구 관계·채팅·예약 큐·라이프 스케줄·세션·SRS·기억·사용량

### 학습 데이터는 친구가 아니라 계정에 귀속된다
레벨·복습 큐(SRS)·틀린 표현 이력·XP는 친구가 바뀌어도 유지된다. 친구에는 관계 기억(근황·농담·친밀도)만 붙는다.
새 친구는 학습 이력을 이어받아 가르치되, 개인적 근황은 처음부터 알아간다.

## 폴백 동작 정리

- LLM 키 없음 → 목 LLM (흐름 시연용)
- STT 키 없음 → 목 전사 / `gpt-4o-transcribe` 실패 → `whisper-1`
- TTS 키 없음·실패 → 브라우저 speechSynthesis
- Azure 키 없음·실패 → 유사도 근사 채점
- L2/L1 아바타 실패 → L0
- 사진 키 없음·실패 → `public/photos/` 로컬 샘플 (UI에 "샘플 이미지"로 명시)
- 비전(사진 인식) 불가 → 튜터가 "뭐가 찍힌 거야?"로 자연스럽게 되묻고 토스트로 알림
- VAPID 키 없음 → 푸시 스킵 (앱을 열어 두면 폴링으로 도착)
- 시나리오 환경음 파일 없음 → 무음 진행
- 턴 전송 실패 → 재시도 버튼 (녹음 유지, 대화 로그 유실 없음)
