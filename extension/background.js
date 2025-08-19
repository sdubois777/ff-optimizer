// MV3 service worker: forwards events to backend & blips badge
const BACKEND = "http://127.0.0.1:5001";
const DRAFT_ENDPOINT = BACKEND + "/draft-event";

self.addEventListener("install", () => {
  console.log("[ffo] service worker installed");
  self.skipWaiting?.();
});

self.addEventListener("activate", () => {
  console.log("[ffo] service worker activated");
});

function blip() {
  try {
    chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" });
    chrome.action.setBadgeText({ text: "•" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 400);
  } catch {}
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "draft_event") return;
  blip();
  fetch(DRAFT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(msg.payload || {})
  }).catch(() => {});
});
