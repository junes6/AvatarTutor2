// 웹 푸시 (PWA) — VAPID 키가 없으면 조용히 스킵 (인앱 알림만 동작)

import webpush from "web-push";
import { readJSON, writeJSON } from "./store";
import { config } from "./config";

interface PushStore {
  subscriptions: webpush.PushSubscription[];
}

const MAX_SUBSCRIPTIONS = 20;

let configured = false;
function ensureConfigured(): boolean {
  if (!config.push.publicKey || !config.push.privateKey) return false;
  if (!configured) {
    webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);
    configured = true;
  }
  return true;
}

export function addSubscription(sub: webpush.PushSubscription) {
  const store = readJSON<PushStore>("push", { subscriptions: [] });
  const existing = store.subscriptions.findIndex((s) => s.endpoint === sub.endpoint);
  if (existing >= 0) {
    // 브라우저가 키를 갱신한 경우 기존 endpoint 항목을 최신 값으로 교체한다.
    store.subscriptions[existing] = sub;
    writeJSON("push", store);
  } else {
    store.subscriptions.push(sub);
    if (store.subscriptions.length > MAX_SUBSCRIPTIONS) {
      store.subscriptions = store.subscriptions.slice(-MAX_SUBSCRIPTIONS);
    }
    writeJSON("push", store);
  }
}

export async function sendPush(title: string, body: string, url = "/", tag?: string) {
  if (!ensureConfigured()) return;
  const store = readJSON<PushStore>("push", { subscriptions: [] });
  // tag가 같으면 기기 알림이 하나로 합쳐진다 — 예약 답장이 몰려도 알림이 쌓이지 않는다.
  const payload = JSON.stringify({ title, body, url, tag: tag ?? url });
  const alive: webpush.PushSubscription[] = [];
  for (const sub of store.subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
      alive.push(sub);
    } catch {
      // 만료된 구독은 제거
    }
  }
  if (alive.length !== store.subscriptions.length) {
    writeJSON("push", { subscriptions: alive });
  }
}
