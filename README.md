# 图提取 · 电商图片下载插件

一个 Chrome 扩展（Manifest V3），在电商商品详情页右下角放一个「获取图片」按钮，
点一下把整页商品图抓出来，在新标签页里勾选、统一转成 PNG 批量下载，也可以打个 ZIP。

配套有一个纯静态介绍官网（`docs/`），可直接用 GitHub Pages 托管。

---

## 目录结构

```
.
├─ extension/              扩展本体（加载这个目录）
│  ├─ manifest.json        扩展清单：权限、注入站点、入口
│  ├─ content.js           注入到商品页：悬浮按钮 + 扫描图片
│  ├─ content.css          按钮和提示气泡的样式
│  ├─ background.js        service worker：接收图片列表、开画廊页
│  ├─ gallery.html         预览页
│  ├─ gallery.js           勾选、转 PNG、打包 ZIP、触发下载
│  ├─ gallery.css          预览页样式
│  └─ 安装说明.txt          随包发的简短说明
├─ docs/                   官网（GitHub Pages 的站点根目录）
│  ├─ index.html
│  ├─ css/style.css
│  ├─ js/main.js
│  └─ assets/favicon.svg、tu-tiqu-extension.zip
├─ _资料/                  课件 PDF 与提取出来的文本（本地保留，不入库）
├─ _tools/                 开发期用的截图脚本（不参与部署）
└─ README.md
```

---

## 安装

1. 下载 `docs/assets/tu-tiqu-extension.zip` 并解压到一个固定目录；
   或者直接用本仓库里的 `extension/` 文件夹。
2. 浏览器地址栏输入 `chrome://extensions`（Edge 用 `edge://extensions`）。
3. 右上角打开「开发者模式」。
4. 点「加载已解压的扩展程序」，选中 `extension` 文件夹。
5. 工具栏出现紫色图标，装好。

![安装效果](docs/assets/favicon.svg)

## 使用

1. 打开淘宝 / 天猫 / 京东 / 拼多多的**商品详情页**。
2. 页面右下角出现「获取图片」按钮，点它。
   - 插件会先把页面滚到底再滚回来，触发懒加载，然后扫描。
3. 自动跳到预览页：缩略图、原始宽高、序号都在卡片上。
4. 全选 / 反选 / 点卡片切换，右上角显示已选数量。
5. 点「下载选中」逐张下载，或点「打包 ZIP」一次性拿走。

下载的文件名是 `商品图_001.png`、`商品图_002.png`……按选中顺序编号。

---

## 几个实现上的取舍

**为什么扫描放在 content script 里**
只有页面上下文能拿到 `naturalWidth`、懒加载的 `data-src`，以及 `getComputedStyle` 里的
`background-image`。后台拿不到这些，所以扫描必须在页面里做完再传出去。

**过滤规则**
小于 100×100 的全部丢掉；URL 里带 `logo / icon / sprite / placeholder / 1x1` 这类词的也丢掉；
`srcset` 里按 `w` 描述符挑最大的那张；协议相对地址（`//img.alicdn.com/...`）补成绝对地址后去重。
对于尺寸未知的图（懒加载还没触发），会临时 `new Image()` 量一次真实尺寸，4 秒超时。

**统一转 PNG 为什么可能失败**
部分电商 CDN 不给图片加 CORS 头，`fetch` 拿不到二进制，也就没法进 canvas 转码。
这时不会假装成功：会退回到**原图直链下载**，并按原图扩展名命名（比如 `商品图_003.jpg`），
界面上也会写清楚「N 张改用原图直链」。

**ZIP 是自己写的**
没有引入 JSZip 之类的库，`gallery.js` 里手写了 store 模式的 ZIP（CRC32 + 本地头 + 中央目录 + EOCD）。
图片本来就是压缩格式，再 deflate 收益很小，store 模式反而实现简单、零依赖。
生成结果用 PowerShell `Expand-Archive` 和 Python `zipfile` 都验过，能正常解压。

**数据不落盘**
图片列表存在 `chrome.storage.session`，关浏览器就没了；不上传服务器，也不写本地存储。

---

## 本地调试

扩展本身：改完代码到 `chrome://extensions` 点一下刷新按钮即可，不需要重装。

官网：直接双击 `docs/index.html` 就能看。想跑本地服务器：

```bash
python -m http.server 8000 -d docs
# 然后打开 http://localhost:8000
```

预览页单独调试：用浏览器打开 `extension/gallery.html?demo=1`，
没有扩展环境时会自动用 8 张本地生成的示意图画廊，方便调样式。

---

## 部署官网

把仓库推到 GitHub，在 **Settings → Pages** 里选：

- Source: `Deploy from a branch`
- Branch: `main`，目录选 **`/docs`**

等一两分钟，地址是 `https://<用户名>.github.io/<仓库名>/`。

详细步骤（含建仓库、推代码、验证域名）见 `../第六天提交清单.md`。
