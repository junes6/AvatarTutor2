// 아바타튜터 서비스워커 — 미디어 에셋 캐시 + 푸시 알림
// 주의: JS/CSS/_next 개발 파일은 절대 캐시하지 않는다 (개발 서버 재시작 시 빈 화면 방지)

const CACHE = "avatar-tutor-v4";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // 이전 버전 캐시 전부 제거 (v1의 잘못된 JS 캐시 정리)
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // API·Next 내부 파일·비GET 요청은 서비스워커가 건드리지 않는다
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/")) return;

  // 미디어 에셋만 캐시 우선 (아바타·장면·환경음·아이콘)
  const isMedia = /\.(svg|png|jpg|wav|mp3|mp4|woff2?|ico)$/.test(url.pathname);
  if (isMedia) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((res) => {
            if (!res.ok) return res;
            const copy = res.clone();
            return caches
              .open(CACHE)
              .then((cache) => cache.put(event.request, copy))
              .catch(() => undefined)
              .then(() => res);
          }),
      ),
    );
    return;
  }

  // 페이지: 항상 네트워크. 서버가 꺼져 있으면 명확한 안내 화면을 보여준다
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(
          `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>아바타튜터 — 오프라인</title>
<body style="margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;background:#060a13;color:#f1f5f9;font-family:sans-serif;text-align:center">
<div><div style="font-size:56px">🔌</div>
<h1 style="font-size:20px;margin:16px 0 8px">인터넷 연결을 확인해 주세요</h1>
<p style="font-size:14px;color:#94a3b8;line-height:1.7">현재 아바타튜터에 연결할 수 없어요.<br>Wi-Fi 또는 모바일 데이터를 확인한 뒤 다시 시도해 주세요.</p>
<button onclick="location.reload()" style="margin-top:20px;padding:12px 28px;border:0;border-radius:12px;background:#059669;color:#fff;font-size:15px;font-weight:bold;cursor:pointer">다시 시도</button>
</div></body></html>`,
          { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
        ),
    ),
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "아바타튜터", body: "새 메시지가 도착했어요!", url: "/", tag: "avatar-tutor" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // 같은 친구의 알림은 하나로 합치고, 새 메시지가 오면 다시 알린다.
      tag: data.tag,
      renotify: true,
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    }),
  );
});
