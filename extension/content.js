/**
 * 图提取 · content script
 *
 * 职责只有两件事：
 *   1. 在页面右下角放一个「获取图片」按钮
 *   2. 点击后把页面里所有够大的商品图扫出来，交给后台去开画廊页
 *
 * 之所以把扫描放在页面里做，是因为只有这里能拿到 naturalWidth、
 * 懒加载的 data-src，以及 CSS 里的 background-image。
 */

(() => {
  if (window.__igrabInjected) return;
  window.__igrabInjected = true;

  const MIN_SIZE = 100;          // 小于 100×100 的一律当图标
  const MAX_IMAGES = 300;        // 单页最多收 300 张，防止极端页面卡死
  const MEASURE_TIMEOUT = 4000;  // 单张图测尺寸的超时

  // 明显的装饰图，URL 里带这些词的直接跳过
  const JUNK_WORDS = [
    'logo', 'icon', 'sprite', 'avatar', 'blank', 'placeholder',
    'loading', 'spacer', 'pixel', '1x1', 'transparent',
  ];

  const LAZY_ATTRS = [
    'data-src', 'data-lazy-src', 'data-original', 'data-ks-lazyload',
    'data-lazyload', 'data-actualsrc', 'data-echo', 'data-url',
  ];

  /* ---------------- 工具函数 ---------------- */

  function absolute(url) {
    if (!url) return '';
    const t = url.trim();
    if (!t || t.startsWith('data:') || t.startsWith('blob:')) return '';
    try {
      return new URL(t, location.href).href;
    } catch {
      return '';
    }
  }

  function isJunk(url) {
    const low = url.toLowerCase();
    return JUNK_WORDS.some((w) => low.includes(w));
  }

  /** 从 srcset 里挑最大的那张 */
  function pickFromSrcset(srcset) {
    if (!srcset) return '';
    const parts = srcset.split(',').map((s) => s.trim()).filter(Boolean);
    let best = '';
    let bestW = -1;
    for (const part of parts) {
      const [url, descriptor] = part.split(/\s+/);
      const w = descriptor && descriptor.endsWith('w')
        ? parseInt(descriptor, 10)
        : (descriptor && descriptor.endsWith('x') ? parseFloat(descriptor) * 1000 : 0);
      if (url && w >= bestW) {
        bestW = w;
        best = url;
      }
    }
    return best;
  }

  /** 给还没加载完的图量一下真实尺寸 */
  function measure(url) {
    return new Promise((resolve) => {
      const probe = new Image();
      let done = false;
      const finish = (w, h) => {
        if (done) return;
        done = true;
        probe.onload = probe.onerror = null;
        resolve({ w: w || 0, h: h || 0 });
      };
      probe.onload = () => finish(probe.naturalWidth, probe.naturalHeight);
      probe.onerror = () => finish(0, 0);
      setTimeout(() => finish(0, 0), MEASURE_TIMEOUT);
      probe.src = url;
    });
  }

  /* ---------------- 扫描 ---------------- */

  async function collectImages() {
    /** @type {Map<string, {url:string, w:number, h:number}>} */
    const found = new Map();

    const add = (rawUrl, w = 0, h = 0) => {
      const url = absolute(rawUrl);
      if (!url || isJunk(url)) return;
      if (found.size >= MAX_IMAGES && !found.has(url)) return;
      const old = found.get(url);
      if (old) {
        // 同一张图可能先以 0×0 被发现，后面拿到了真实尺寸就更新
        if (w > old.w) { old.w = w; old.h = h; }
      } else {
        found.set(url, { url, w, h });
      }
    };

    // 1) <img>：优先 currentSrc（浏览器已经选好的那张），再退到 src 和懒加载属性
    for (const img of document.querySelectorAll('img')) {
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (img.currentSrc) add(img.currentSrc, w, h);
      if (img.src) add(img.src, w, h);
      for (const attr of LAZY_ATTRS) {
        const v = img.getAttribute(attr);
        if (v) add(v);
      }
      const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
      const best = pickFromSrcset(srcset);
      if (best) add(best);
    }

    // 2) 背景图：只扫有背景图的元素，取算出来的样式
    for (const el of document.querySelectorAll('body *')) {
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg || bg === 'none' || !bg.includes('url(')) continue;
      const m = bg.match(/url\((['"]?)(.*?)\1\)/);
      if (!m) continue;
      const rect = el.getBoundingClientRect();
      add(m[2], Math.round(rect.width), Math.round(rect.height));
    }

    // 3) 尺寸未知的补测一遍，同时顺手把太小的剔掉
    const items = [...found.values()];
    await Promise.all(
      items.map(async (it) => {
        if (it.w >= MIN_SIZE && it.h >= MIN_SIZE) return;
        if (it.w > 0 && it.h > 0 && (it.w < MIN_SIZE || it.h < MIN_SIZE)) return; // 已经知道太小
        const size = await measure(it.url);
        it.w = size.w || it.w;
        it.h = size.h || it.h;
      })
    );

    const usable = items.filter((it) => {
      // 边缘情况：图挂了或者超小占位，宽高可能还是 0，这时按「无法确认」保留
      if (!it.w || !it.h) return false;
      return it.w >= MIN_SIZE && it.h >= MIN_SIZE;
    });

    // 大图排前面，找主图时更顺手
    usable.sort((a, b) => b.w * b.h - a.w * a.h);
    return usable;
  }

  /* ---------------- 交互 ---------------- */

  function toast(text) {
    let box = document.getElementById('igrab-toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'igrab-toast';
      document.documentElement.appendChild(box);
    }
    box.textContent = text;
    box.classList.add('igrab-show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => box.classList.remove('igrab-show'), 2600);
  }

  async function handleClick(btn) {
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="igrab-ico">⏳</span>正在提取…';

    try {
      // 先把页面滚到底再滚回来，触发懒加载（很多详情页图片不滚不加载）
      const y = window.scrollY;
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 900));
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 400));

      const images = await collectImages();
      if (!images.length) {
        toast('没有找到 100×100 以上的图片，试试先手动滚一遍页面');
        return;
      }

      toast(`找到 ${images.length} 张图，正在打开预览页…`);
      chrome.runtime.sendMessage({
        type: 'igrab:open',
        images,
        pageTitle: document.title,
        pageUrl: location.href,
      });
    } catch (err) {
      console.error('[图提取] 提取失败', err);
      toast('提取出错了：' + (err && err.message ? err.message : '未知错误'));
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  function mountButton() {
    if (document.getElementById('igrab-btn')) return;
    if (!document.body) return;

    const btn = document.createElement('button');
    btn.id = 'igrab-btn';
    btn.type = 'button';
    btn.innerHTML = '<span class="igrab-ico">🖼</span>获取图片';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleClick(btn);
    });
    document.body.appendChild(btn);
  }

  mountButton();
  // 有些页面会整页重绘，按钮被冲掉就补回来
  const observer = new MutationObserver(() => {
    if (!document.getElementById('igrab-btn')) mountButton();
  });
  observer.observe(document.documentElement, { childList: true, subtree: false });
})();
