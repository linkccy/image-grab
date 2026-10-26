/**
 * 图提取 · background service worker
 *
 * content script 扫完图之后把列表发过来，这里只做两件事：
 *   1. 把列表暂存到 storage.session（画廊页自己去读）
 *   2. 打开画廊页标签
 *
 * 用 session 而不是 local，是因为这些数据关掉浏览器就没意义了，
 * 而且图片列表可能挺大，没必要长期落盘。
 */

const STORAGE_KEY = 'igrab:last';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'igrab:open') {
    const payload = {
      images: msg.images || [],
      pageTitle: msg.pageTitle || '',
      pageUrl: msg.pageUrl || '',
      tabId: sender.tab ? sender.tab.id : null,
      savedAt: Date.now(),
    };

    chrome.storage.session
      .set({ [STORAGE_KEY]: payload })
      .then(() => {
        const url = chrome.runtime.getURL('gallery.html?from=content');
        return chrome.tabs.create({ url });
      })
      .then(() => {
        // 图标上闪一下数量，用户切回商品页时也能看到结果
        try {
          chrome.action.setBadgeText({ text: String(payload.images.length) });
          chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
          setTimeout(() => chrome.action.setBadgeText({ text: '' }), 6000);
        } catch {
          /* 徽标失败不影响主流程 */
        }
        sendResponse({ ok: true });
      })
      .catch((err) => {
        console.error('[图提取] 打开画廊失败', err);
        sendResponse({ ok: false, error: String(err) });
      });

    return true; // 异步响应
  }

  if (msg && msg.type === 'igrab:get-last') {
    chrome.storage.session
      .get(STORAGE_KEY)
      .then((data) => sendResponse({ ok: true, payload: data[STORAGE_KEY] || null }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  return false;
});

// 点扩展图标时，没有现成列表就打开画廊页的空状态引导
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('gallery.html?from=icon') });
});
