export const DEFAULT_MEDIA_REQUEST_TIMEOUT_MS = 12_000;

export class MediaRequestTimeoutError extends Error {
  constructor() {
    super("Microphone permission request timed out");
    this.name = "MediaRequestTimeoutError";
  }
}

export class MediaRequestCancelledError extends Error {
  constructor() {
    super("Microphone permission request was cancelled");
    this.name = "MediaRequestCancelledError";
  }
}

interface MediaRequestOptions {
  signal: AbortSignal;
  timeoutMs?: number;
}

function stopStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}

/**
 * getUserMedia 자체는 AbortSignal을 받지 않는다. 호출자를 먼저 해제한 뒤 권한
 * 창이 늦게 승인되더라도 새 MediaStream의 트랙이 남지 않도록 이 경계에서 정리한다.
 */
export async function awaitMediaStreamRequest(
  request: Promise<MediaStream>,
  { signal, timeoutMs = DEFAULT_MEDIA_REQUEST_TIMEOUT_MS }: MediaRequestOptions,
): Promise<MediaStream> {
  let accepted = false;
  let abandoned = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener = () => {};

  const guardedRequest = request.then((stream) => {
    if (abandoned || signal.aborted) {
      stopStream(stream);
      throw new MediaRequestCancelledError();
    }
    return stream;
  });

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new MediaRequestTimeoutError()), timeoutMs);
  });

  const cancellation = new Promise<never>((_, reject) => {
    const onAbort = () => reject(new MediaRequestCancelledError());
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", onAbort);
  });

  try {
    const stream = await Promise.race([guardedRequest, timeout, cancellation]);
    accepted = true;
    return stream;
  } finally {
    abandoned = !accepted;
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    removeAbortListener();
  }
}
