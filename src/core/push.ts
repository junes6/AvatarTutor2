// 웹 푸시 (PWA) — VAPID 키가 없으면 조용히 스킵 (인앱 알림만 동작)

import webpush from "web-push";
import { readJSON, writeJSON } from "./store";
import { config } from "./config";

interface PushStore {
  subscriptions: webpush.PushSubscription[];
}

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
  if (!store.subscriptions.some((s) => s.endpoint === sub.endpoint)) {
    store.subscriptions.push(sub);
    writeJSON("push", store);
  }
}

export async function sendPush(title: string, body: string, url = "/") {
  if (!ensureConfigured()) return;
  const store = readJSON<PushStore>("push", { subscriptions: [] });
  const payload = JSON.stringify({ title, body, url });
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
