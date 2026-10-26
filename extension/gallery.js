/**
 * 图提取 · gallery page
 *
 * 负责：展示缩略图、勾选、把选中的图统一转成 PNG 再交给 chrome.downloads 下载。
 *
 * 下载流程有个绕不开的问题：不同电商的图片 CDN 对跨域限制不一样，
 * 有些能 fetch 到二进制（就能转 PNG），有些不行（只能退回到原图直链下载）。
 * 所以这里做了两条路，失败会自动降级，并在界面里如实告诉用户。
 */

const MIN_INDEX = 3; // 商品图_001.png 这种补零位数

const state = {
  images: [],
  selected: new Set(),
  downloading: false,
};

const $ = (id) => document.getElementById(id);

/* ---------------- 数据来源 ---------------- */

function isDemo() {
  return new URL(location.href).searchParams.get('demo') === '1';
}

/** 演示用的 8 张图：本地 canvas 画出来，不依赖网络 */
function buildDemoImages() {
  const colors = [
    ['#6366f1', '#8b5cf6'], ['#f59e0b', '#ef4444'], ['#10b981', '#0284c7'],
    ['#ec4899', '#8b5cf6'], ['#0ea5e9', '#6366f1'], ['#f97316', '#eab308'],
    ['#14b8a6', '#22c55e'], ['#a855f7', '#ec4899'],
  ];
  return colors.map((pair, i) => {
    const size = [800, 800][0];
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, pair[0]);
    g.addColorStop(1, pair[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 120px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), size / 2, size / 2);
    return {
      url: canvas.toDataURL('image/png'),
      w: size,
      h: size,
    };
  });
}

async function loadImages() {
  // 直接用浏览器打开 gallery.html 时没有 chrome.runtime，落回演示数据，方便单独看界面
  const hasRuntime = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage;
  if (isDemo() || !hasRuntime) {
    return {
      images: buildDemoImages(),
      pageTitle: '演示数据 · 图提取',
      pageUrl: '#',
    };
  }
  const res = await chrome.runtime.sendMessage({ type: 'igrab:get-last' });
  if (res && res.ok && res.payload) return res.payload;
  return null;
}

/* ---------------- 渲染 ---------------- */

function extOf(url) {
  const clean = url.split('?')[0].split('#')[0];
  const m = clean.match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : 'jpg';
}

function render() {
  const grid = $('grid');
  const empty = $('empty');
  grid.innerHTML = '';

  if (!state.images.length) {
    empty.hidden = false;
    $('total').textContent = '0';
    $('count').textContent = '0';
    $('btn-download').disabled = true;
    return;
  }
  empty.hidden = true;

  state.images.forEach((img, i) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.index = String(i);

    const thumb = document.createElement('img');
    thumb.className = 'card-thumb';
    thumb.loading = 'lazy';
    thumb.alt = `第 ${i + 1} 张`;
    thumb.src = img.url;
    thumb.addEventListener('error', () => {
      thumb.replaceWith(Object.assign(document.createElement('div'), {
        className: 'card-thumb card-broken',
        textContent: '图片加载失败',
      }));
    });

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    meta.innerHTML =
      `<span class="card-index">#${String(i + 1).padStart(MIN_INDEX, '0')}</span>` +
      `<span>${img.w}×${img.h}</span>`;

    const check = document.createElement('span');
    check.className = 'card-check';
    check.textContent = '✓';

    card.append(thumb, meta, check);
    card.addEventListener('click', () => toggle(i));
    grid.appendChild(card);
  });

  $('total').textContent = String(state.images.length);
  syncSelection();
}

function syncSelection() {
  $('count').textContent = String(state.selected.size);
  const disabled = state.selected.size === 0 || state.downloading;
  $('btn-download').disabled = disabled;
  $('btn-zip').disabled = disabled;
  document.querySelectorAll('.card').forEach((card) => {
    const i = Number(card.dataset.index);
    card.classList.toggle('selected', state.selected.has(i));
  });
}

function toggle(i) {
  if (state.selected.has(i)) state.selected.delete(i);
  else state.selected.add(i);
  syncSelection();
}

/* ---------------- 下载 ---------------- */

async function toPngBlob(url) {
  const resp = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const raw = await resp.blob();
  if (!raw.size) throw new Error('空文件');

  const bitmap = await createImageBitmap(raw);
  const { width: w, height: h } = bitmap;

  let png;
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    png = await canvas.convertToBlob({ type: 'image/png' });
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }
  if (bitmap.close) bitmap.close();
  if (!png) throw new Error('PNG 编码失败');
  return png;
}

function triggerDownload(url, filename) {
  // 允许直接用浏览器 file:// 打开本页调试，这时没有 downloads 权限
  if (typeof chrome === 'undefined' || !chrome.downloads || !chrome.downloads.download) {
    return Promise.resolve({ ok: false, error: '当前页面没有下载权限，请从扩展图标打开' });
  }
  return new Promise((resolve) => {
    chrome.downloads.download({ url, filename, saveAs: false }, (id) => {
      if (chrome.runtime.lastError || id === undefined) {
        resolve({ ok: false, error: chrome.runtime.lastError?.message || '下载被拒绝' });
        return;
      }
      // 等下载真正落盘再释放 blob URL
      const timer = setInterval(() => {
        chrome.downloads.search({ id }, (items) => {
          const item = items && items[0];
          if (!item) return;
          if (item.state === 'complete' || item.state === 'interrupted') {
            clearInterval(timer);
            resolve({ ok: item.state === 'complete', error: item.error });
          }
        });
      }, 300);
    });
  });
}

