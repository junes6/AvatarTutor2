/**
 * Web Speech API 결과를 화면에 표시하기 좋은 형태로 누적한다.
 *
 * 브라우저는 같은 interim resultIndex를 여러 번 고쳐 보내고, 긴 녹음에서는
 * SpeechRecognition 세션을 종료한 뒤 다시 시작하기도 한다. 이 모듈은 React나
 * DOM에 의존하지 않고 그 두 경우 모두에서 중복 없는 자막을 만든다.
 */

export interface SpeechTranscriptAlternativeLike {
  transcript?: string;
  confidence?: number;
}

export interface SpeechTranscriptResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechTranscriptAlternativeLike;
}

export interface SpeechTranscriptResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechTranscriptResultLike;
}

export interface SpeechTranscriptEventLike {
  readonly resultIndex: number;
  readonly results: SpeechTranscriptResultListLike;
}

export interface FinalTranscriptSegment {
  text: string;
  confidence: number;
}

export interface LiveTranscriptBuffer {
  finalSegments: Map<number, FinalTranscriptSegment>;
  interimSegments: Map<number, string>;
}

export interface LiveTranscriptSnapshot {
  finalTranscript: string;
  interimTranscript: string;
  liveTranscript: string;
  confidence?: number;
}

export function normalizeLiveTranscript(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function createLiveTranscriptBuffer(): LiveTranscriptBuffer {
  return {
    finalSegments: new Map(),
    interimSegments: new Map(),
  };
}

export function resetLiveTranscriptBuffer(buffer: LiveTranscriptBuffer): void {
  buffer.finalSegments.clear();
  buffer.interimSegments.clear();
}

/**
 * 한 SpeechRecognition 세션의 변경분을 반영한다.
 * `resultIndex` 이후의 interim 결과는 브라우저가 교체할 수 있으므로 먼저
 * 제거한 뒤 현재 result list로 다시 구성해야 오래된 단어가 남지 않는다.
 */
export function applySpeechTranscriptEvent(
  buffer: LiveTranscriptBuffer,
  event: SpeechTranscriptEventLike,
  sessionOffset = 0,
): LiveTranscriptSnapshot {
  const changedFrom = sessionOffset + Math.max(0, event.resultIndex);

  for (const index of buffer.interimSegments.keys()) {
    if (index >= changedFrom) buffer.interimSegments.delete(index);
  }
  for (const index of buffer.finalSegments.keys()) {
    if (index >= changedFrom) buffer.finalSegments.delete(index);
  }

  for (let index = Math.max(0, event.resultIndex); index < event.results.length; index += 1) {
    const result = event.results[index];
    const segmentIndex = sessionOffset + index;
    const alternative = result?.[0];
    const text = normalizeLiveTranscript(alternative?.transcript ?? "");

    if (!text) {
      buffer.interimSegments.delete(segmentIndex);
      if (!result?.isFinal) buffer.finalSegments.delete(segmentIndex);
      continue;
    }

    if (result.isFinal) {
      buffer.finalSegments.set(segmentIndex, {
        text,
        confidence: Number.isFinite(alternative?.confidence) ? Math.max(0, alternative?.confidence ?? 0) : 0,
      });
      buffer.interimSegments.delete(segmentIndex);
    } else {
      buffer.finalSegments.delete(segmentIndex);
      buffer.interimSegments.set(segmentIndex, text);
    }
  }

  return getLiveTranscriptSnapshot(buffer);
}

/**
 * 브라우저가 긴 발화 중 인식 세션을 자동 종료한 경우 마지막 interim을 보존한다.
 * 다음 세션에는 새 offset을 사용하므로 같은 문장이 두 번 표시되지 않는다.
 */
export function commitInterimTranscript(buffer: LiveTranscriptBuffer): LiveTranscriptSnapshot {
  for (const [index, text] of buffer.interimSegments) {
    if (text) buffer.finalSegments.set(index, { text, confidence: 0 });
  }
  buffer.interimSegments.clear();
  return getLiveTranscriptSnapshot(buffer);
}

export function getNextTranscriptSessionOffset(buffer: LiveTranscriptBuffer): number {
  const indexes = [...buffer.finalSegments.keys(), ...buffer.interimSegments.keys()];
  return indexes.length ? Math.max(...indexes) + 1 : 0;
}

export function getLiveTranscriptSnapshot(buffer: LiveTranscriptBuffer): LiveTranscriptSnapshot {
  const finalSegments = [...buffer.finalSegments.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, segment]) => segment);
  const interimSegments = [...buffer.interimSegments.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, text]) => text);
  const finalTranscript = normalizeLiveTranscript(finalSegments.map((segment) => segment.text).join(" "));
  const interimTranscript = normalizeLiveTranscript(interimSegments.join(" "));
  const confidenceValues = finalSegments
    .map((segment) => segment.confidence)
    .filter((confidence) => confidence > 0);

  return {
    finalTranscript,
    interimTranscript,
    liveTranscript: normalizeLiveTranscript(`${finalTranscript} ${interimTranscript}`),
    confidence: confidenceValues.length
      ? confidenceValues.reduce((sum, confidence) => sum + confidence, 0) / confidenceValues.length
      : undefined,
  };
}

/** `no-speech`만 새 세션으로 복구한다. 권한/네트워크/캡처 실패는 녹음은 유지하고 서버 STT로 폴백한다. */
export function canRestartSpeechRecognitionAfterError(error: string): boolean {
  return error === "no-speech";
}
