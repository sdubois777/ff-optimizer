// Chrome/Edge MV3 background (service worker). Receives messages from content.js and POSTs to your Flask backend.

const BACKEND_URL = "http://127.0.0.1:5001/draft-event";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "draft_event") return;

  // Post to backend; keep the message channel open for async
  fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(msg.payload || {})
  })
    .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(() => sendResponse({ ok: true }))
    .catch((e) => {
      console.error("[draft-event] post failed:", e);
      sendResponse({ ok: false, error: String(e) });
    });

  return true; // important: keeps the channel open for async sendResponse
});
