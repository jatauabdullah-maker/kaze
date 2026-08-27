const APP_URL = chrome.runtime.getURL('src/index.html');

async function openApp() {
  const tabs = await chrome.tabs.query({ url: APP_URL });
  if (tabs.length) {
    const t = tabs[0];
    await chrome.tabs.update(t.id, { active: true });
    if (t.windowId !== undefined) await chrome.windows.update(t.windowId, { focused: true }).catch(() => undefined);
    return;
  }
  await chrome.tabs.create({ url: APP_URL });
}

chrome.action.onClicked.addListener(openApp);
chrome.runtime.onInstalled.addListener(() => openApp().catch(() => undefined));

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'PING') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
  }
  return false;
});