function setProgress(done, total, text) {
  const box = $('progress');
  box.hidden = false;
  $('progress-fill').style.width = `${total ? (done / total) * 100 : 0}%`;
  $('progress-text').textContent = text;
}

async function downloadSelected() {
  if (state.downloading || !state.selected.size) return;
  state.downloading = true;
  syncSelection();

  const picked = [...state.selected].sort((a, b) => a - b);
  let pngOk = 0;
  let fallback = 0;
  let failed = 0;

  for (let i = 0; i < picked.length; i += 1) {
    const idx = picked[i];
    const img = state.images[idx];
    const seq = String(i + 1).padStart(MIN_INDEX, '0');
    setProgress(i, picked.length, `正在处理第 ${i + 1}/${picked.length} 张…`);

    try {
      const png = await toPngBlob(img.url);
      const blobUrl = URL.createObjectURL(png);
      const res = await triggerDownload(blobUrl, `商品图_${seq}.png`);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
      if (res.ok) pngOk += 1;
      else throw new Error(res.error || '下载失败');
    } catch (err) {
      // 跨域拿不到二进制时，退回原图直链（后缀按原图来，不冒充 PNG）
      const ext = extOf(img.url);
      const res = await triggerDownload(img.url, `商品图_${seq}.${ext}`);
      if (res.ok) fallback += 1;
      else {
        failed += 1;
        console.warn('[图提取] 下载失败', img.url, err, res.error);
      }
    }
    await new Promise((r) => setTimeout(r, 220)); // 别把浏览器下载队列打爆
  }

  setProgress(picked.length, picked.length, '处理完成');
  const parts = [`成功 ${pngOk} 张 PNG`];
  if (fallback) parts.push(`${fallback} 张改用原图直链（该图不允许跨域读取）`);
  if (failed) parts.push(`${failed} 张失败`);
  $('progress-text').textContent = parts.join('，');
  state.downloading = false;
  syncSelection();
}

/* ---------------- 打包 ZIP ---------------- */

// 标准 CRC32 查表
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/**
 * 生成一个「仅存储」的 ZIP（不压缩）。
 * 图片本身就是压缩过的格式，再 deflate 一遍收益很低，
 * 用 store 模式反而实现简单、不依赖任何第三方库。
 * @param {{name:string, data:Uint8Array}[]} entries
 */
function buildZip(entries) {
  const enc = new TextEncoder();
  const { time, date } = dosTime(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);   // 签名
    lv.setUint16(4, 20, true);           // 解压所需版本
    lv.setUint16(6, 0x0800, true);       // 通用标志：文件名 UTF-8
    lv.setUint16(8, 0, true);            // 压缩方法：0 = 存储
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    locals.push(local, entry.data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);   // 中央目录签名
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);      // 本地头偏移
    central.set(nameBytes, 46);

    centrals.push(central);
    offset += local.length + size;
  }

  const cdSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const parts = [...locals, ...centrals, eocd];
  const total = parts.reduce((sum, b) => sum + b.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }
  return new Blob([out], { type: 'application/zip' });
}

async function downloadZip() {
  if (state.downloading || !state.selected.size) return;
  state.downloading = true;
  syncSelection();

  const picked = [...state.selected].sort((a, b) => a - b);
  const entries = [];
  let skipped = 0;

  for (let i = 0; i < picked.length; i += 1) {
    const img = state.images[picked[i]];
    setProgress(i, picked.length, `正在打包第 ${i + 1}/${picked.length} 张…`);
    try {
      const png = await toPngBlob(img.url);
      const data = new Uint8Array(await png.arrayBuffer());
      entries.push({ name: `商品图_${String(entries.length + 1).padStart(MIN_INDEX, '0')}.png`, data });
    } catch (err) {
      skipped += 1;
      console.warn('[图提取] 打包时跳过（跨域受限）', img.url, err);
    }
  }

  if (!entries.length) {
    $('progress-text').textContent = `打包失败：${skipped} 张都读不到二进制，请改用逐张下载`;
    state.downloading = false;
    syncSelection();
    return;
  }

  const zip = buildZip(entries);
  const blobUrl = URL.createObjectURL(zip);
  const res = await triggerDownload(blobUrl, '商品图.zip');
  setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);

  setProgress(picked.length, picked.length, res.ok
    ? `已打包 ${entries.length} 张${skipped ? `，跳过 ${skipped} 张（跨域受限）` : ''}`
    : `打包下载失败：${res.error || '未知原因'}`);
  state.downloading = false;
  syncSelection();
}

/* ---------------- 事件绑定 ---------------- */

function bind() {
  $('btn-all').addEventListener('click', () => {
    state.selected = new Set(state.images.map((_, i) => i));
    syncSelection();
  });

  $('btn-invert').addEventListener('click', () => {
    const next = new Set();
    state.images.forEach((_, i) => {
      if (!state.selected.has(i)) next.add(i);
    });
    state.selected = next;
    syncSelection();
  });

  $('btn-clear').addEventListener('click', () => {
    state.selected.clear();
    syncSelection();
  });

  $('btn-download').addEventListener('click', downloadSelected);
  $('btn-zip').addEventListener('click', downloadZip);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      state.selected = new Set(state.images.map((_, i) => i));
      syncSelection();
    }
  });
}

(async function init() {
  bind();
  const payload = await loadImages();
  if (payload) {
    state.images = payload.images || [];
    const title = payload.pageTitle || '';
    $('source').textContent = title
      ? `来源：${title.slice(0, 60)}${title.length > 60 ? '…' : ''}`
      : '来源：当前页面';
    document.title = `图提取 · ${state.images.length} 张图片`;
  }
  render();
})();
