// wikimodel.js
// Wiki 页模型: 点击菜单「Wiki」→ 整个网页"变成"3D 场景地面上的一张实体卡, diver 落卡登场。
// 卡面不是烘焙贴图, 而是页面本身: 页面整体收进一层载体, 每帧把"视口矩形 → 这块平面在屏幕上的
// 投影"的单应矩阵写进载体 transform —— 等价于页面这块平面被同一台相机投影。任何窗口比例下,
// 进入瞬间都是恒等变换(画面与切场前逐像素同位, 零跳变); 拉远后卡面上的雪花/体积光仍在实时呼吸。
// 模型骨骼动画 + 相机运镜与 model.html 完全同源 —— 同一份 three@0.165 + GLTFLoader/RoomEnvironment
// + 同一条 DEFAULT_WAYPOINTS 运镜(脚部特写 → 长距离拉远 → 快速回拉) + 手持摄影抖动。
// 分步实现: 覆盖 + 播放 + 实时整页卡 + K 帧面板(开场跳过/暂停段/手抖轨道/起始帧取景/卡片后移)已接;
// 世界地面(整页平铺)已接; 进出场过渡与踩踏细节后续再接。
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

const MODEL_URL = '../asset/model/character/diver.glb'

// 直达链接: 菜单「Wiki」点击时把 #wiki 标签写进 URL(见 enter); 之后再打开带标签的链接
// 就跳过首页开场与整段运镜, 直接落在运镜播完的 wiki 终态(白球 + 海面 + 字幕替换)。
// 开场跳过在 tyndall.js 里用同一判据(location.hash === '#wiki')。
const WIKI_DEEPLINK = location.hash === '#wiki'
// 内容 wiki 终态(纸色底 + 黑字 logo + header 横线)也有自己的直达标签:
// 点击内容WIKI按钮时写入, 之后带 #content 打开就直接落到这一页(不再播反相/合拢/飞出那几段)。
const CONTENT_HASH = '#content'
// 带子路径的 #content/xxx（wiki 内部路由）也算直达，刷新才能停在当前条目
const CONTENT_DEEPLINK = location.hash === CONTENT_HASH || location.hash.indexOf(CONTENT_HASH + '/') === 0

// ===== 覆盖层(自注入 DOM/CSS) =====
// 电影遮幅(letterbox): 点击 Wiki 后上下滑入两条黑条, 把整幅屏幕画面裁成 LETTERBOX_ASPECT:1。
// 纯屏幕空间遮罩(挂在 layer 里压住 GL 画布, 不改 3D 相机/卡片投影)—— 目标比例低于窗口比例时才会出现。
const LETTERBOX_ASPECT = 2.35 // 遮幅目标宽高比(2.35 ≈ 宽银幕); 调小 = 画面更矮、条更粗
const LETTERBOX_SEC = 0.7     // 黑条滑入时长(秒)
// 点击右上「游戏（插件）内容WIKI」按钮: 黑边转白与整幅画面反相同时开始;
// 反相完成后上下白边向中间合拢, 同时镜头对准按钮文字中心; 白幕合拢即只剩纯白底 + 按钮文字, 释放渲染器。
const CONTENT_LABEL_I = 2     // 四角按钮顺序与 buildLabels 一致: 0 左上 / 1 左下 / 2 右上(内容WIKI) / 3 右下
const INV_BAR_SEC = 0.75      // 黑边 → 白边过渡时长(秒, 与反相同起)
const INV_FADE_SEC = 1.6      // 画面渐变反色的时长(秒); 同步写进 CSS 过渡
const INV_CLOSE_SEC = 1.2     // 白边向中间合拢 / 镜头对准文字中心的时长(秒)
const INV_PAPER = '#f2f2f2'   // 白边 / 反相后的底色(带灰压暗, 不用纯白)
// 白幕之后: 按钮字飞向左上、渐变纯黑当 logo; logo 下方一条 3D 曲线从镜头外飞入并压平成 header 横线
const LOGO_HOLD_SEC = 0.35    // 白幕合拢后先留一拍(白底 + 居中标题)再起飞
const LOGO_FLY_SEC = 1.05     // 字飞向左上 / 变黑的时长(秒)
const HLINE_DELAY_SEC = 0.5   // 横线相对字起飞的延迟(字快到位时入场)
const HLINE_FLY_SEC = 1.2     // 3D 曲线飞入并压平成横线的时长(秒)
const HEADER_MARGIN_X = 64    // header 左右留白(logo 左缘与横线左端对齐)
const HEADER_MARGIN_Y = 48    // logo 上缘离视口顶的距离
const HEADER_GAP = 26         // logo 底缘到横线的间距
const SUBTITLE_TEXT = 'ON THE WAY TO WIKI' // 电影字幕文案(下黑条上方居中)
const SUBTITLE_LINE_W = 120   // 字幕两侧横线长度(px)
const SUBTITLE_GAP = 20       // 字幕底边离下黑条上沿(px)
const SKIP_BTN_GAP = 18       // Skip 按钮底边离下黑条上沿(px), 与首页开场 Skip 同款抬升(tyndall.js SKIP_BTN_GAP)
const SUBTITLE_LINE_SEC = 1.0 // 两侧横线画出时长(秒)
// 运镜停止后字幕逐字替换: 旧文案逐字消失 → 新文案逐字出现(触发点 = beginFocusClear, 运镜播完那刻)
const SUBTITLE_NEXT = 'LINSMAGIC WIKI' // 替换成的文案
const SUBTITLE_SWAP_LEAD = 0.15  // 运镜停止到第一个字开始变化的延迟(秒)
const SUBTITLE_SWAP_STEP = 0.055 // 逐字间隔(秒)
const SUBTITLE_SWAP_HOLD = 0.35  // 旧文案清完后到新文案起现的间隔(秒)
const SUBTITLE_SWAP_FADE = 0.14  // 单字淡入/淡出时长(秒)
// 环视模式(正式 wiki 部分)的准心几何: CSS(尺寸/样式)与 JS(逐帧画)共用这几个数
const XH_SIZE = 56 // 准心画布尺寸(css px)
const XH_GAP = 4   // 准心中心空档(px)
const XH_ARM = 9   // 准心臂长(px)
const XH_W = 1.5   // 准心线宽(px)
const style = document.createElement('style')
style.textContent = [
  '.wiki-layer {',
  '  position: fixed; inset: 0;',
  '  z-index: 500; /* GL 画布须压在页面载体(卡面)之上; 卡以外的虚空即 body 黑底 */',
  '  /* 不设背景色: 场景清屏全透明(renderer alpha), 卡以外的虚空即 body 黑底 */',
  '  display: none;',
  '}',
  '.wiki-layer.show { display: block; }',
  '.wiki-layer canvas { display: block; }',
  '/* 页面载体: 未变换时与原渲染逐像素相同; 进入 wiki 后身份 = 躺进 3D 的整页卡(逐帧写 transform) */',
  '.wiki-card {',
  '  position: fixed; left: 0; top: 0; width: 100%; height: 100%;',
  '  transform-origin: 0 0; /* matrix3d 以元素左上角为原点映射 */',
  '}',
  '/* wiki 模式: 调试面板不上卡面; 页面本体不隐藏 —— 它就是那张卡 */',
  'body.wiki-on .debug-panel { visibility: hidden !important; }',
  'body.wiki-on .wiki-card { pointer-events: none; /* 卡只被观照, 不再响应页面内交互 */ }',
  '/* ---- K 帧面板(挂在覆盖层里; 显示开关 = 上方 SHOW_KPANEL; 配色沿用调试面板) ---- */',
  '.wiki-kpanel {',
  '  position: fixed; top: 16px; left: 16px; z-index: 30; width: 560px;',
  '  background: rgba(12, 16, 22, 0.92); border: 1px solid rgba(255, 255, 255, 0.25);',
  '  border-radius: 8px; color: #e5edf5;',
  '  font: 11px/1.7 Consolas, "Courier New", monospace; letter-spacing: 0.05em;',
  '  user-select: none;',
  '}',
  '.wiki-kpanel input { user-select: text; }',
  '.wk-head { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.15); color: #8acaff; font-weight: bold; cursor: pointer; }',
  '.wk-head .fold { color: #9fb3c8; font-weight: normal; }',
  '.wk-body { padding: 8px 10px; }',
  '.wk-row { display: flex; gap: 8px; align-items: center; margin: 5px 0; }',
  '.wiki-kpanel button { background: #282a36; color: #50fa7b; border: 1px solid #6272a4; border-radius: 4px; padding: 2px 8px; font: inherit; letter-spacing: inherit; cursor: pointer; }',
  '.wiki-kpanel button:hover { border-color: #8acaff; }',
  '.wk-info { color: #9fb3c8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '.wk-scrub { width: 100%; accent-color: #8acaff; margin: 4px 0 2px; }',
  '.wk-track { position: relative; height: 22px; margin: 2px 0 6px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.18); border-radius: 3px; overflow: hidden; cursor: crosshair; }',
  '.wk-track i { position: absolute; top: 0; bottom: 0; }',
  '.wk-band-hold { background: rgba(255,255,255,0.10); }',
  '.wk-band-in { background: rgba(255,184,108,0.30); }',
  '.wk-band-out { background: rgba(255,184,108,0.14); }',
  '.wk-band-trim { background: rgba(0, 0, 0, 0.45); }',
  '.wk-tick { width: 1px; background: #ffb86c; }',
  '.wk-dot { width: 9px; height: 9px; border-radius: 50%; top: 50%; margin: -4.5px 0 0 -4.5px; }',
  '.wk-dot-on { background: #50fa7b; box-shadow: 0 0 4px #50fa7b; }',
  '.wk-dot-off { background: #ff6b6b; box-shadow: 0 0 4px #ff6b6b; }',
  '.wk-dot-rad { background: #ff79c6; box-shadow: 0 0 4px #ff79c6; }',
  '.wk-dot-exp { background: #f1fa8c; box-shadow: 0 0 4px #f1fa8c; }',
  '.wk-dot-disp { background: #8be9fd; box-shadow: 0 0 4px #8be9fd; }',
  '.wk-playhead { width: 1px; background: #fff; box-shadow: 0 0 4px #fff; z-index: 2; }',
  '.wk-rows { max-height: 200px; overflow-y: auto; margin-top: 6px; }',
  '.wk-keyrow { display: flex; gap: 6px; align-items: center; margin: 3px 0; padding: 3px 6px; background: rgba(255,255,255,0.05); border-radius: 4px; }',
  '.wk-keyrow .tag { color: #ffb86c; }',
  '.wk-keyrow[data-kind="s"] .tag { color: #8acaff; }',
  '.wk-keyrow[data-kind="r"] .tag { color: #ff79c6; }',
  '.wk-keyrow[data-kind="e"] .tag { color: #f1fa8c; }',
  '.wk-keyrow[data-kind="d"] .tag { color: #8be9fd; }',
  '.wk-keyrow input { width: 56px; background: #0c1016; color: #e5edf5; border: 1px solid #6272a4; border-radius: 3px; font: inherit; letter-spacing: inherit; padding: 1px 4px; }',
  '.wk-keyrow .del { background: none; border: none; color: #ff6b6b; padding: 0 4px; }',
  '.wk-keyrow .onoff { min-width: 36px; }',
  '.wk-toast { color: #50fa7b; min-height: 1.7em; }',
  '.wk-hidden { display: none !important; }',
  '/* 调起始帧期间: 时间轴相关控件整体禁用变暗, 只留应用/取消/重播 */',
  '.wiki-kpanel.editing .wk-scrub, .wiki-kpanel.editing .wk-track, .wiki-kpanel.editing .wk-kbtns, .wiki-kpanel.editing .wk-rows { opacity: 0.35; pointer-events: none; }',
  'body.wiki-editing .wiki-layer canvas { cursor: grab; }',
  '/* ---- 电影遮幅黑条(高度由 layoutLetterbox 按 LETTERBOX_ASPECT 算; 点 Wiki 后加 .on 滑入) ---- */',
  '.wiki-bar { position: fixed; left: 0; right: 0; height: 0; background: #000; z-index: 20; pointer-events: none; transition: transform ' + LETTERBOX_SEC + 's cubic-bezier(0.65, 0, 0.35, 1), background-color ' + INV_BAR_SEC + 's ease; }',
  '.wiki-bar.wb-top { top: 0; transform: translateY(-101%); }',
  '.wiki-bar.wb-bottom { bottom: 0; transform: translateY(101%); }',
  '.wiki-bar.on { transform: translateY(0); }',
  '.wiki-bar.to-white { background: ' + INV_PAPER + '; }',
  '/* ---- 内容WIKI点击: 除该按钮文字外, 3D画面/字幕/准心/首页卡一起渐变反相(白边不参与) ---- */',
  'html, body { transition: background-color ' + INV_FADE_SEC + 's ease; }',
  'html.wiki-invert, html.wiki-invert body { background-color: ' + INV_PAPER + '; }',
  '.wiki-glcanvas { transition: filter ' + INV_FADE_SEC + 's ease; }',
  '.wiki-xhair, .wiki-kpanel, .wiki-card { transition: filter ' + INV_FADE_SEC + 's ease; }',
  'html.wiki-invert .wiki-glcanvas, html.wiki-invert .wiki-subtitle, html.wiki-invert .wiki-skip,',
  'html.wiki-invert .wiki-lockhint, html.wiki-invert .wiki-xhair, html.wiki-invert .wiki-kpanel,',
  'html.wiki-invert .wiki-card { filter: invert(1); }',
  '/* 反相期间接替该按钮的 DOM 复刻: 不参与反相, 逐帧贴合原 3D 精灵的屏幕矩形 */',
  '.wiki-exempt { position: fixed; z-index: 15; transform: translate(-50%, -50%); pointer-events: none; opacity: 0; }', // 低于遮幅白边(20): 转头到条下时和原精灵一样被遮住
  '.wiki-exempt.on { opacity: 1; }',
  '.wiki-exempt.top { z-index: 26; }', // 白边合拢阶段: 压过白边, 成为最后留下的按钮字
  '.wiki-exempt canvas { display: block; width: 100%; height: 100%; transition: opacity 0.8s ease; }',
  '.wiki-exempt .scan { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: multiply; background: repeating-linear-gradient(to top, rgba(0,0,0,0.26) 0px, rgba(0,0,0,0.26) 1.2px, rgba(0,0,0,0.02) 1.3px, rgba(0,0,0,0.02) 4px); animation: wikiExemptScan 0.14s linear infinite; }',
  '@keyframes wikiExemptScan { from { background-position: 0 0; } to { background-position: 0 -4px; } }',
  '/* 白幕之后: 字飞向左上(位移+缩小写进 CSS 变量); 同时叠一张无描边的纯黑字身画布, 交叉淡入成为 logo */',
  '.wiki-exempt { transition: transform ' + LOGO_FLY_SEC + 's cubic-bezier(0.22, 0.61, 0.36, 1); }',
  '.wiki-exempt.logo { transform: translate(-50%, -50%) translate(var(--logo-tx, 0px), var(--logo-ty, 0px)) scale(var(--logo-s, 1)); }',
  '.wiki-exempt .logo-ink { position: absolute; left: 0; top: 0; width: 100%; height: 100%; opacity: 0; transition: opacity 0.9s ease; }',
  '.wiki-exempt.logo .logo-ink { opacity: 1; }',
  '.wiki-exempt.logo > canvas:first-child { opacity: 0; }', // 带描边的 HUD 字身淡出, 只留纯黑字身
  '.wiki-exempt .scan { transition: opacity 0.6s ease; }',
  '.wiki-exempt.logo .scan { opacity: 0; }',
  '/* header 横线的容器: 蛇形曲线路径与落位由 JS 逐帧写, 落位后是一条静止直线 */',
  '.wiki-hline { position: fixed; inset: 0; z-index: 25; pointer-events: none; }',
  '.wiki-hline canvas { display: block; width: 100%; height: 100%; }',
  '/* ---- 电影字幕(下黑条上方): 文案淡入 + 两侧横线一左一右向文字画出 ---- */',
  '.wiki-subtitle { position: fixed; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 18px; z-index: 20; pointer-events: none; opacity: 0; transition: opacity 0.7s ease 0.2s; }',
  '.wiki-subtitle.on { opacity: 1; }',
  '.ws-text { color: #fff; font-family: Rondal, "Times New Roman", Georgia, serif; font-weight: 700; font-size: clamp(12px, 1.1vw, 24px); line-height: 1; letter-spacing: 0.34em; text-indent: 0.34em; white-space: pre; text-shadow: -1px 0 0 rgba(0,0,0,0.85), 1px 0 0 rgba(0,0,0,0.85), 0 -1px 0 rgba(0,0,0,0.85), 0 1px 0 rgba(0,0,0,0.85), 0 0 10px rgba(0,0,0,0.9); }',
  '.ws-line { width: ' + SUBTITLE_LINE_W + 'px; height: 1px; background: rgba(255,255,255,0.85); transform: scaleX(0); }',
  '.ws-line-l { transform-origin: 0 50%; transition: transform ' + SUBTITLE_LINE_SEC + 's cubic-bezier(0.22, 0.61, 0.36, 1) 0.35s; }', // 从左往右画
  '.ws-line-r { transform-origin: 100% 50%; transition: transform ' + SUBTITLE_LINE_SEC + 's cubic-bezier(0.22, 0.61, 0.36, 1) 0.35s; }', // 从右往左画
  '.wiki-subtitle.on .ws-line { transform: scaleX(1); }',
  '/* ---- 字幕逐字替换(运镜停止后): 旧文案逐字淡出 → 新文案逐字淡入 ---- */',
  // 两份文案叠在同一格(inline-grid 同 grid-area): 盒子宽 = 两者较大值 ⇒ 换字全程盒子尺寸不变, 两侧横线不会被推着走
  '.ws-textbox { display: inline-grid; justify-items: center; }',
  '.ws-textbox > .ws-text { grid-area: 1 / 1; }',
  // 每个字一个 span, 各自的 transition-delay 在 JS 里按序写(旧字用短延迟, 新字排在旧字点完后) ⇒ 一次加类即完成两段串行
  '.ws-ch { display: inline-block; opacity: 1; transition: opacity ' + SUBTITLE_SWAP_FADE + 's ease; }',
  '.ws-text-new .ws-ch { opacity: 0; }',
  '.wiki-subtitle.swapped .ws-text-old .ws-ch { opacity: 0; }',
  '.wiki-subtitle.swapped .ws-text-new .ws-ch { opacity: 1; }',
  '/* ---- Skip 按钮(右下角, 与首页开场 Skip 同款文案/字体/配色): 播放运镜期间可点, 直接跳到末机位 ---- */',
  '.wiki-skip { position: fixed; right: 24px; bottom: 24px; z-index: 25; pointer-events: none; opacity: 0; transition: opacity 2.4s ease; cursor: pointer; user-select: none; -webkit-user-select: none; font-family: Rondal, serif; font-size: 2vw; letter-spacing: 0.12em; font-style: italic; color: rgba(208, 212, 235, 0.34); }',
  '.wiki-skip.on { opacity: 1; pointer-events: auto; }',
  '/* ---- 环视模式: 十字准心(屏幕中心; 故障 RGB 闪动由 JS 逐帧画; 对下层反色 = difference) ---- */',
  '.wiki-xhair { position: fixed; left: 50%; top: 50%; width: ' + XH_SIZE + 'px; height: ' + XH_SIZE + 'px; transform: translate(-50%, -50%); z-index: 25; pointer-events: none; display: none; mix-blend-mode: difference; }',
  '.wiki-xhair.on { display: block; }',
  '/* ---- 环视模式: 未锁定鼠标时的提示(准心下方一行小字) ---- */',
  '.wiki-lockhint { position: fixed; left: 50%; top: calc(50% + 40px); transform: translateX(-50%); z-index: 25; pointer-events: none; opacity: 0; transition: opacity 0.5s ease; color: rgba(228, 233, 240, 0.95); font-family: "Source Han Serif CN", "Noto Serif CJK SC", "Songti SC", "STSong", "SimSun", serif; font-size: 22px; letter-spacing: 0.3em; text-indent: 0.3em; -webkit-text-stroke: 3px #000; paint-order: stroke fill; }',
  '.wiki-lockhint.on { opacity: 1; }',
  '/* 反相过渡: 这几个元素原有 opacity 过渡, 追加 filter 时把原属性一并列出(须排在其简写之后) */',
  '.wiki-subtitle { transition: opacity 0.7s ease 0.2s, filter ' + INV_FADE_SEC + 's ease; }',
  '.wiki-skip { transition: opacity 2.4s ease, filter ' + INV_FADE_SEC + 's ease; }',
  '.wiki-lockhint { transition: opacity 0.5s ease, filter ' + INV_FADE_SEC + 's ease; }'
].join('\n')
document.head.appendChild(style)

// 页面载体: 把此刻 body 里的一切(页面 + 各脚本挂到 body 的 UI)收进一层容器。
// 未做变换时不产生任何视觉/布局差异(位置与堆叠照旧); 进入 wiki 后它就是"躺进 3D 的那张卡"。
// 之后新挂到 body 的元素(如碎块飞出画布)在进入时一并收缴。
const wrap = document.createElement('div')
wrap.className = 'wiki-card'
while (document.body.firstChild) wrap.appendChild(document.body.firstChild)
document.body.appendChild(wrap)

const layer = document.createElement('div')
layer.className = 'wiki-layer'
document.body.appendChild(layer)

// 电影遮幅黑条: 压在 GL 画布之上、K 面板(层级 30)之下, 不挡任何点击
const barTop = document.createElement('div')
barTop.className = 'wiki-bar wb-top'
const barBottom = document.createElement('div')
barBottom.className = 'wiki-bar wb-bottom'
layer.appendChild(barTop)
layer.appendChild(barBottom)

// 电影字幕: 下黑条上方居中 —— 文案淡入, 左线从左往右画、右线从右往左画(一同向文字收拢)
// 文案按字拆 span: 旧文案与"运镜停止后要换上的"新文案叠在同一格, 逐字淡出/淡入(见 beginFocusClear)
const subtitleEl = document.createElement('div')
subtitleEl.className = 'wiki-subtitle'
const subtitleLineL = document.createElement('i')
subtitleLineL.className = 'ws-line ws-line-l'
const subtitleLineR = document.createElement('i')
subtitleLineR.className = 'ws-line ws-line-r'
const subtitleBox = document.createElement('span')
subtitleBox.className = 'ws-textbox'
const subtitleOldEl = document.createElement('span')
subtitleOldEl.className = 'ws-text ws-text-old'
const subtitleNewEl = document.createElement('span')
subtitleNewEl.className = 'ws-text ws-text-new'
function fillSubtitleChars(el, text, delay0) {
  el.textContent = ''
  for (let i = 0; i < text.length; i++) {
    const ch = document.createElement('span')
    ch.className = 'ws-ch'
    ch.textContent = text.charAt(i)
    ch.style.transitionDelay = (delay0 + i * SUBTITLE_SWAP_STEP).toFixed(3) + 's' // 逐字错开
    el.appendChild(ch)
  }
}
fillSubtitleChars(subtitleOldEl, SUBTITLE_TEXT, SUBTITLE_SWAP_LEAD)
fillSubtitleChars(subtitleNewEl, SUBTITLE_NEXT, SUBTITLE_SWAP_LEAD + SUBTITLE_TEXT.length * SUBTITLE_SWAP_STEP + SUBTITLE_SWAP_HOLD)
subtitleBox.appendChild(subtitleOldEl)
subtitleBox.appendChild(subtitleNewEl)
subtitleEl.appendChild(subtitleLineL)
subtitleEl.appendChild(subtitleBox)
subtitleEl.appendChild(subtitleLineR)
layer.appendChild(subtitleEl)

// Skip 按钮: 右下角, 与首页开场 Skip 同款文案与样式; 播放运镜期间点击直接跳到末机位
const skipBtnEl = document.createElement('div')
skipBtnEl.className = 'wiki-skip'
skipBtnEl.textContent = 'Skip（跳过）'
skipBtnEl.addEventListener('click', function () {
  if (!timeline || !isPlaying) return
  const endW = playSegs.length ? playSegs[playSegs.length - 1].w1 : timeline.totalTime
  wallTime = endW // 墙钟推到结尾: 下一帧走既有"播完"分支(末机位 + 聚焦收尾), 复用同一套收尾逻辑
})
layer.appendChild(skipBtnEl)

function layoutLetterbox() {
  if (_contentInvT >= 0 && _contentCloseT >= 0) return // 合拢阶段由 updateContentInvite 逐帧驱动条高
  // 每边条高 = (视口高 − 视口宽/比例) / 2; 窗口本身就比目标比例宽时 = 0(不遮)
  const h = Math.max(0, (window.innerHeight - window.innerWidth / LETTERBOX_ASPECT) / 2)
  barTop.style.height = h + 'px'
  barBottom.style.height = h + 'px'
  subtitleEl.style.bottom = (h + SUBTITLE_GAP) + 'px' // 字幕贴着下黑条上沿站
  skipBtnEl.style.bottom = (h + SKIP_BTN_GAP) + 'px'  // Skip 同法抬到下黑条上沿之上, 不压在黑边上
}

// ===== 场景: 与 model.html 同规格 =====
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100) // 35 度长焦
camera.position.set(0, 1.2, 4)

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }) // alpha: 画布带透明通道
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setClearColor(0x000000, 0) // 清屏全透明: 露出底下的页面(卡)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0 // 曝光总闸(整体明暗): 0 = 一切光变全黑, 不是"环境光开关"
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.domElement.classList.add('wiki-glcanvas') // 反相过渡只作用于场景画布, 不连累遮幅白边
layer.appendChild(renderer.domElement)

// ===== 光斑滤镜(wiki 版): 复用 glowfilter.js 的工厂, 用本模块的 r165 THREE 建资源(与渲染器同源) =====
// 中继纹理拿到的画面必须与"直出画布"逐像素同源(都经 ACES + sRGB 编码, 见 ensureWikiRTs),
// 所以滤镜按显示空间算(linearIO 默认 0), 并把 alpha 透传(空处透明, 露出底下的页面卡)。
// 逐帧由 K 面板的两条数值轨(散焦半径/曝光)驱动; 半径 0 ⇒ 整条链摘除, 场景直出(零开销)。
const wikiGlow = (typeof window.createGlowFilter === 'function')
  ? window.createGlowFilter(THREE, renderer.domElement, { alphaOut: 1 })
  : null
if (wikiGlow) wikiGlow.setKeyed(0) // 起手不启用(避免沿用工厂默认的"开场满强度")

// 中继渲染目标: 滤镜/色散启用时场景先落这里, 再由后处理整帧上屏(尺寸随帧缓冲; samples 保住边缘抗锯齿)
// ★ isXRRenderTarget + colorSpace = sRGB: three 只在"屏幕或 XR 目标"上做色调映射 + sRGB 编码,
//   普通渲染目标一律当线性工作空间(不着色、不编码)。这里借用 XR 那支分支, 让中继纹理拿到与直出画布
//   完全一致的画面 —— 否则后处理点亮/摘除的瞬间整幅画面的调子都会跳(且 >1 的 HDR 值会把后处理搞成 NaN)。
let glowRT = null
let chainRT = null // 散焦链的输出落点(散焦之后还要再挂色散, Pass4 不能一边读 glowRT 一边写 glowRT)
const _rtSize = new THREE.Vector2()
function ensureWikiRTs(withChain) {
  renderer.getDrawingBufferSize(_rtSize)
  const w = Math.max(1, Math.round(_rtSize.x)), h = Math.max(1, Math.round(_rtSize.y))
  if (!glowRT || glowRT.width !== w || glowRT.height !== h) {
    if (glowRT) glowRT.dispose()
    glowRT = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: THREE.HalfFloatType, // 画面已在 [0,1] 内, 半浮点只为免去二次 8 位量化
      depthBuffer: true, stencilBuffer: false, samples: 4,
      colorSpace: THREE.SRGBColorSpace // 着色器把画面编码成 sRGB 写进来(XR 分支会强制 RGBA16F 存储, 不会二次编码)
    })
    glowRT.isXRRenderTarget = true // 让该目标走"显示目标"分支: 应用 toneMapping 与 outputColorSpace(见上)
    // 尺寸变化后滤镜内部的 SAT/散景缓冲在下一帧 render() 里按新帧缓冲惰性重建(自动比对尺寸);
    // 同时把滤镜的后备纹理同步到新视口, 免得 Pass1 的取景比例(cover-fit)与实际画面不一致
    if (wikiGlow) wikiGlow.resize(window.innerWidth, window.innerHeight)
  }
  if (withChain && (!chainRT || chainRT.width !== w || chainRT.height !== h)) {
    if (chainRT) chainRT.dispose()
    chainRT = new THREE.WebGLRenderTarget(w, h, { // 纯中转: 存的已是显示空间画面(着色器原样写), 不编不码
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: THREE.HalfFloatType,
      depthBuffer: false, stencilBuffer: false
    })
  }
}
// 场景上屏: 有后处理经中继纹理走完整条链, 都没有则直出(与接入前逐像素一致)
function renderScene() {
  const _pf = WIKI_PROFILE && profOn // 性能采样开启时, 把"场景绘制"与"后处理链"分开计时
  const _rt0 = _pf ? performance.now() : 0
  const glowOn = !!(wikiGlow && wikiGlow.supported && wikiGlow.active())
  const dispOn = !!(wikiDisp && wikiDisp.supported && wikiDisp.active())
  if (!glowOn && !dispOn) {
    renderer.setRenderTarget(null)
    renderer.render(scene, camera)
    if (_pf) profAdd('scene', performance.now() - _rt0)
    return
  }
  ensureWikiRTs(glowOn && dispOn)
  renderer.setRenderTarget(glowRT)
  renderer.render(scene, camera)
  renderer.setRenderTarget(null)
  if (_pf) profAdd('scene', performance.now() - _rt0)
  const _rt1 = _pf ? performance.now() : 0
  let tex = glowRT.texture
  if (glowOn) {
    wikiGlow.render(renderer, tex, dispOn ? chainRT : null) // 后面还接色散时散焦链落 chainRT, 免得 Pass4 读写同一张纹理
    if (dispOn) tex = chainRT.texture
  }
  if (dispOn) wikiDisp.render(renderer, tex)
  if (_pf) profAdd('post', performance.now() - _rt1)
}

// ===== 纯 RGB 色散(摄影镜头横向色差): 整条 wiki 渲染链的最后一环 =====
// 效果本体(着色器 + 参数 + 渐进包络)全在 dispfilter.js 里, 这里只接线: enter 归零重新渐进, 每帧 update。
const wikiDisp = (typeof window.createDispFilter === 'function')
  ? window.createDispFilter(THREE, renderer.domElement) // 参数见 dispfilter.js 顶部 DISP_*
  : null
if (wikiDisp) wikiDisp.enter() // 起手强度 0(等 enter 再渐进)

// 不建 model.html 的网格: 脚下就是页面那张卡, 参考线会穿帮
const pmrem = new THREE.PMREMGenerator(renderer)
// 环境照明(IBL): 真正关闭 = 置 null。第 2 个参数是「模糊度」不是强度——改成 0 只是变锐利, 照样全亮
scene.environment = null
// scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.000).texture

const dirLight = new THREE.DirectionalLight(0xffffff, 1)
dirLight.position.set(0, -8, -0)// 从斜下往上打: 光源在 -z 侧(长时大景机位那侧)的下方——纯垂直时相机可见面 N·L=0 等于没开灯; 改 x/z 换方位, y 越负越垂直
dirLight.castShadow = false // 从下打的"地面光"是软光, 不用投影; 开着会用它自己的阴影把侧后身吃黑(看不到作用的原因之一)
scene.add(dirLight)

const fillLight = new THREE.DirectionalLight(0xffffff, 1) // 次光(正面补光): 照角色正脸, 强度先给 1
fillLight.position.set(0, 1.2, 5) // 正前方(+z, 走路朝向那侧)略高于胸口; 只方向起作用(position→默认 target 原点)
scene.add(fillLight)

// 人物影子: 由"面前这盏次光"投出 —— 影长由光仰角定(position 的 y/z 之比: 现在 ≈13.5°, 1.7 米的人甩出 ≈7 米长影,
// 想短就抬高 position.y)。接影板是一块只显示阴影的 ShadowMaterial 平铺在 y≈0: GL 画布压在卡面(wrap)之上,
// 所以影子会同时落在活页面卡片与远处烘焙地面上。从下打的主光保持不投影(dirLight.castShadow=false, 别开)。
const SHADOW_OPACITY = 0.35 // 影子浓淡: 0 = 没有影子
const SHADOW_SIZE = 48      // 接影板边长(米): 要盖住人物与它甩出的长影
fillLight.castShadow = true
fillLight.shadow.mapSize.set(2048, 2048)
const _fillShadowCam = fillLight.shadow.camera
_fillShadowCam.left = -14; _fillShadowCam.right = 14
_fillShadowCam.top = 14; _fillShadowCam.bottom = -14
_fillShadowCam.near = 0.1; _fillShadowCam.far = 60
_fillShadowCam.updateProjectionMatrix()
fillLight.shadow.bias = -0.0004   // 接影板上出现条纹/漏光时微调 bias 与 normalBias
fillLight.shadow.normalBias = 0.02
const shadowPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(SHADOW_SIZE, SHADOW_SIZE),
  new THREE.ShadowMaterial({ transparent: true, opacity: SHADOW_OPACITY })
)
shadowPlane.rotation.x = -Math.PI / 2
shadowPlane.position.y = 0.005 // 略高于卡面/地面(y=0), 防同面闪烁
shadowPlane.receiveShadow = true
shadowPlane.depthWrite = false
shadowPlane.renderOrder = 0.5 // 地面(0)之后, 云(1)/眩光(2)之前
scene.add(shadowPlane)

// 脚底接触影: 开场机位从头顶朝正下方看人物"前方"的地面 —— 前灯的长影全甩在人物背后, 那个机位物理上看不到影子;
// 所以给双脚本各贴一枚随脚骨走的柔和黑斑(贴地满浓度, 抬脚渐隐), 任意机位下"踩上来"都有影子。
// 斑大小自适应: 直径 = 脚长(踝骨↔趾尖) × SPAN; 高度基准初值取静置姿态的脚高, 落地后会向下学到真实值。
const FOOT_SHADOW_OPACITY = 0.5 // 接触影浓度: 0 = 没有
const FOOT_SHADOW_SPAN = 1.6    // 斑直径 ÷ 脚长: 1 = 恰好脚跟到趾尖, 大一点才会从俯视下露出轮廓
const FOOT_SHADOW_GROUND = 0.12 // 贴地判定(脚长倍数): 抬起不超过这么多 = 满浓度
const FOOT_SHADOW_LIFT = 0.9    // 抬到这么高(脚长倍数)接触影完全消失
const FOOT_SHADOW_Y = 0.012     // 斑离地高: 高于接影板(0.005), 防同面闪烁

const _footShadowTex = (function () {
  const s = 128
  const cv = document.createElement('canvas')
  cv.width = cv.height = s
  const c = cv.getContext('2d')
  const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(0,0,0,0.95)')
  g.addColorStop(0.55, 'rgba(0,0,0,0.5)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  c.fillStyle = g
  c.fillRect(0, 0, s, s)
  return new THREE.CanvasTexture(cv)
})()

const footShadows = [] // [{ foot, toe, blob, span, minY }]
const _fsA = new THREE.Vector3()
const _fsB = new THREE.Vector3()

function findBone(re) {
  let found = null
  model.traverse(function (o) { if (!found && o.isBone && re.test(o.name)) found = o })
  return found
}

function addFootShadow(foot, toe) {
  foot.getWorldPosition(_fsA)
  toe.getWorldPosition(_fsB)
  const span = _fsA.distanceTo(_fsB) // 脚长(世界单位): 骨链刚性, 任意姿态下恒定
  if (!(span > 1e-4)) return
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: _footShadowTex, color: 0x000000, transparent: true, depthWrite: false, toneMapped: false })
  )
  blob.rotation.x = -Math.PI / 2
  blob.position.y = FOOT_SHADOW_Y
  blob.renderOrder = 0.6 // 地面(0)/接影板(0.5)之后, 云(1)/眩光(2)之前
  blob.visible = false
  scene.add(blob)
  footShadows.push({ foot, toe, blob, span, minY: Math.min(_fsA.y, _fsB.y) })
}

function hideFootShadows() {
  for (let i = 0; i < footShadows.length; i++) footShadows[i].blob.visible = false
}

function updateFootShadows() {
  if (!model || !model.visible || !footShadows.length) return
  for (let i = 0; i < footShadows.length; i++) {
    const f = footShadows[i]
    f.foot.getWorldPosition(_fsA)
    f.toe.getWorldPosition(_fsB)
    const low = Math.min(_fsA.y, _fsB.y)
    if (low < f.minY) f.minY = low // 落地一次就学到真实脚高; 基准只降不升(拖进度条乱序也稳)
    let u = ((low - f.minY) / f.span - FOOT_SHADOW_GROUND) / (FOOT_SHADOW_LIFT - FOOT_SHADOW_GROUND)
    u = u < 0 ? 0 : u > 1 ? 1 : u
    const k = 1 - u * u * (3 - 2 * u) // 满浓度 → 平滑淡出
    f.blob.visible = k > 0.003
    if (!f.blob.visible) continue
    const d = f.span * FOOT_SHADOW_SPAN * (1 + 0.35 * u) // 抬得越高斑越大越淡(软影)
    f.blob.scale.set(d, d, 1)
    f.blob.position.x = (_fsA.x + _fsB.x) * 0.5
    f.blob.position.z = (_fsA.z + _fsB.z) * 0.5
    f.blob.material.opacity = FOOT_SHADOW_OPACITY * k
  }
}

let mixer = null
let model = null // 人物模型根(聚焦收尾时连骨骼一起收掉)
let modelReady = false
if (!CONTENT_DEEPLINK) new GLTFLoader().load(MODEL_URL, (gltf) => {
  if (_released) return // 白屏收尾后迟到的模型不再挂进场景(免得上传纹理后又泄漏)
  model = gltf.scene
  scene.add(model)
  model.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = true
      c.receiveShadow = true
    }
  })
  if (gltf.animations && gltf.animations.length > 0) {
    mixer = new THREE.AnimationMixer(model)
    mixer.clipAction(gltf.animations[0]).play()
  }
  // 脚底接触影: 挂到双脚骨上(趾尖骨缺了退回趾根骨)
  const lfB = findBone(/leftfoot/i), rfB = findBone(/rightfoot/i)
  const ltB = findBone(/lefttoe_?end/i) || findBone(/lefttoebase/i)
  const rtB = findBone(/righttoe_?end/i) || findBone(/righttoebase/i)
  if (lfB && rfB && ltB && rtB) {
    addFootShadow(lfB, ltB)
    addFootShadow(rfB, rtB)
  } else {
    console.warn('[wiki] 脚骨未找齐, 跳过脚底接触影:', lfB && lfB.name, rfB && rfB.name, ltB && ltB.name, rtB && rtB.name)
  }
  modelReady = true
  if (WIKI_DEEPLINK && focusT >= 0) model.visible = false // 直达: 收尾已先行, 迟到的模型不再露脸
  if (pendingEnter) startPlayback() // 模型迟到落地: 此刻才与运镜一起起跑, 保证踩脚与运镜同相位
})

// ===== 运镜(照搬 model.html: 同一曲线/时间轴/手抖算法, 去掉编辑器部分) =====
let waypoints = [] // [{ pos, quat, hold?, segDur? }]
let posCurve = null
let knotFractions = null // 各航点在曲线上的累计弧长占比
let squadS = []          // Squad 内部控制点四元数(C1 连续)
let segLengths = []      // 每段路径弧长
let timeline = null      // [{type:'hold'|'seg', index, start, end}] 及 totalTime
let isPlaying = false
let playTime = 0
const duration = 8 // 运镜总时长(秒); 显式 segDur 之外的段按弧长平分剩余预算
const IS_LOOP = false

const LOOK_TARGET = new THREE.Vector3(0, 0.8, 0) // model.html 的 controls.target

// 复用临时对象, 避免动画循环中每帧堆分配
const _qa = new THREE.Quaternion()
const _qb = new THREE.Quaternion()
const _qInv = new THREE.Quaternion()
const _qL1 = new THREE.Quaternion()
const _qL2 = new THREE.Quaternion()
const _qExp = new THREE.Quaternion()
const _shakeVec = new THREE.Vector3()
const _shakeEuler = new THREE.Euler()
const _shakeQuat = new THREE.Quaternion()

// 手持摄影抖动参数(播放运镜时叠加在理想轨迹上)
const SHAKE_POS_AMP = 0.042    // 基础位置抖动幅度(米)
const SHAKE_ROT_AMP = 0.0222   // 基础角度抖动幅度(弧度, 约 0.13°)
const SHAKE_MOVE_GAIN = 1.4    // 移动段放大系数
const SHAKE_HOLD_SCALE = 0.35  // 停留时保留的抖动比例(呼吸感)
const SHAKE_AMP_TAU = 0.25     // 手抖幅度平滑时间常数(秒): 越大进出暂停段越柔; 0 = 不平滑(会突跳)
const SHAKE_END_FADE = 1.5     // 末段手抖渐隐时长(内容秒): 到达末节点(=播放终点)时手抖完全禁用; 0 = 不启用
const SHAKE_FREQ_SCALE = 0.64   // 频率整体倍率(改这一个即可调快慢): 1 = 原始; >1 更急促, <1 更缓

// 多频正弦叠加, 构造拟真手抖噪声; 返回约 [-1, 1]
function shakeNoise(t, f1, f2, f3, ph) {
  const tt = t * SHAKE_FREQ_SCALE // 频率整体倍率统一作用在时间轴上, 一处调全部快慢
  return Math.sin(tt * f1 + ph) * 0.55
       + Math.sin(tt * f2 + ph * 2.1) * 0.30
       + Math.sin(tt * f3 + ph * 3.7) * 0.15
}

// 在理想位姿之上叠加手抖(每帧基于基准重算, 不累积)
function applyHandheldShake(t, motionFactor) {
  const posAmp = SHAKE_POS_AMP * motionFactor
  const rotAmp = SHAKE_ROT_AMP * motionFactor

  _shakeVec.set(
    shakeNoise(t, 11.3, 6.7, 3.1, 0.0),
    shakeNoise(t, 9.1, 5.3, 2.7, 1.7),
    shakeNoise(t, 12.7, 7.9, 4.3, 3.3)
  ).multiplyScalar(posAmp)
  _shakeVec.applyQuaternion(camera.quaternion)
  camera.position.add(_shakeVec)

  _shakeEuler.set(
    shakeNoise(t, 8.3, 4.9, 2.3, 0.9) * rotAmp,
    shakeNoise(t, 10.9, 6.1, 3.5, 2.5) * rotAmp,
    shakeNoise(t, 7.3, 4.1, 1.9, 4.1) * rotAmp
  )
  _shakeQuat.setFromEuler(_shakeEuler)
  camera.quaternion.multiply(_shakeQuat)
}

// 单位四元数对数(取最短弧, w<0 时整体取反), 输出 w=0
function quatLog(q, out) {
  let w = q.w, x = q.x, y = q.y, z = q.z
  if (w < 0) { w = -w; x = -x; y = -y; z = -z }
  const halfTheta = Math.acos(Math.min(1, Math.max(-1, w)))
  const s = Math.sin(halfTheta)
  out.w = 0
  if (s > 1e-6) {
    const k = halfTheta / s
    out.x = x * k; out.y = y * k; out.z = z * k
  } else {
    out.x = x; out.y = y; out.z = z
  }
  return out
}

// 纯虚四元数指数, 返回单位四元数
function quatExp(p, out) {
  const v = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z)
  out.w = Math.cos(v)
  if (v > 1e-8) {
    const k = Math.sin(v) / v
    out.x = p.x * k; out.y = p.y * k; out.z = p.z * k
  } else {
    out.x = p.x; out.y = p.y; out.z = p.z
  }
  return out
}

// 重建曲线/弧长占比/Squad 控制点/播放时间轴
function updateCurves() {
  if (waypoints.length < 2) {
    posCurve = null
    knotFractions = null
    squadS = []
    segLengths = []
    timeline = null
    return
  }

  const positions = waypoints.map(w => w.pos)
  posCurve = new THREE.CatmullRomCurve3(positions, IS_LOOP, 'catmullrom', 0.5)

  // 各航点(曲线节点)的累计弧长占比: 位置曲线按弧长参数化, 各段长短不一,
  // 不能按 t*i/(n-1) 均匀切姿态段, 否则姿态到达航点的时刻与位置错位
  ;(function computeKnotFractions() {
    const segN = IS_LOOP ? waypoints.length : waypoints.length - 1
    const SAMPLES = 48
    segLengths = new Array(segN)
    let total = 0
    let prev = posCurve.getPoint(0)
    for (let i = 0; i < segN; i++) {
      let len = 0
      for (let s = 1; s <= SAMPLES; s++) {
        const u = (i * SAMPLES + s) / (segN * SAMPLES)
        const p = posCurve.getPoint(u)
        len += p.distanceTo(prev)
        prev = p
      }
      segLengths[i] = len
      total += len
    }
    knotFractions = [0]
    let acc = 0
    for (let i = 0; i < segN - 1; i++) {
      acc += segLengths[i]
      knotFractions.push(total > 0 ? acc / total : (i + 1) / segN)
    }
    knotFractions.push(1)
  })()

  // Squad 内部控制点 s_i = q_i · exp(-(log(q_i^-1·q_{i-1}) + log(q_i^-1·q_{i+1}))/4):
  // 姿态轨迹在航点处 C1 连续(角速度无突变), 且节点上精确等于录制四元数
  ;(function buildSquadControls() {
    const n = waypoints.length
    squadS = new Array(n)
    for (let i = 0; i < n; i++) {
      const qi = waypoints[i].quat
      const iPrev = IS_LOOP ? (i - 1 + n) % n : Math.max(0, i - 1)
      const iNext = IS_LOOP ? (i + 1) % n : Math.min(n - 1, i + 1)
      _qInv.copy(qi).invert()
      quatLog(_qL1.copy(_qInv).multiply(waypoints[iPrev].quat), _qL1)
      quatLog(_qL2.copy(_qInv).multiply(waypoints[iNext].quat), _qL2)
      _qExp.set((-_qL1.x - _qL2.x) / 4, (-_qL1.y - _qL2.y) / 4, (-_qL1.z - _qL2.z) / 4, 0)
      quatExp(_qExp, _qExp)
      squadS[i] = new THREE.Quaternion().copy(qi).multiply(_qExp)
    }
  })()

  // 播放时间轴(秒): hold = 到达该机位后停留; segDur = 该段移动秒数(如冲刺段);
  // 其余自动段平分时长预算并按弧长比例分配, 保持全程等速
  ;(function buildTimeline() {
    const n = waypoints.length
    const segN = segLengths.length
    const holds = []
    for (let i = 0; i < n; i++) {
      const h = Number(waypoints[i].hold) || 0
      holds.push(!IS_LOOP && i === n - 1 ? 0 : Math.max(0, h))
    }

    const segDurs = new Array(segN)
    let explicitSum = 0
    let autoLen = 0
    for (let i = 0; i < segN; i++) {
      const d = Number(waypoints[(i + 1) % n].segDur)
      if (d > 0) {
        segDurs[i] = d
        explicitSum += d
      } else {
        segDurs[i] = -1
        autoLen += segLengths[i]
      }
    }
    const autoBudget = Math.max(0.1, duration - explicitSum)
    const speed = autoLen > 0 ? autoLen / autoBudget : 0
    for (let i = 0; i < segN; i++) {
      if (segDurs[i] < 0) segDurs[i] = speed > 0 ? segLengths[i] / speed : autoBudget / segN
    }

    const events = []
    let cursor = 0
    for (let i = 0; i < segN; i++) {
      if (holds[i] > 0 && !(IS_LOOP && i === segN - 1)) {
        events.push({ type: 'hold', index: i, start: cursor, end: cursor + holds[i] })
        cursor += holds[i]
      }
      const startHeld = holds[i] > 0
      const endHeld = holds[i + 1] > 0 || (!IS_LOOP && i === segN - 1)
      events.push({ type: 'seg', index: i, start: cursor, end: cursor + segDurs[i], startHeld, endHeld })
      cursor += segDurs[i]
    }
    timeline = { events, totalTime: cursor, segDurs, holds, avgSpeed: cursor > 0 ? segLengths.reduce((a, b) => a + b, 0) / cursor : 0 }
  })()
}

// 默认运镜队列(与 model.html 当前导出的一致; 换新运镜时整体替换此数组)
// 首节点 hold: 2 = Wiki 进场先在卡面定格 2 秒再起步(本地差异, 从 model.html 重导时记得保留)
const DEFAULT_WAYPOINTS = [
  { pos: [0.045908, 2.161719, 1.597315], quat: [-0.113407, 0.700901, 0.694831, 0.114397], hold: 2 },
  { pos: [0.196714, 0.751894, -1.493803], quat: [0.000889, 0.993984, 0.109222, -0.008094] },
  { pos: [-0.156631, 0.721736, -9.35683], quat: [0.001418, 0.998043, 0.057471, -0.024621] },
  { pos: [-9.46432, 0.560821, -14.618119], quat: [-0.016972, 0.97839, -0.089447, -0.185643], hold: 2 },
  { pos: [-3.489691, 3.597148, 0.778449], quat: [-0.016972, 0.97839, -0.089447, -0.185643], segDur: 1.5 }
]
DEFAULT_WAYPOINTS.forEach(function (d) {
  const wp = {
    pos: new THREE.Vector3(d.pos[0], d.pos[1], d.pos[2]),
    quat: new THREE.Quaternion(d.quat[0], d.quat[1], d.quat[2], d.quat[3])
  }
  if (Number(d.hold) > 0) wp.hold = Number(d.hold)
  if (Number(d.segDur) > 0) wp.segDur = Number(d.segDur)
  waypoints.push(wp)
})
updateCurves()

// 收尾焦点: 白色强自发光球体, 摆在最终机位(最后一节航点)视轴正前方 —— 给拉远后的空景一个落点。
// 位置/方向都从最后一节航点推, 重录运镜后自动跟着走; 想摆别处直接改 orb.position 或这里两个旋钮。
const ORB_DIST = 6      // 距最终机位距离(米): 调它 = 改球在终帧画面里的大小/远近
const ORB_RADIUS = 0.2  // 球半径(米)
const ORB_GLOW = 6      // 自发光强度: 1 以上开始过曝, 越大越死白(无泛光后期, "强"就体现在这)
const _orbLast = waypoints[waypoints.length - 1]
const orb = new THREE.Mesh(
  new THREE.SphereGeometry(ORB_RADIUS, 32, 16),
  new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: ORB_GLOW })
)
orb.position.copy(_orbLast.pos).add(new THREE.Vector3(0, 0, -1).applyQuaternion(_orbLast.quat).multiplyScalar(ORB_DIST))
scene.add(orb)

// 眩光(加色广告牌方片, 不吃灯光/不投影): 片元里自算平滑径向剖面(无分段接缝, 尾端零值零斜率),
// 再乘一层动态云絮噪波 —— 大团云推挤光晕半径、细云絮让亮度忽明忽暗; 强度归 0 即干净径向光晕。
// 压扁的那块 = 横向拉丝: 中间段被球体深度遮掉, 左右两翼从球两侧长出来, 就是变形镜头(anamorphic)的横条眩光。
const ORB_GLARE = 4           // 径向光晕直径(米)
const ORB_STREAK = [12, 0.7]  // 水平拉丝[长, 粗](米); 长填 0 = 关掉拉丝
const ORB_GLARE_A = 0.8       // 眩光浓度(光晕/拉丝共用)
const ORB_GLARE_NOISE = 0.65  // 云絮干扰强度: 0 = 干净的径向渐变(与从前一模一样), 1 = 云絮全强度飘扰
const ORB_GLARE_NOISE_SPEED = 0.35 // 云絮流动速度(噪声时间流速): 越大飘得越快
const ORB_GLARE_NOISE_SCALE = 2.2  // 云絮大小: 越大越细碎, 越小团块越大
const glareQuads = []
function addGlareQuad(w, h) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: ORB_GLARE_A },
      uTime: { value: 0 },
      uAmt: { value: ORB_GLARE_NOISE },
      uSpeed: { value: ORB_GLARE_NOISE_SPEED },
      uNScale: { value: ORB_GLARE_NOISE_SCALE },
      uSize: { value: new THREE.Vector2(w, h) } // 云絮按世界尺寸铺: 拉丝(17:1)上也不会被拉成横条
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main() {',
      '  vUv = uv;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform float uOpacity;',
      'uniform float uTime;',
      'uniform float uAmt;',
      'uniform float uSpeed;',
      'uniform float uNScale;',
      'uniform vec2 uSize;',
      'varying vec2 vUv;',
      'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }',
      'float vnoise(vec2 p) {',
      '  vec2 i = floor(p), f = fract(p);',
      '  vec2 u = f * f * (3.0 - 2.0 * f);',
      '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),',
      '             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);',
      '}',
      'float fbm(vec2 p) {',
      '  float v = 0.0, a = 0.5;',
      '  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }',
      '  return v;',
      '}',
      'void main() {',
      '  vec2 p = (vUv - 0.5) * 2.0;',
      '  float r0 = length(p);',
      '  vec2 np = p * uSize * 0.25;', // 噪声坐标进世界尺度(0.25 米基准): 两块方片上云絮大小一致
      '  float t = uTime * uSpeed;',
      '  float n1 = fbm(np * uNScale + vec2(t * 1.2, -t * 0.8));',
      '  float n2 = fbm(np * (uNScale * 0.5) + vec2(-t * 0.5, t * 0.35) + 17.3);',
      '  float r = r0 * (1.0 + uAmt * 0.45 * (n2 * 2.0 - 1.0));', // 大团云推挤半径
      '  float w = max(1.0 - r, 0.0);',
      '  float a = 0.88 * w * w * w + 0.11 * pow(w, 1.2);', // 平滑剖面: 内芯 (1-r)^3×0.88 + 宽尾 (1-r)^1.2×0.11, 端零值零斜率(旧 4 段线性 stop 的斜率突变就是"分级"环)
      '  a *= 1.0 - smoothstep(0.88, 1.0, r0);', // 噪声不许把亮度顶出方片边界(否则直边切出方框)
      '  float s = smoothstep(0.28, 0.75, n1);', // 细云絮
      '  a *= mix(1.0, 0.65 + 1.4 * s, uAmt);', // 均值≈1: 总亮度不变, 只是云飘过时忽明忽暗
      '  a += (hash(gl_FragCoord.xy) - 0.5) * (1.5 / 255.0);', // 屏空间抖动: 打碎暗底上 8bit 尾部的等值线环
      '  a = max(a, 0.0);',
      '  gl_FragColor = vec4(vec3(1.0), a * uOpacity);',
      '}'
    ].join('\n'),
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false
  })
  const q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
  q.scale.set(w, h, 1)
  q.position.copy(orb.position)
  q.renderOrder = 2 // 画在引力球云(renderOrder 1)之后: 眩光永远压在最上层
  glareQuads.push(q)
  scene.add(q)
}
addGlareQuad(ORB_GLARE, ORB_GLARE)
if (ORB_STREAK[0] > 0) addGlareQuad(ORB_STREAK[0], ORB_STREAK[1])

// 每帧: 广告牌面向相机 + 云絮时间推进(走墙钟: 暂停/聚焦收尾里也一直飘)
function updateGlare(now) {
  for (let i = 0; i < glareQuads.length; i++) {
    const q = glareQuads[i]
    q.position.copy(orb.position)
    q.quaternion.copy(camera.quaternion)
    q.material.uniforms.uTime.value = now
  }
}

// ===== 引力球(体积外套): shader.html 的「4体引力 SDF 体积云」整个搬来包在白球外围 =====
// 中央的噪声大球把白球裹在芯里, 四颗小球被引力互相拉着绕着白球飞、靠近时融成一团(玻璃质感的虹彩轮廓)。
// 实现: 白球外套一个方盒, 片元里从相机沿视线步进采样这段体积——shader.html 的 map/累积/调色逐字搬来
// (SDF 单位全同), 只加了「盒内起止」与相机换算。物理(4 球互引+核心排斥)在 CPU 跑, 参数与 demo 一致。
// 位置每帧跟白球走(改 orb.position / ORB_DIST 自动联动); 想整体关掉: ORB_SHELL_OPACITY = 0。
const ORB_SHELL_SCALE = 1.6   // 云团大小(白球的倍数): 1 = 中央云团半径≈白球半径(刚贴上); 调大 = 云胀开、球相对越小
const ORB_SHELL_OPACITY = 0.65 // 云浓度总闸: 1 = shader.html 原味(玻璃球几乎盖实白球); 0.65 白球芯还透亮; 0 = 整个引力球消失
const ORB_SHELL_UNIT = ORB_RADIUS / 0.9 * ORB_SHELL_SCALE // 1 个 SDF 单位 = 多少米(中央云团基准半径 0.9 单位)
const SHELL_HALF = 4.0        // 采样盒半边长(SDF 单位): 要罩住 4 球活动边界 3.2 + 球半径 + 噪声起伏; 片元里 ±4.0 与之对应
const SHELL_PHYS = { G: 3.6, softening: 0.25, drag: 0.018, brownian: 0.025, coreRadius: 0.70, repulsionForce: 18.0 }
const shellBodies = [
  { pos: new THREE.Vector3( 1.55,  0.15,  0.00), vel: new THREE.Vector3( 0.00,  0.45,  1.42) },
  { pos: new THREE.Vector3(-1.25,  0.65,  0.40), vel: new THREE.Vector3( 0.80, -0.20, -1.25) },
  { pos: new THREE.Vector3( 0.35, -1.15, -0.70), vel: new THREE.Vector3(-1.30,  0.35,  0.55) },
  { pos: new THREE.Vector3(-0.40,  0.25, -1.45), vel: new THREE.Vector3( 1.30,  0.65,  0.20) }
]

const shellUniforms = {
  uTime: { value: 0 },
  uCenter: { value: orb.position.clone() }, // 白球世界位置(每帧同步)
  uScale: { value: ORB_SHELL_UNIT },
  uOpacity: { value: ORB_SHELL_OPACITY },
  uOrbR: { value: ORB_RADIUS / ORB_SHELL_UNIT }, // 白球半径(SDF 单位): 步进撞到它就停, 云只叠在球前
  uPos: { value: shellBodies.map(function (b) { return b.pos }) } // 引用小球位置并原地更新
}
const shellMat = new THREE.ShaderMaterial({
  uniforms: shellUniforms,
  vertexShader: [
    'varying vec3 vWorldPos;',
    'void main() {',
    '  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n'),
  fragmentShader: [
    'uniform vec3 uCenter;',
    'uniform float uScale;',
    'uniform float uTime;',
    'uniform float uOpacity;',
    'uniform float uOrbR;',
    'uniform vec3 uPos[4];',
    'varying vec3 vWorldPos;',
    '',
    'float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.5432))) * 43758.5453123); }',
    'float noise(vec3 p) {',
    '  vec3 i = floor(p);',
    '  vec3 f = fract(p);',
    '  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);',
    '  return mix(',
    '    mix(mix(hash(i + vec3(0.0, 0.0, 0.0)), hash(i + vec3(1.0, 0.0, 0.0)), u.x),',
    '        mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),',
    '    mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), u.x),',
    '        mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),',
    '    u.z);',
    '}',
    'float fbm(vec3 p) {',
    '  float v = 0.0;',
    '  float a = 0.5;',
    '  for (int i = 0; i < 3; ++i) {',
    '    v += a * noise(p);',
    '    p = p * 2.02 + vec3(1.7, 9.2, 4.3);',
    '    a *= 0.5;',
    '  }',
    '  return v;',
    '}',
    'float smin(float a, float b, float k) {',
    '  float h = max(k - abs(a - b), 0.0) / k;',
    '  return min(a, b) - h * h * k * 0.25;',
    '}',
    'float map(vec3 p) {',
    '  vec3 np = p * 1.3 + vec3(0.0, uTime * 0.25, uTime * 0.15);',
    '  float displacement = (fbm(np) - 0.45) * 0.45;',
    '  float dBig = length(p) - (0.9 + displacement);',
    '  float d0 = length(p - uPos[0]) - (0.36 + displacement);',
    '  float d1 = length(p - uPos[1]) - (0.26 + displacement);',
    '  float d2 = length(p - uPos[2]) - (0.21 + displacement);',
    '  float d3 = length(p - uPos[3]) - (0.17 + displacement);',
    '  float fused = smin(dBig, d0, 0.45);',
    '  fused = smin(fused, d1, 0.38);',
    '  fused = smin(fused, d2, 0.32);',
    '  fused = smin(fused, d3, 0.28);',
    '  return abs(fused) - 0.015;',
    '}',
    'void main() {',
    '  vec3 ro = (cameraPosition - uCenter) / uScale;',
    '  vec3 rd = normalize(vWorldPos - cameraPosition);',
    '  // 盒(±4 SDF 单位)求交: 只步进进出点之间这一段',
    '  vec3 ta = (vec3(-4.0) - ro) / rd;',
    '  vec3 tb = (vec3(4.0) - ro) / rd;',
    '  vec3 tmn = min(ta, tb), tmx = max(ta, tb);',
    '  float tEnter = max(max(max(tmn.x, tmn.y), tmn.z), 0.0);',
    '  float tExit = min(min(tmx.x, tmx.y), tmx.z);',
    '  if (tExit <= tEnter) discard;',
    '',
    '  vec4 N = vec4(0.0);',
    '  vec3 k = ro + rd * (tEnter + 0.002);',
    '  float camDistU = length(ro);',
    '  for (int i = 0; i < 96; i++) {',
    '    float traveled = length(k - ro);',
    '    if (traveled >= tExit || N.a >= 6.0) break;',
    '    if (length(k) < uOrbR) break; // 撞进白球: 它是实心亮核, 云只算到球面为止(球身后那半边不叠色)',
    '    float depth = traveled - camDistU + 4.3; // 深度折到 shader.html 的默认机距(4.3): 步进/色相不随相机远近漂移',
    '    float b = max(map(k), 0.0);',
    '    float edge = min(b * 1024.0, 0.35 - b);',
    '    if (edge > 0.0) {',
    '      float spatialPhase = dot(k, vec3(0.6, 0.5, 0.4)) + k.z * 0.6;',
    '      float fresnel = 1.0 - abs(dot(rd, normalize(k + vec3(0.0001))));',
    '      float distBig = length(k);',
    '      float distMinSmall = min(min(length(k - uPos[0]), length(k - uPos[1])), min(length(k - uPos[2]), length(k - uPos[3])));',
    '      float fusionTension = exp(-clamp(abs(distBig - distMinSmall), 0.0, 5.0) * 3.5);',
    '      float colorPhase = spatialPhase + fresnel * 1.8 + fusionTension * 3.14 + depth * 0.15 - uTime * 0.5;',
    '      vec4 colPalette = 0.04 + 0.02 * cos(colorPhase + vec4(6.0, 1.0, 2.0, 0.0));',
    '      colPalette.rgb += vec3(0.025, 0.015, 0.035) * fusionTension;',
    '      colPalette.a = 0.04;',
    '      N += edge * colPalette;',
    '    }',
    '    k += rd * max(b, 0.0035) * (0.8 + depth * 0.15) * 0.35;',
    '  }',
    '',
    '  vec3 mappedColor;',
    '  for (int c = 0; c < 3; c++) {',
    '    float u = N[c] - 0.42;',
    '    float denom = u + 0.25 + 0.15 / (abs(u) + 0.08);',
    '    mappedColor[c] = clamp(u / denom + 0.4, 0.15, 1.0);',
    '  }',
    '  float gray = dot(mappedColor, vec3(0.299, 0.587, 0.114));',
    '  mappedColor = mix(vec3(gray), mappedColor, 0.35);',
    '  float alpha = smoothstep(0.01, 0.4, N.a) * uOpacity;',
    '  if (alpha < 0.004) discard;',
    '  gl_FragColor = vec4(mappedColor, alpha);',
    '}'
  ].join('\n'),
  transparent: true,
  depthWrite: false // 半透明体积只叠色; 深度测试留着: 人和卡挡在云前时正常遮住它
})
// 前壁式方盒: 相机永远在盒外 → 前壁片段(比白球近)过深度后叠色, 云于是"糊"在白球和背景上
const shellBox = new THREE.Mesh(
  new THREE.BoxGeometry(ORB_SHELL_UNIT * SHELL_HALF * 2, ORB_SHELL_UNIT * SHELL_HALF * 2, ORB_SHELL_UNIT * SHELL_HALF * 2),
  shellMat
)
shellBox.position.copy(orb.position)
shellBox.renderOrder = 1 // 先云后眩晕光(眩光 renderOrder 2)
if (ORB_SHELL_OPACITY <= 0) shellBox.visible = false // 0 = 彻底关掉(连步进都不跑)
scene.add(shellBox)

// 每帧: CPU 物理(式与 shader.html updatePhysics 全同: 8 子步/引力+核心排斥+阻尼+布朗/限速/边界回弹)
function updateOrbShell(dt, now) {
  if (!(dt > 0)) dt = 0.016
  dt = Math.min(dt, 0.033)
  const steps = 8
  const subDt = dt / steps
  const randScale = SHELL_PHYS.brownian * Math.sqrt(1 / subDt)
  for (let s = 0; s < steps; s++) {
    for (let i = 0; i < shellBodies.length; i++) {
      const b = shellBodies[i]
      const px = b.pos.x, py = b.pos.y, pz = b.pos.z
      const r2 = px * px + py * py + pz * pz
      const r = Math.sqrt(Math.max(r2, 0.001))
      const invR3 = 1 / Math.pow(r2 + SHELL_PHYS.softening, 1.5)
      let ax = -SHELL_PHYS.G * px * invR3
      let ay = -SHELL_PHYS.G * py * invR3
      let az = -SHELL_PHYS.G * pz * invR3
      if (r < SHELL_PHYS.coreRadius) { // 核心排斥: 小球别扎进白球
        const overlap = SHELL_PHYS.coreRadius - r
        const repMag = Math.min(SHELL_PHYS.repulsionForce * overlap * overlap / (r * r + 0.06), 60)
        ax += px / r * repMag
        ay += py / r * repMag
        az += pz / r * repMag
      }
      b.vel.x += (ax - SHELL_PHYS.drag * b.vel.x + (Math.random() * 2 - 1) * randScale) * subDt
      b.vel.y += (ay - SHELL_PHYS.drag * b.vel.y + (Math.random() * 2 - 1) * randScale) * subDt
      b.vel.z += (az - SHELL_PHYS.drag * b.vel.z + (Math.random() * 2 - 1) * randScale) * subDt
      const speed = Math.hypot(b.vel.x, b.vel.y, b.vel.z)
      if (speed > 4.5) b.vel.multiplyScalar(4.5 / speed)
      b.pos.addScaledVector(b.vel, subDt)
      if (r > 3.2) { // 活动边界回弹(SDF 单位)
        b.vel.x -= px * 0.8 * subDt
        b.vel.y -= py * 0.8 * subDt
        b.vel.z -= pz * 0.8 * subDt
      }
    }
  }
  shellBox.position.copy(orb.position)
  shellUniforms.uCenter.value.copy(orb.position)
  shellUniforms.uTime.value = now
}

// ===== K 帧键位: 开场跳过 + 暂停段 + 手抖轨道 =====
// 面板「导出到控制台」打出的 const, 直接粘回这里替换同名常量即可复现(也可手改)。
// PLAY_FROM: 起播用动画第几秒的那一帧(前段直接跳过, 相机+骨骼同步); 0 = 从动画开头播。
//   各键 t 都是"动画内容秒"(含被跳过的前段): 调 PLAY_FROM 只让键更早/更晚到达, 不挪动对应的画面瞬间。
// PAUSE_KEYS: { t: 暂停点(动画秒), hold: 停留(墙钟秒), easeIn: 渐停(墙钟秒), easeOut: 渐起(墙钟秒) }
//   运镜自带 hold(如首节点 hold:2)只停相机、骨骼照跑; K 暂停段停的是"内容时间"——
//   渐停/停留/渐起期间相机与骨骼一起定格(所以能给踩卡瞬间做"凝滞"感)。
//   渐停/渐起按"全速→0 / 0→全速"的 smoothstep 速度曲线, 过程中消耗的内容长度
//   是设定时长的一半(不会急刹); 与前一个键重叠时自动缩到间隙内, 接缝速度仍连续。
// SHAKE_KEYS: { t: 激活点(内容秒), on: true开/false关, fade: 渐变(墙钟秒) }
//   无键 = 手抖全程开(与从前一致); 一旦有键, 首个键之前默认关。激活按内容时间判定,
//   渐变从"首次到达该内容时刻"的墙钟起算(若该时刻落在暂停平台里, 从平台起点起算)。
const PLAY_FROM = 0.6 // 起播跳过前 0.6s(用动画第 0.6s 的帧开局)
const PAUSE_KEYS = [{ t: 1.311, hold: 1, easeIn: 0.5, easeOut: 0.5 }]
const SHAKE_KEYS = [{ t: 0, on: false, fade: 0.5 }, { t: 2.37, on: true, fade: 0.5 }]
// GLOW_RADIUS_KEYS / GLOW_EXPOSURE_KEYS: 光斑滤镜(六边形电影散景)的两条数值轨, 作用于 wiki 画面本身。
//   { t: 内容秒, v: 值 } —— 半径(px, 散景内部工作分辨率像素; 0 = 不启用、整条滤镜从渲染链摘除)/ 曝光(示例默认 0.75)。
//   两条轨按内容时间插值(相邻键之间 smoothstep 缓入缓出), 键稀疏即可; K 点一般落在卡片段之后(拉远/收尾)。
const GLOW_RADIUS_KEYS = [{ t: 0.3, v: 10 }, { t: 2.578, v: 0 }, { t: 3.959, v: 5 }, { t: 5.588, v: 9 }, { t: 6.4, v: 35 }, { t: 8.8, v: 7 }, { t: 9.863, v: 0 }]
const GLOW_EXPOSURE_KEYS = [{ t: 0.6, v: 1 }, { t: 7.9, v: 0.05 }, { t: 8.772, v: 0.7 }, { t: 10.124, v: 1 }]
// DISP_KEYS: RGB 色散(摄影横向色差, wiki 渲染链最后一环)的强度轨。{ t: 内容秒, v: 强度 0~1 } ——
//   满强度 1 = dispfilter.js 顶部的 DISP_AMOUNT(画面角上径向缩放量)。无键 = 走 dispfilter 自带的墙钟渐进
//   (进 wiki 后 DISP_RAMP_SEC 秒升到满强度并保持); 一旦有键即改用内容时间插值(同散焦/曝光两条轨)。
const DISP_KEYS = [{ t: 1.302, v: 0 }, { t: 2.069, v: 0.85 }, { t: 6.926, v: 1 }, { t: 8.787, v: 0.5 }, { t: 10.7, v: 0 }, { t: 11.4, v: 1 }]
const DISP_DEFAULT = 1 // 「K 色散 @ 现在」在无键时落的初始强度(取其上限, 再在行里手调)
const GLOW_RADIUS_DEFAULT = 10   // 「K 散焦半径 @ 现在」在无键时落的初始半径(px): 落地即有明显散焦, 再手调
const GLOW_EXPOSURE_DEFAULT = 0.75
const SHOW_KPANEL = false // 左上角「K 帧调控」面板显示开关: true = 显示(现场 K 帧; 平时改回 false 隐藏, 刷新页面生效)

// 键行编辑按 data-kind 找数据源(见下方 hRows 事件)
const KEY_SETS = { p: PAUSE_KEYS, s: SHAKE_KEYS, r: GLOW_RADIUS_KEYS, e: GLOW_EXPOSURE_KEYS, d: DISP_KEYS }

// 卡片后移(走路假象): 内容时间越过 CARD_MOVE_FROM 后, 整卡沿 CARD_MOVE_DIR 匀速平移(米/秒)。
// 默认按骨骼动画实测: 着地脚掌在根坐标系里以 ≈2.1 m/s 朝 (0.03, -1) 方向后滑 ——
// 卡以同速同向滑 = 脚掌相对卡面静止, 观感是"人往前走、脚下的地(页面)往后流";
// 改 SPEED 开始滑步, 改 FROM 改变起步时刻, DIR 是世界水平方向(x, z)。
const CARD_MOVE_FROM = 1.33
const CARD_MOVE_SPEED = 2.1
const CARD_MOVE_DIR = [0.03, -1]
const CARD_FADE_D = 0.6 // 卡滑到离相机镜面这么近(米)内开始渐隐, 越过镜面即隐藏(见 updateCardTransform)

// 世界地面: 进入时把"此刻的整页"烘焙成一张贴图, 在 GL 里以卡尺寸无限重复平铺成整个世界的地面
// (一个 draw call); 活卡投影区开透明窗口(页面本体透出)、远处没入黑(藏网格边缘); 行走流动与
// CARD_MOVE 同一运动 —— 全部旋钮在下面这几个数。
const GROUND_SIZE = 140        // 地面网格目标边长(米): 取最接近的"奇数个 tile"作为实际尺寸(奇数是图案中心对齐卡心的条件)
const GROUND_FADE_NEAR = 40    // 距相机水平距离内地面全显
const GROUND_FADE_FAR = 58     // 超过即完全没入黑
const GROUND_WINDOW_BAND = 0.7 // 活卡矩形外侧这条带内地面 0→1 渐入(藏贴图与活页面的接缝)
const GROUND_TEX_MAX = 2048    // 烘焙贴图最大宽(px); 高按视口比例

// 聚焦收尾: 运镜播完停在白球最后一位后, 地面(先渐隐)/人物/页面卡全部撤掉, 只留白球+引力球+眩光;
// 重播、拖进度条、调起始帧会自动把整个世界恢复。
const FOCUS_GROUND_FADE = 1.2  // 地面渐隐时长(墙钟秒): 播完起算, 淡到全透明后地面网格整个关掉

// 鼠标环视(正式 wiki 部分): 运镜停稳(或直达进入)后进入"环视模式" —— 鼠标被吃掉(指针锁定),
// 移动鼠标直接转视角(游戏式, 机位不动); 屏幕中心出故障 RGB 十字准心。浏览器要求手势才能锁定:
// 进入时自动试一次, 失败(或按 Esc 释放)后点画面任意处重新锁定, 未锁定时准心下有提示。
// 播放/拖动/调起始帧期间不生效(运镜与取帧要干净), 聚焦收尾那一刻接上(见 updateMouseLook)。
const LOOK_SENS = 0.12    // 灵敏度(度/像素): 鼠标每移动 1px 转多少度
const LOOK_TAU = 0.12     // 追赶平滑时间常数(秒): 视角拖着往目标滑, 越大越"重"越飘, 0.05 以下近乎硬跟
const LOOK_YAW_MAX = 36   // 左右最大转角(度): 转到头停住(四角字幕都在这个范围内可达)
const LOOK_PITCH_MAX = 20 // 上下最大转角(度)
const LOOK_YAW_SIGN = 1   // 鼠标推右 = 视角朝右为 1, 反了改 -1
const LOOK_PITCH_SIGN = 1 // 鼠标推上 = 视角朝上为 1 (想要"反向鼠标"改 -1)
const LOOK_HINT = '点击锁定视角' // 未锁定时准心下方提示文案

// 四角 3D 引导字幕(环视模式): 悬在末机位四周、面朝摄像机的精灵文字 —— 每个初始"微微露出"在画面
// 四角外, 转头即可读全, 引导玩家环视。位置按"当前可见半角 + 标签自身尺寸"实时摆放(见 layoutLabels):
// 横向只露 LABEL_PEEK 比例、纵向贴黑条内侧; 窗口比例变了自动重排。
const LABEL_TL = '世界观设定'
const LABEL_BL = '游戏理念设定'
const LABEL_TR = '游戏（插件）内容WIKI'
const LABEL_BR = '部署文档'
const LABEL_TL_EN = 'Worldview'           // 第一行英文(放大): 左上
const LABEL_BL_EN = 'Design Philosophy'   // 左下
const LABEL_TR_EN = 'Plugin Content Wiki' // 右上
const LABEL_BR_EN = 'Deployment Docs'     // 右下
const LABEL_DIST = 8           // 距末机位距离(米): 只影响透视视差, 屏上大小另算(恒定)
const LABEL_PX = 44            // 中文行屏上字高(px, 1080p 基准): 随窗口高等比
const LABEL_EN_BIG = 1.5       // 第一行英文相对中文行的放大倍数
const LABEL_STROKE = 0.14      // 字形黑描边线宽(占字号比例): 视觉厚度≈一半, 与提示语同款
const LABEL_SCAN_FREQ = 1.6    // 扫描闪动: 横纹频率(弧度/px): 越大纹越密
const LABEL_SCAN_SPEED = 60    // 扫描闪动: 亮暗纹上扫速度(px/秒)
const LABEL_SCAN_MIN = 0.72    // 扫描闪动: 暗纹处亮度(0~1): 越小纹越深
const LABEL_FLICKER = 0.28     // 扫描闪动: 亮度抖动幅度(0~1): 越大闪得越凶
const LABEL_PEEK = 0.3         // 每个标签露在画面内的宽度占比(调大 = 露更多, 0.5 = 露一半)
const LABEL_EDGE_INSET = 0.06  // 纵向离黑条内沿的空隙(占可见半高的比例)
const LABEL_FADE = 0.9         // 亮相淡入时长(墙钟秒): 与聚焦收尾同起算

// 四角按钮对应的模型"故障色散虚影": 准心转向某个按钮(方向夹角进 LABEL_GHOST_NEAR~FAR)时, 按钮锚点
// 浮现该按钮的纯色模型 —— 不接光照, RGB 三通道加法混合、各自沿屏幕错位(偶发爆发), 同吃扫描闪动;
// 摆位沿标签视线上再往深 LABEL_GHOST_DEPTH 米 → 角度与标签完全同位, 透明排序天然垫在标签之下。
const WIKI_UI_DIR = '../asset/model/wiki-ui/' // 四按钮模型目录(与四角一一对应, 见 buildLabels)
const LABEL_GHOST_DEPTH = 1.5    // 比标签深的米数(沿视线后移): 越大越"沉"在标签层级之下
const LABEL_GHOST_SIZE = 2.2     // 虚影屏上尺寸(× 标签文字块高): 与窗口无关的观感大小
const LABEL_GHOST_NEAR = 12      // 准心与按钮夹角(度)小到此值: 虚影全亮
const LABEL_GHOST_FAR = 23       // 大到此值: 完全隐没(中间 smoothstep 过渡; 4:3 下静置夹角最小 ≈25°)
const LABEL_GHOST_OPACITY = 0.5  // 单通道基础不透明度(加法混合: 三通道重叠处泛白)
const LABEL_GHOST_DISP = 2.2     // 三通道横向错位基准(px, 1080p 基准): 越大色散越散
const LABEL_GHOST_BURST = 3      // 偶发爆发时错位放大倍数(瞬间"炸一下")

// ===== wiki 期间首页(卡片)的开销削减: 按"卡片在屏幕上的占比"分级 =====
// 卡片就是首页本身(活页面, 跑在另一个 WebGL 上下文), 实测它在运镜中每帧约 4~5ms, 是 wiki 期间
// 的主要负载(本模块探针看不到它)。镜头拉远后卡片像素变小、细节看不清, 于是分两级削:
//   占比 < HOME_LOD_LOW    → 首页按 HOME_LOD_SCALE 降分辨率(仍实时渲染, 只是糊一点)
//   占比 < HOME_LOD_FREEZE → 首页整套循环冻结(远处卡面的雪花/体积光不再"呼吸")
// 全部在"镜头确实拉远"之后才触发(近景/特写全程保持全质量 + 实时)。占比见性能日志的「卡」一项。
const HOME_LOD_LOW = 0.5      // 卡片屏宽占视口宽低于此值 → 降分辨率档
const HOME_LOD_FREEZE = 0.22  // 再低于此值 → 冻结档
const HOME_LOD_SCALE = 0.6    // 降分辨率倍数(0.6 ⇒ 片元开销降到约 36%)
const HOME_LOD_HYST = 0.06    // 迟滞: 避免阈值附近来回抖

// ---- 调度机制(一般不用动) ----
// 段表: run(匀速) | in(渐停) | hold(平台) | out(渐起), 各段记录内容区间 ↔ 墙钟区间的对应
let playSegs = []
let shakeKeys = []
let timelineTotal = 0
let wallTime = 0 // 墙钟: 实际流逝的播放时间(含暂停平台)

// 渐停/渐起的内容消耗曲线(各消耗段长的一半, 端点速度 1 与 0, 接缝无顿挫)
function gIn(x) { return 2 * x - 2 * x * x * x + x * x * x * x } // 2x - 2x^3 + x^4: 起步速度 2、收尾为 0
function gOut(x) { return x * x * x * (2 - x) }                  // 2x^3 - x^4: 起步为 0、收尾速度 2

// 由 PAUSE_KEYS/SHAKE_KEYS 重建段表与手抖激活时刻
function buildSchedule() {
  const total = timeline ? timeline.totalTime : 0
  timelineTotal = total
  const keys = PAUSE_KEYS.map(function (k) {
    return {
      t: Math.max(0, Math.min(total, Number(k.t) || 0)),
      hold: Math.max(0, Number(k.hold) || 0),
      easeIn: Math.max(0, Number(k.easeIn) || 0),
      easeOut: Math.max(0, Number(k.easeOut) || 0)
    }
  }).sort(function (a, b) { return a.t - b.t })

  playSegs = []
  let c = Math.min(PLAY_FROM, total) // 内容游标(起点 = 起播帧: 开场前段直接跳过)
  let w = 0 // 墙钟游标
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    const cIn0 = Math.max(c, k.t - 0.5 * k.easeIn) // 渐停窗口起点(与前键重叠时夹住)
    if (cIn0 > c + 1e-9) {
      playSegs.push({ type: 'run', c0: c, c1: cIn0, w0: w, w1: w + (cIn0 - c) })
      w += cIn0 - c; c = cIn0
    }
    if (c < k.t - 1e-9) { // 渐停: 内容吃 k.t-c, 墙钟花两倍(平均半速)
      const span = k.t - c
      playSegs.push({ type: 'in', c0: c, c1: k.t, w0: w, w1: w + 2 * span })
      w += 2 * span; c = k.t
    }
    if (k.hold > 0) {
      playSegs.push({ type: 'hold', c0: c, c1: c, w0: w, w1: w + k.hold })
      w += k.hold
    }
    const spanOut = Math.min(0.5 * k.easeOut, total - c) // 渐起
    if (spanOut > 1e-9) {
      playSegs.push({ type: 'out', c0: c, c1: c + spanOut, w0: w, w1: w + 2 * spanOut })
      w += 2 * spanOut; c += spanOut
    }
  }
  if (c < total - 1e-9) playSegs.push({ type: 'run', c0: c, c1: total, w0: w, w1: w + (total - c) })

  // 手抖键: 排序 + 预算墙钟激活时刻
  shakeKeys = SHAKE_KEYS.map(function (k) {
    return { t: Math.max(0, Math.min(total, Number(k.t) || 0)), on: !!k.on, fade: Math.max(0, Number(k.fade) || 0), wall: 0 }
  }).sort(function (a, b) { return a.t - b.t })
  shakeKeys.forEach(function (k) { k.wall = wallAtContent(k.t) })
}

// 数值轨采样(散焦半径/曝光): 相邻键之间 smoothstep 缓入缓出; 无键返回 null(调用方用默认值), 键外取端点值
function sampleTrack(keys, c) {
  if (!keys.length) return null
  if (c <= keys[0].t) return keys[0].v
  const last = keys[keys.length - 1]
  if (c >= last.t) return last.v
  for (let i = 1; i < keys.length; i++) {
    if (c <= keys[i].t) {
      const a = keys[i - 1], b = keys[i]
      const x = (c - a.t) / Math.max(1e-9, b.t - a.t)
      const s = x * x * (3 - 2 * x)
      return a.v + (b.v - a.v) * s
    }
  }
  return last.v
}

// 墙钟 → 内容时刻
function contentAt(wall) {
  if (!playSegs.length) return Math.min(wall, timelineTotal)
  for (let i = 0; i < playSegs.length; i++) {
    const s = playSegs[i]
    if (wall < s.w1 || i === playSegs.length - 1) {
      if (wall >= s.w1) return s.c1
      const x = Math.min(1, Math.max(0, (wall - s.w0) / Math.max(1e-9, s.w1 - s.w0)))
      if (s.type === 'hold') return s.c1
      if (s.type === 'in') return s.c0 + gIn(x) * (s.c1 - s.c0)
      if (s.type === 'out') return s.c0 + gOut(x) * (s.c1 - s.c0)
      return s.c0 + x * (s.c1 - s.c0)
    }
  }
  return timelineTotal
}

// 内容时刻 → 墙钟(取首次到达; 平台段内取平台起点)。仅拖动/建表时调用
function wallAtContent(target) {
  if (!playSegs.length) return target
  for (let i = 0; i < playSegs.length; i++) {
    const s = playSegs[i]
    if (target <= s.c1 + 1e-9) {
      if (target <= s.c0 + 1e-9 || s.c1 - s.c0 < 1e-9) return s.w0
      const frac = (target - s.c0) / (s.c1 - s.c0)
      if (s.type === 'run') return s.w0 + frac * (s.w1 - s.w0)
      let lo = 0, hi = 1 // g 单调, 二分反解
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) * 0.5
        const g = s.type === 'in' ? gIn(mid) : gOut(mid)
        if (g < frac) lo = mid; else hi = mid
      }
      return s.w0 + (lo + hi) * 0.5 * (s.w1 - s.w0)
    }
  }
  return playSegs[playSegs.length - 1].w1
}

// 手抖增益: 取"内容位置之前的最后一个键"的状态, 按墙钟在 fade 内平滑渐变。
// 渐变是"从前一键的状态过渡到本键": 前态与本键相同(如 关→关)则恒定, 不闪变。
function shakeGain(content, wall) {
  if (!shakeKeys.length) return 1 // 未设键 = 全程开
  let idx = -1
  for (let i = 0; i < shakeKeys.length; i++) {
    if (shakeKeys[i].t <= content + 1e-9) idx = i
    else break
  }
  if (idx < 0) return 0 // 首键之前默认关
  const k = shakeKeys[idx]
  const prevOn = idx > 0 ? shakeKeys[idx - 1].on : false
  if (k.on === prevOn || k.fade <= 0) return k.on ? 1 : 0
  const x = Math.min(1, Math.max(0, (wall - k.wall) / k.fade))
  const m = x * x * (3 - 2 * x)
  return k.on ? m : 1 - m
}
buildSchedule()

// ===== 整页卡 = 实时页面本身 =====
// 卡的世界矩形由运镜第一帧(waypoints[0])反推: 位置 = 视线与地面 y=0 的交点, 朝向 = 相机右/上
// 投影到地面(滚转自动消除), 尺寸 = 恰满视场(高由 fov 距离决定, 宽 = 高 × 视口比例)。
// 重录 DEFAULT_WAYPOINTS 后卡自动重新对准, 起手镜头拉得越高卡就越大。
// 调起始帧模式下传 fromCamera=true: 按实时相机反推 —— 页面始终恰好满屏, 所见即起始帧。
let cardC = null // 卡中心(世界)
let cardR = null // 卡面右向 = 相机右(已在卡面内)
let cardU = null // 卡面上向 = 相机 up 投影到卡面
let cardW = 0    // 卡宽/高(米), 进入时按当期视口比例定版
let cardH = 0

function buildCardRect(fromCamera) {
  const P0 = fromCamera ? camera.position : waypoints[0].pos
  const Q0 = fromCamera ? camera.quaternion : waypoints[0].quat
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(Q0) // 视线
  const r = new THREE.Vector3(1, 0, 0).applyQuaternion(Q0)
  const u = new THREE.Vector3(0, 1, 0).applyQuaternion(Q0)
  let d0 = -P0.y / f.y // 视线与地面 y=0 的交点距离
  if (!isFinite(d0) || d0 < 0.5 || d0 > 60) d0 = 2.16 // 兜底: 第一帧几乎水平时退回贴地特写距离

  const n = f.clone().negate()
  cardU = u.clone().addScaledVector(n, -u.dot(n)).normalize()
  cardC = P0.clone().addScaledVector(f, d0)
  cardR = r
  cardH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * d0 // 恰填满垂直视场
  cardW = cardH * camera.aspect
}

// 单位方形→四边形(Heckbert): (0,0)(1,0)(1,1)(0,1) → q0..q3, 再并上 元素px→单位方形 的缩放
function homographyCSS(W, H, q) {
  const x0 = q[0][0], y0 = q[0][1], x1 = q[1][0], y1 = q[1][1]
  const x2 = q[2][0], y2 = q[2][1], x3 = q[3][0], y3 = q[3][1]
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3
  let a, b, c, d, e, f, g, h
  if (dx3 === 0 && dy3 === 0) { // 四角成平行四边形(无透视分量)
    a = x1 - x0; b = x2 - x1; c = x0
    d = y1 - y0; e = y2 - y1; f = y0
    g = 0; h = 0
  } else {
    const den = dx1 * dy2 - dx2 * dy1
    if (!den) return '' // 卡面在屏幕上压成线: 本帧不写, 保持上一帧
    g = (dx3 * dy2 - dx2 * dy3) / den
    h = (dx1 * dy3 - dx3 * dy1) / den
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0
    d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0
  }
  return 'matrix3d(' + (a / W) + ',' + (d / W) + ',0,' + (g / W) + ',' +
         (b / H) + ',' + (e / H) + ',0,' + (h / H) + ',0,0,1,0,' + c + ',' + f + ',0,1)'
}

// 每帧: 卡四角投影到屏幕 → 单应写进载体 —— 页面即卡面(与 GL 同一台相机)
// 走路假象: 内容越过 CARD_MOVE_FROM 后卡整体后移(播放/拖动/暂停都随内容轴走, 冻结时一起停)
const _cv = new THREE.Vector3()
const _cp = new THREE.Vector3()
const _cardDir = new THREE.Vector3(CARD_MOVE_DIR[0], 0, CARD_MOVE_DIR[1]).normalize()
const _cardCNow = new THREE.Vector3()
const _cq = [[0, 0], [0, 0], [0, 0], [0, 0]] // 角点屏幕坐标(TL,TR,BR,BL)
let _cardScreenFrac = 1 // 卡片屏宽 / 视口宽: 镜头越远越小, 用来分级削减首页开销(见 HOME_LOD_*)
function updateCardTransform() {
  if (worldCleared) return // 聚焦收尾后: 世界已撤, 卡投影/地面吸附全部停(每帧零开销)
  const W = window.innerWidth, H = window.innerHeight
  const hw = cardW / 2, hh = cardH / 2
  _cardCNow.copy(cardC).addScaledVector(_cardDir, CARD_MOVE_SPEED * Math.max(0, playTime - CARD_MOVE_FROM))
  updateGround(_cardCNow) // 地面独立更新: 活卡滑到相机身后也要继续铺
  let minDepth = Infinity
  for (let i = 0; i < 4; i++) {
    const sR = (i === 0 || i === 3) ? -1 : 1 // TL,BL 在左; TR,BR 在右
    const sU = (i <= 1) ? 1 : -1            // TL,TR 在上; BL,BR 在下
    _cv.copy(_cardCNow).addScaledVector(cardR, sR * hw).addScaledVector(cardU, sU * hh)
    _cp.copy(_cv).applyMatrix4(camera.matrixWorldInverse)
    minDepth = Math.min(minDepth, -_cp.z)
    _cv.project(camera)
    _cq[i][0] = (_cv.x + 1) * 0.5 * W
    _cq[i][1] = (1 - _cv.y) * 0.5 * H
  }
  // 卡滑进相机身后时投影无意义: 临镜前 CARD_FADE_D 内渐隐, 越过镜面直接隐藏; 滑回来自动恢复
  if (minDepth < 0.05) { wrap.style.visibility = 'hidden'; _cardScreenFrac = 0; return }
  wrap.style.visibility = ''
  wrap.style.opacity = minDepth < CARD_FADE_D ? String(minDepth / CARD_FADE_D) : ''
  const css = homographyCSS(W, H, _cq)
  if (css) wrap.style.transform = css
  _cardScreenFrac = Math.abs(_cq[1][0] - _cq[0][0]) / W // 卡片上边在屏幕上的宽度占比
}

// ===== 首页质量分级(近景全质量/实时 → 拉远降分辨率 → 更远冻结) =====
let homeLod = 1          // 当前档: 1(全质量) / HOME_LOD_SCALE(降分辨率) / 0(冻结)
let homeReleased = false // 聚焦收尾已永久停机(不可被 LOD 逻辑解冻)
function setHomeLod(v) {
  homeLod = v
  if (!window.HomeGate) return
  if (v === 0) window.HomeGate.pause()
  else { window.HomeGate.setScale(v); window.HomeGate.resume() }
}
function applyHomeLod() {
  if (homeReleased) return
  const f = _cardScreenFrac
  let next = homeLod
  if (homeLod === 0) next = f > HOME_LOD_FREEZE + HOME_LOD_HYST ? (f > HOME_LOD_LOW + HOME_LOD_HYST ? 1 : HOME_LOD_SCALE) : 0
  else if (homeLod === HOME_LOD_SCALE) next = f < HOME_LOD_FREEZE ? 0 : (f > HOME_LOD_LOW + HOME_LOD_HYST ? 1 : HOME_LOD_SCALE)
  else next = f < HOME_LOD_FREEZE ? 0 : (f < HOME_LOD_LOW ? HOME_LOD_SCALE : 1)
  if (next !== homeLod) setHomeLod(next)
}

// ===== 世界地面: 整页平铺(烘焙一张贴图, GL 无限重复) =====
// 合成顺序与原页面一致: tyndall3d 画布(已含体积光/标题/模型/顶层色散) → DOM 层(菜单/署名/唱片)
// → 雪花层(screen 混合)。两张 WebGL 画布没有 preserveDrawingBuffer, 在下一帧 rAF 里(页面各渲染
// 循环跑完之后)同一帧内立即取走 —— 此刻绘制缓冲尚未被合成清空, 零常驻性能开销。
// DOM 层交给 modern-screenshot(foreignObject 原生渲染, 保留 CSS 特效/字体/图片), 画布元素在
// 其克隆里为空, 由我们手动垫底。烘焙只在首次进入时做一次。
let groundTex = null
let groundMesh = null
let groundUniforms = null
let groundR = null // 地面平铺的右向(卡基投影到 y=0 后正交化)
let groundU = null // 地面平铺的上向
let groundCardW = 0, groundCardH = 0 // 建面时的卡尺寸; 调过起始帧后自动重建对齐
let groundBaking = false

function bakeGroundTile() {
  if (groundBaking || groundTex || !waypoints.length) return
  groundBaking = true
  const W = window.innerWidth, H = window.innerHeight
  const bw = Math.min(GROUND_TEX_MAX, Math.max(1024, Math.round(W)))
  const bh = Math.round(H * bw / W)
  const out = document.createElement('canvas')
  out.width = bw; out.height = bh
  const ctx = out.getContext('2d')
  const tyndall = wrap.querySelector('#tyndall3d') // 整页 3D 的最终画布(含光标色散后处理)
  const snow = wrap.querySelector('#snow')
  const snowCopy = document.createElement('canvas')
  snowCopy.width = bw; snowCopy.height = bh
  const sctx = snowCopy.getContext('2d')

  const shotP = import('https://cdn.jsdelivr.net/npm/modern-screenshot@4/+esm')
    .then(function (mod) {
      return mod.domToCanvas(wrap, { width: W, height: H, scale: bw / W, backgroundColor: 'transparent' })
    })

  new Promise(function (r) { requestAnimationFrame(r) }).then(function () {
    if (tyndall) ctx.drawImage(tyndall, 0, 0, bw, bh)
    if (snow) sctx.drawImage(snow, 0, 0, bw, bh) // 雪必须当帧拷贝(缓冲随后失效), 之后再做 screen 合成
    return shotP
  }).then(function (shot) {
    ctx.drawImage(shot, 0, 0, bw, bh)
    ctx.globalCompositeOperation = 'screen' // 雪层原为 mix-blend-mode: screen
    ctx.drawImage(snowCopy, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    groundTex = new THREE.CanvasTexture(out)
    groundTex.colorSpace = THREE.SRGBColorSpace
    groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping
    groundTex.generateMipmaps = true
    groundTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    groundTex.needsUpdate = true
  }).catch(function (e) {
    console.warn('[wiki] 世界地面烘焙失败(CDN 或页面资源不可用?) → 本局无地面', e)
  })
}

// 建/重建地面网格: 卡尺寸变化(如应用了新的起始帧)后按新尺寸重新对准
function ensureGroundMesh() {
  if (!groundTex) return
  if (groundMesh && groundCardW === cardW && groundCardH === cardH) return
  if (groundMesh) {
    scene.remove(groundMesh)
    groundMesh.geometry.dispose()
    groundMesh.material.dispose()
  }
  // 卡基投影到 y=0: 入口视线近垂直, 卡≈水平; 投影后与入口所见朝向逐像素一致(0.5° 级倾斜差由窗口渐隐带吸收)
  groundR = new THREE.Vector3(cardR.x, 0, cardR.z)
  if (groundR.lengthSq() < 1e-6) groundR.set(1, 0, 0)
  groundR.normalize()
  groundU = new THREE.Vector3(cardU.x, 0, cardU.z)
  groundU.addScaledVector(groundR, -groundU.dot(groundR)) // Gram-Schmidt: 两基在水平面里正交
  if (groundU.lengthSq() < 1e-6) groundU.set(0, 0, 1)
  groundU.normalize()

  const mat = new THREE.MeshBasicMaterial({
    map: groundTex,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false // 不参与光照/色调映射: 颜色与 DOM 卡逐像素同源
  })
  mat.onBeforeCompile = function (sh) {
    sh.uniforms.uCardLocal = { value: new THREE.Vector2(0, 0) }
    sh.uniforms.uHalf = { value: new THREE.Vector2(cardW / 2, cardH / 2) }
    sh.uniforms.uBand = { value: GROUND_WINDOW_BAND }
    sh.uniforms.uCamLocal = { value: new THREE.Vector2(0, 0) }
    sh.uniforms.uFade = { value: new THREE.Vector2(GROUND_FADE_NEAR, GROUND_FADE_FAR) }
    groundUniforms = sh.uniforms
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGLocal = transformed.xy;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', [
        '#include <common>',
        'varying vec2 vGLocal;',
        'uniform vec2 uCardLocal;',
        'uniform vec2 uHalf;',
        'uniform float uBand;',
        'uniform vec2 uCamLocal;',
        'uniform vec2 uFade;'
      ].join('\n'))
      .replace('#include <opaque_fragment>', [
        '#include <opaque_fragment>',
        '{',
        '  vec2 d = abs(vGLocal - uCardLocal) - uHalf;',
        '  float win = smoothstep(0.0, uBand, max(d.x, d.y));', // 活卡矩形内 alpha=0: 让 DOM 活页面透出
        '  float far = 1.0 - smoothstep(uFade.x, uFade.y, length(vGLocal - uCamLocal));',
        '  gl_FragColor.a *= win * far;',
        '}'
      ].join('\n'))
  }
  // tile 取奇数个: 图案中心恰落在卡心(0.5·n ≡ 0.5 mod 1) —— 入口时活卡与它脚下的贴图逐像素同源
  const ntx = Math.max(1, Math.round(GROUND_SIZE / cardW) | 1)
  const ntz = Math.max(1, Math.round(GROUND_SIZE / cardH) | 1)
  groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(ntx * cardW, ntz * cardH), mat)
  groundMesh.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(groundR, groundU, new THREE.Vector3().crossVectors(groundR, groundU))
  )
  groundMesh.frustumCulled = false // 平面每帧吸附到相机脚下, 包围盒判定没意义
  groundTex.repeat.set(ntx, ntz)
  scene.add(groundMesh)
  groundCardW = cardW
  groundCardH = cardH
}

// 每帧地面: 网格吸附循环铺 + 活卡透明窗口跟随 + 贴图流动(与 CARD_MOVE 同一运动, 内容轴纯函数)
function updateGround(cNow) {
  if (!groundTex) return
  if (worldCleared) return // 聚焦收尾后不再每帧吸附/更新
  if (startEdit) { // 调起始帧: 卡基每帧在变, 先藏起来, 应用后再重建
    if (groundMesh) groundMesh.visible = false
    return
  }
  ensureGroundMesh()
  if (!groundMesh || !groundUniforms) return
  groundMesh.visible = true

  // 相机地面点 → 吸附到整 tile(周期图案平移整 tile 不可见), 平面永远盖住取景范围
  const p = groundMesh.position
  const cgx = camera.position.x - cardC.x, cgz = camera.position.z - cardC.z
  const qx = cgx * groundR.x + cgz * groundR.z
  const qz = cgx * groundU.x + cgz * groundU.z
  const nx = Math.round(qx / cardW), nz = Math.round(qz / cardH)
  p.set(
    cardC.x + groundR.x * nx * cardW + groundU.x * nz * cardH, 0,
    cardC.z + groundR.z * nx * cardW + groundU.z * nz * cardH
  )

  // 透明窗口(卡矩形, 平面局部坐标)跟随活卡当前位置
  groundUniforms.uCardLocal.value.set(
    (cNow.x - p.x) * groundR.x + (cNow.z - p.z) * groundR.z,
    (cNow.x - p.x) * groundU.x + (cNow.z - p.z) * groundU.z
  )
  groundUniforms.uCamLocal.value.set(qx - nx * cardW, qz - nz * cardH)

  // 行走流动: 图案世界速度 = CARD_MOVE_DIR·SPEED, 换算到贴图 offset(每米 = 1/卡尺寸 个 uv)
  const tau = Math.max(0, playTime - CARD_MOVE_FROM)
  groundTex.offset.set(
    -CARD_MOVE_SPEED * _cardDir.dot(groundR) / cardW * tau,
    -CARD_MOVE_SPEED * _cardDir.dot(groundU) / cardH * tau
  )
}

// ===== 海波洋面(Shadertoy「Seascape」移植): 点击 wiki 后盖在 y=SEA_Y 的场景顶棚 =====
// 原作 "Seascape" by Alexander Alekseev aka TDM, 2014 — https://www.shadertoy.com/view/Ms2SD1
// 注释版 bteitler / HSV 调色 CaliCoastReplay, 2016 — CC BY-NC-SA 3.0 Unported。
// 移植方式: 原版是全屏 ray march; 这里改成"平面顶点位移(原版 map 的 2 迭代波高) + 片元用
// 原版 map_detailed 的 SEA_ITER 迭代波高求法线", 波高场与日间调色管线逐字保留;
// 丢掉 iMouse/键盘/昼夜切换/鱼眼/相机巡游这些与场景无关的输入。
// 相机始终在洋面之下仰视: 片元把视线按水平面镜像后再走原版"从上看海"的公式(观感 = 头顶玻璃海)。
// 不投影不接影, 与交互无关; 每帧只推 uTime 一个 uniform, 零 CPU 开销。
const SEA_Y = 12            // 洋面高度(米): 人物/卡都在它下面
const SEA_SIZE = 220        // 平面边长(米): 要盖满 SEA_FADE_FAR + 相机活动范围
const SEA_SEG = 192         // 网格细分: 只影响顶点位移的几何精度(细节主体在片元法线里)
const SEA_AMPLITUDE = 1     // 波高总倍数: 0 = 平静如镜
const SEA_SPEED = 1.9       // 波动速度(原版 SEA_SPEED, 逐字)
const SEA_HEIGHT = 0.5      // 原版 SEA_HEIGHT: 波高基准与峰值提亮基准
const SEA_ITER = 5          // 片元法线迭代数(原版 map_detailed 的 ITER_FRAGMENT): 卡顿降 3~4
const SEA_EPS_NRM = 0.5 / 1920 // 法线差分步长系数(原版 EPSILON_NRM = 0.5/iResolution.x)
const SEA_BRIGHT = 1        // 调色管线之后的总明度倍数
const SEA_FADE_NEAR = 42    // 水平距离渐隐起(米)
const SEA_FADE_FAR = 80     // 渐隐完的距离: 再远完全没入虚空黑
const SEA_LIGHT = new THREE.Vector3(0, 1, 0.8).normalize() // 原版光源方向: 反光带朝它偏的"太阳"
const SEA_BASE = new THREE.Color(0.11, 0.19, 0.22)       // 原版 SEA_BASE: 水体基色
const SEA_WATER_COLOR = new THREE.Color(0.55, 0.9, 0.7)   // 原版 SEA_WATER_COLOR: 水色

// hash/noise/sea_octave 与两档波高场: 原版逐字(顶点与片元共用这一段)
const SEA_GLSL_CORE = [
  'float seaHash(vec2 p) {',
  '  float h = dot(p, vec2(127.1, 311.7));',
  '  return fract(sin(h) * 83758.5453123);',
  '}',
  'float seaNoise(vec2 p) {',
  '  vec2 i = floor(p); vec2 f = fract(p);',
  '  vec2 u = f * f * (3.0 - 2.0 * f);',
  '  return -1.0 + 2.0 * mix(',
  '    mix(seaHash(i), seaHash(i + vec2(1.0, 0.0)), u.x),',
  '    mix(seaHash(i + vec2(0.0, 1.0)), seaHash(i + vec2(1.0, 1.0)), u.x),',
  '    u.y);',
  '}',
  // 尖峰圆谷的水形函数: 低频噪声推挤坐标 → 两组波函数混合 → 幂次整形(原版逐字)
  'float seaOctave(vec2 uv, float choppy) {',
  '  uv += seaNoise(uv);',
  '  vec2 wv = 1.0 - abs(sin(uv));',
  '  vec2 swv = abs(cos(uv));',
  '  wv = mix(wv, swv, wv);',
  '  return pow(1.0 - pow(wv.x * wv.y, 0.65), choppy);',
  '}',
  // 波高场(原版 map / map_detailed 去掉 p.y 项只留高度; 八度旋转矩阵/频率振幅递进逐字)。
  // geo = 2 迭代(原版 ITER_GEOMETRY, 供顶点); detail = SEA_ITER 迭代 + 正负时间双向叠加(原版 ITER_FRAGMENT, 供法线)
  'float seaHeightGeo(vec2 base, float t) {',
  '  float freq = 0.24; float amp = uHeight; float choppy = 3.0;',
  '  vec2 uv = base; uv.x *= 0.75;',
  '  float h = 0.0;',
  '  for (int i = 0; i < 2; i++) {',
  '    h += seaOctave((uv + t) * freq, choppy) * amp;',
  '    uv = mat2(1.7, 1.2, -1.2, 1.4) * uv;',
  '    freq *= 1.9; amp *= 0.22; choppy = mix(choppy, 1.0, 0.2);',
  '  }',
  '  return h;',
  '}',
  'float seaHeightDetail(vec2 base, float t) {',
  '  float freq = 0.24; float amp = uHeight; float choppy = 3.0;',
  '  vec2 uv = base; uv.x *= 0.75;',
  '  float h = 0.0;',
  '  for (int i = 0; i < ' + SEA_ITER + '; i++) {',
  '    float d = seaOctave((uv + t) * freq, choppy);',
  '    d += seaOctave((uv - t) * freq, choppy);',
  '    h += d * amp;',
  '    uv = mat2(1.7, 1.2, -1.2, 1.4) * uv * (1.0 / 1.2);',
  '    freq *= 1.9; amp *= 0.22; choppy = mix(choppy, 1.0, 0.2);',
  '  }',
  '  return h;',
  '}'
].join('\n')

const seaGeo = new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE, SEA_SEG, SEA_SEG)
seaGeo.rotateX(-Math.PI / 2) // 直接建在 XZ 面: 顶点 shader 里 position.xz 就是世界水平坐标
const seaUniforms = {
  uTime: { value: 0 },
  uSpeed: { value: SEA_SPEED },
  uAmp: { value: SEA_AMPLITUDE },
  uHeight: { value: SEA_HEIGHT },
  uBright: { value: SEA_BRIGHT },
  uEpsNrm: { value: SEA_EPS_NRM },
  uFade: { value: new THREE.Vector2(SEA_FADE_NEAR, SEA_FADE_FAR) },
  uLight: { value: SEA_LIGHT.clone() },
  uSeaBase: { value: SEA_BASE },
  uWater: { value: SEA_WATER_COLOR }
}
const seaMesh = new THREE.Mesh(seaGeo, new THREE.ShaderMaterial({
  uniforms: seaUniforms,
  side: THREE.DoubleSide, // 相机在面之下看的是背面, 两面都要渲染
  vertexShader: [
    'uniform float uTime; uniform float uSpeed; uniform float uAmp; uniform float uHeight;',
    SEA_GLSL_CORE,
    'varying vec3 vWorld; varying float vH;',
    'void main() {',
    '  float t = uTime * uSpeed;',
    '  float h = seaHeightGeo(position.xz, t) * uAmp;',
    '  vec3 world = (modelMatrix * vec4(position.x, position.y + h, position.z, 1.0)).xyz;',
    '  vWorld = world; vH = h;',
    '  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);',
    '}'
  ].join('\n'),
  fragmentShader: [
    'uniform float uTime; uniform float uSpeed; uniform float uAmp; uniform float uHeight;',
    'uniform float uBright; uniform float uEpsNrm; uniform vec2 uFade;',
    'uniform vec3 uLight; uniform vec3 uSeaBase; uniform vec3 uWater;',
    SEA_GLSL_CORE,
    'varying vec3 vWorld; varying float vH;',
    // rgb2hsv/hsv2rgb: 原版逐字(CaliCoastReplay 的调色函数)
    'vec3 seaRgb2hsv(vec3 c) {',
    '  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);',
    '  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));',
    '  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));',
    '  float d = q.x - min(q.w, q.y);',
    '  float e = 1.0e-10;',
    '  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);',
    '}',
    'vec3 seaHsv2rgb(vec3 c) {',
    '  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);',
    '  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);',
    '  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);',
    '}',
    // 原版 diffuse/specular/getSkyColor 逐字
    'float seaDiffuse(vec3 n, vec3 l, float p) { return pow(dot(n, l) * 0.4 + 0.6, p); }',
    'float seaSpecular(vec3 n, vec3 l, vec3 e, float s) {',
    '  float nrm = (s + 8.0) / (3.1415 * 8.0);',
    '  return pow(max(dot(reflect(e, n), l), 0.0), s) * nrm;',
    '}',
    'vec3 seaSky(vec3 e) {',
    '  e.y = max(e.y, 0.0);',
    '  return vec3(pow(1.0 - e.y, 2.0), 1.0 - e.y, 0.6 + (1.0 - e.y) * 0.4);',
    '}',
    'void main() {',
    '  float t = uTime * uSpeed;',
    '  vec3 eye = normalize(vWorld - cameraPosition);',
    '  if (eye.y > 0.0) eye.y = -eye.y; // 从下仰视: 视线镜像成"从上看海", 之后全走原版公式',
    '  vec3 dist = vWorld - cameraPosition;',
    '  float eps = dot(dist, dist) * uEpsNrm; // 远点步长加大: 原版按距离放粗法线, 防远处闪碎',
    // 法线: 原版 getNormal 的 map_detailed 有限差分(n.y 直接取 eps 是原版省算写法)
    '  float h0 = seaHeightDetail(vWorld.xz, t) * uAmp;',
    '  float hx = seaHeightDetail(vWorld.xz + vec2(eps, 0.0), t) * uAmp;',
    '  float hz = seaHeightDetail(vWorld.xz + vec2(0.0, eps), t) * uAmp;',
    '  vec3 n = normalize(vec3(h0 - hx, eps, h0 - hz));',
    // ---- 原版 getSeaColor 逐字 ----
    '  float fresnel = pow(1.0 - max(dot(n, -eye), 0.0), 3.0) * 0.45;',
    '  vec3 reflected = seaSky(reflect(eye, n)) * 0.99;',
    '  vec3 refracted = uSeaBase + seaDiffuse(n, uLight, 80.0) * uWater * 0.27;',
    '  vec3 col = mix(refracted, reflected, fresnel);',
    '  float atten = max(1.0 - dot(dist, dist) * 0.001, 0.0);',
    '  col += uWater * (vH - uHeight) * 0.15 * atten;',
    '  col += vec3(seaSpecular(n, uLight, eye, 90.0)) * 0.5;',
    // ---- 原版日间调色管线逐字(昼夜切换/泡沫距离等原样, 只省掉夜间分支) ----
    '  vec3 skyCol = seaSky(eye);',
    '  col = max(col, 0.0);',
    '  col /= sqrt(sqrt(length(dist)));',
    '  col *= sqrt(sqrt(col)) * 4.0;',
    '  skyCol *= 1.05; skyCol -= 0.03; skyCol *= skyCol;',
    '  vec3 seaHsv = seaRgb2hsv(col);', // 近处高值区压暗: 原版"泡沫"hack
    '  if (seaHsv.z > 0.75 && length(dist) < 50.0) seaHsv.z -= (0.9 - seaHsv.z) * 1.3;',
    '  col = seaHsv2rgb(seaHsv);',
    '  vec3 color = mix(skyCol, col, pow(smoothstep(0.0, -0.05, eye.y), 0.3));', // 掠射处混入天光 = 远景雾
    '  color = pow(color, vec3(0.75));',
    '  vec3 hsv = seaRgb2hsv(color);',
    '  hsv.y += 0.131;',
    '  hsv.z *= sqrt(hsv.z) * 1.1;',
    '  hsv.z *= 0.9;',
    '  hsv.x -= hsv.z / 10.0;',
    '  hsv.x += 0.02 + hsv.z / 50.0;',
    '  hsv.z *= 1.01;',
    '  hsv.y += 0.07;',
    '  color = seaHsv2rgb(hsv) * uBright;',
    '  float dFade = length(vWorld.xz - cameraPosition.xz);', // 远边没入虚空黑
    '  color *= 1.0 - smoothstep(uFade.x, uFade.y, dFade);',
    '  gl_FragColor = vec4(max(color, 0.0), 1.0);',
    '}'
  ].join('\n')
}))
seaMesh.position.y = SEA_Y
scene.add(seaMesh)

function updateSea(nowS) {
  seaUniforms.uTime.value = nowS // 走墙钟: 暂停/聚焦收尾里水面照常起伏
}

// ===== 踩卡水波: 脚踩到卡片那一下, 以脚印接触面(footprint.jpg, 白=接触面)为波源, 在地面(卡面)扩散 =====
// 做法: 在卡片处铺一块与该处地面同向的正方形区域(RIPPLE_REGION), 用一张同尺度的场做波动方程模拟
// (与首页 cursorfilter.js 同款 5 点 Laplacian); 触发那一帧把"卡面空间"的脚印贴图(整页截图,
// 白区=脚踩的位置)按卡片矩形 1:1 注入场里, 之后波自然向外扩散; 结果贴回同一块地面(半透明水面
// 高光/暗折), 于是在卡片上看到脚下一圈圈大水波(波源位置由贴图白区决定, 不靠脚骨定位)。
// 只在"踩卡那一下"触发一次(控制台可用 __wikiRipple() 手动触发预览)。
const RIPPLE_ENABLE = true
const RIPPLE_TEX_URL = '../asset/image/footprint/footprint.jpg'
const RIPPLE_REGION = 18          // 模拟区域边长(米): 波最大扩散半径 ≈ 一半
const RIPPLE_SIM = 512            // 场分辨率(纹理边长): 脚掌(≈0.3m)约 8~9 texel, 足以表达接触面形状
const RIPPLE_MASK_YAW = 0         // 脚印朝向补偿(弧度): 贴图相对卡面有旋转时调这个
const RIPPLE_MASK_FLIP = 0        // 1 = 上下翻转贴图(出现镜像时改 1)
const RIPPLE_DAMPING = 0.986      // 每帧衰减(越小波消得越快)
const RIPPLE_STRENGTH = 0.6       // 注入强度(足迹白区初速; 越大波越猛)—— 调大
const RIPPLE_DISPERSION = 0.9     // 色散强度(彩虹边; 鼠标水波是 0.3)—— 调大
const RIPPLE_WATER_DEPTH = 0.04   // 折射位移深度(米): 波峰波谷处背景被推开的距离
const RIPPLE_LIFE = 5.0           // 水波存活时长(墙钟秒): 之后整块关掉(零开销)
const RIPPLE_LEAD = 0.04          // 提前量(内容秒): 相机渐停到暂停点速度归零, 提前这么点触发
// 触发时刻(内容秒) = 镜头停止前一刻: 取第一个暂停点(PAUSE_KEYS[0].t)往前 RIPPLE_LEAD 秒。
// 这样"踩卡那一下"与运镜的凝滞(暂停段)同步, 而不是靠脚骨检测乱猜相位。
const RIPPLE_TRIGGER_T = (PAUSE_KEYS.length ? PAUSE_KEYS[0].t : 1.3) - RIPPLE_LEAD
const RIPPLE_Y = 0.02             // 波面离地高(米): 高于脚底接触影(0.012), 防同面闪烁

const footprintTex = new THREE.TextureLoader().load(RIPPLE_TEX_URL, function (t) {
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.minFilter = THREE.LinearFilter
  t.magFilter = THREE.LinearFilter
  t.colorSpace = THREE.NoColorSpace // 当参数图读原始黑白值, 不做 sRGB 解码
})

const _rippleQuadScene = new THREE.Scene()
const _rippleQuadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

const rippleSimMat = new THREE.ShaderMaterial({
  uniforms: {
    u_current: { value: null },
    u_texel: { value: new THREE.Vector2(1 / RIPPLE_SIM, 1 / RIPPLE_SIM) },
    u_damping: { value: RIPPLE_DAMPING },
    u_inject: { value: 0 }, // 1 = 本帧把脚印注入场(只在触发那一帧)
    u_mask: { value: footprintTex },
    u_maskSize: { value: new THREE.Vector2(1, 1) }, // 脚印贴图在区域内占的 uv 边长(含贴图比例)
    u_maskRot: { value: 0 },                        // 脚印在区域内的朝向(弧度)
    u_flip: { value: RIPPLE_MASK_FLIP },
    u_strength: { value: RIPPLE_STRENGTH }
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }',
  fragmentShader: [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D u_current, u_mask;',
    'uniform vec2 u_texel, u_maskSize;',
    'uniform float u_damping, u_inject, u_maskRot, u_flip, u_strength;',
    'void main() {',
    '  float l = texture2D(u_current, vUv - vec2(u_texel.x, 0.0)).r;',
    '  float r = texture2D(u_current, vUv + vec2(u_texel.x, 0.0)).r;',
    '  float u = texture2D(u_current, vUv + vec2(0.0, u_texel.y)).r;',
    '  float d = texture2D(u_current, vUv - vec2(0.0, u_texel.y)).r;',
    '  float cur = texture2D(u_current, vUv).r;',
    '  float prev = texture2D(u_current, vUv).g;',
    '  float next = (l + r + u + d) * 0.5 - prev;',
    '  next *= u_damping;',
    '  if (u_inject > 0.5) {',
    '    vec2 p = vUv - 0.5;',
    '    float c = cos(u_maskRot), s = sin(u_maskRot);',
    '    vec2 rp = vec2(c * p.x - s * p.y, s * p.x + c * p.y);',
    '    vec2 muv = rp / u_maskSize + 0.5;',
    '    if (u_flip > 0.5) muv.y = 1.0 - muv.y;',
    '    if (muv.x > 0.0 && muv.x < 1.0 && muv.y > 0.0 && muv.y < 1.0) {',
    '      next += texture2D(u_mask, muv).r * u_strength;', // 白 = 接触面 → 初速注入
    '    }',
    '  }',
    '  gl_FragColor = vec4(next, cur, 0.0, 1.0);',
    '}'
  ].join('\n')
})
_rippleQuadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), rippleSimMat))

// 波面外观: 直接复用首页鼠标水波(cursorfilter.js)那套 —— 由波场求法线 → 斯涅尔折射 → 8 频段
// 光谱色散(彩虹边)。区别只有"背景"不是整帧画面, 而是脚下那片地面/卡面贴图(groundTex):
// 折射采样它并在波平处把 alpha 压到 0, 于是只有波峰波谷处浮出被折射的卡面, 看起来就是卡片本身在泛水波。
const rippleOutMat = new THREE.ShaderMaterial({
  uniforms: {
    u_sim: { value: null },
    u_bg: { value: null },
    u_texel: { value: new THREE.Vector2(1 / RIPPLE_SIM, 1 / RIPPLE_SIM) },
    u_bgOff: { value: new THREE.Vector2(0, 0) },   // 区域中心对应的地面贴图 uv
    u_bgScale: { value: new THREE.Vector2(1, 1) }, // 区域局部米 → 贴图 uv 的换算(1/卡宽, 1/卡高)
    u_region: { value: RIPPLE_REGION },
    u_dispersion: { value: RIPPLE_DISPERSION }, // 物理色散强度(比鼠标水波的 0.3 大)
    u_waterDepth: { value: RIPPLE_WATER_DEPTH }, // 折射位移深度(米)
    u_fade: { value: 1 }
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D u_sim, u_bg;',
    'uniform vec2 u_texel, u_bgOff, u_bgScale;',
    'uniform float u_dispersion, u_waterDepth, u_region, u_fade;',
    'vec3 spectralWeight(float t) {',
    '  return vec3(',
    '    smoothstep(0.45, 0.15, t) + smoothstep(0.75, 1.0, t) * 0.35,',
    '    smoothstep(0.05, 0.5, t) * smoothstep(0.95, 0.5, t) * 1.35,',
    '    smoothstep(0.35, 0.75, t)',
    '  );',
    '}',
    'void main() {',
    '  float l = texture2D(u_sim, vUv - vec2(u_texel.x, 0.0)).r;',
    '  float r = texture2D(u_sim, vUv + vec2(u_texel.x, 0.0)).r;',
    '  float up = texture2D(u_sim, vUv + vec2(0.0, u_texel.y)).r;',
    '  float dn = texture2D(u_sim, vUv - vec2(0.0, u_texel.y)).r;',
    '  vec3 normal = normalize(vec3((l - r) * 2.8, (dn - up) * 2.8, 1.0));',
    '  vec3 eyeRay = vec3(0.0, 0.0, -1.0);',
    '  vec2 vLocal = (vUv - 0.5) * u_region;      // 区域局部米坐标(相对区域中心)',
    '  vec3 accCol = vec3(0.0); vec3 totalW = vec3(0.0);',
    '  float maxDisp = 0.0;',
    '  const int SAMPLES = 8;',
    '  for (int i = 0; i < SAMPLES; i++) {',
    '    float t = float(i) / float(SAMPLES - 1);',
    '    float ior = 1.333 + (t - 0.5) * u_dispersion;',
    '    vec3 refr = refract(eyeRay, normal, 1.0 / ior);',
    '    vec2 off = (refr.xy / max(-refr.z, 0.001)) * u_waterDepth;', // 折射位移(米)
    '    maxDisp = max(maxDisp, length(off));',
    '    vec2 buv = u_bgOff + (vLocal + off) * u_bgScale;',
    '    accCol += texture2D(u_bg, buv).rgb * spectralWeight(t);',
    '    totalW += spectralWeight(t);',
    '  }',
    '  float a = smoothstep(0.004, 0.035, maxDisp) * u_fade;', // 波平处 = 透明, 露出活卡
    '  if (a < 0.004) discard;',
    '  gl_FragColor = vec4(accCol / totalW, a);',
    '  #include <colorspace_fragment>', // 贴图是 sRGB(GPU 采样时已解码成线性), 输出前编码回去, 与地面观感一致
    '}'
  ].join('\n'),
  transparent: true,
  depthWrite: false,
  toneMapped: false
})
const rippleMesh = new THREE.Mesh(new THREE.PlaneGeometry(RIPPLE_REGION, RIPPLE_REGION, 1, 1), rippleOutMat)
rippleMesh.visible = false
rippleMesh.renderOrder = 0.8 // 地面(0)/接影板(0.5)/脚底影(0.6)之后, 云(1)/眩光(2)之前
scene.add(rippleMesh)

let rippleFboA = null, rippleFboB = null
let rippleT = -1        // <0 = 未激活; >=0 = 已存活墙钟秒
let rippleArmed = true  // 本次播放内是否还能触发(只在"踩卡那一下"触发一次)
const _rippleN = new THREE.Vector3()
const _rippleM4 = new THREE.Matrix4()

function ensureRippleFBOs() {
  if (rippleFboA) return
  const opt = {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat, type: THREE.HalfFloatType,
    depthBuffer: false, stencilBuffer: false
  }
  rippleFboA = new THREE.WebGLRenderTarget(RIPPLE_SIM, RIPPLE_SIM, opt)
  rippleFboB = new THREE.WebGLRenderTarget(RIPPLE_SIM, RIPPLE_SIM, opt)
}

// 把波场铺在卡片上: 贴图是"卡面空间"的整页截图(2560×1331), 白区在整张图里的位置 = 脚踩的位置,
// 所以整张图按卡片矩形 1:1 铺上去就直接对齐(不缩小、不以脚骨为中心)。波源就是图里的白区。
function triggerRipple() {
  if (!RIPPLE_ENABLE || !groundR || !groundU || !cardW || !cardH || !groundTex || !groundMesh) return false
  ensureRippleFBOs()
  // 区域中心 = 当前卡片中心(含"走路后移"偏移); 波场与卡片同向
  _cardCNow.copy(cardC).addScaledVector(_cardDir, CARD_MOVE_SPEED * Math.max(0, playTime - CARD_MOVE_FROM))
  rippleMesh.position.set(_cardCNow.x, RIPPLE_Y, _cardCNow.z)
  _rippleN.crossVectors(groundR, groundU)
  rippleMesh.quaternion.setFromRotationMatrix(_rippleM4.makeBasis(groundR, groundU, _rippleN))
  rippleMesh.visible = true
  // 波源: 卡面空间的脚印贴图(白区=脚踩位置)按卡片矩形 1:1 铺进区域中央
  rippleSimMat.uniforms.u_maskSize.value.set(cardW / RIPPLE_REGION, cardH / RIPPLE_REGION)
  rippleSimMat.uniforms.u_maskRot.value = RIPPLE_MASK_YAW
  rippleSimMat.uniforms.u_inject.value = 1
  // 折射背景 = 地面/卡面贴图; 把"区域局部米"映射到该贴图的 uv(与 groundMesh 的平铺映射一致:
  // 贴图 uv = 世界局部/(卡宽,卡高) + 常数; 0.5 抵消平铺数取奇带来的半格偏移)
  const p = groundMesh.position
  const qR = (_cardCNow.x - p.x) * groundR.x + (_cardCNow.z - p.z) * groundR.z
  const qU = (_cardCNow.x - p.x) * groundU.x + (_cardCNow.z - p.z) * groundU.z
  rippleOutMat.uniforms.u_bg.value = groundTex
  rippleOutMat.uniforms.u_bgScale.value.set(1 / cardW, 1 / cardH)
  rippleOutMat.uniforms.u_bgOff.value.set(
    qR / cardW + 0.5 + groundTex.offset.x,
    qU / cardH + 0.5 + groundTex.offset.y
  )
  rippleT = 0
  return true
}
// 手动预览(不影响自动触发逻辑): 控制台执行 __wikiRipple() 立即在卡上打一个波
window.__wikiRipple = function () { triggerRipple() }

function updateRipple(delta) {
  if (!RIPPLE_ENABLE) return
  // 触发判定: 内容时间刚到"镜头停止前一刻" → 触发一次(波源位置由贴图白区决定)
  // 地面贴图还没烘好时不消耗这次机会, 下一帧继续试
  if (rippleArmed && model && model.visible && playTime >= RIPPLE_TRIGGER_T) {
    if (triggerRipple()) rippleArmed = false
  }
  if (rippleT < 0) return
  rippleT += delta
  if (rippleT >= RIPPLE_LIFE) { // 寿命到: 整块关掉(不再跑模拟)
    rippleT = -1
    rippleMesh.visible = false
    rippleSimMat.uniforms.u_inject.value = 0
    return
  }
  // 波动方程推进: 读 A 写 B, 交换
  rippleSimMat.uniforms.u_current.value = rippleFboA.texture
  renderer.setRenderTarget(rippleFboB)
  renderer.render(_rippleQuadScene, _rippleQuadCam)
  renderer.setRenderTarget(null)
  const t = rippleFboA; rippleFboA = rippleFboB; rippleFboB = t
  rippleSimMat.uniforms.u_inject.value = 0 // 只在触发那一帧注入
  // 输出到波面(随时间整体淡出)
  rippleOutMat.uniforms.u_sim.value = rippleFboA.texture
  rippleOutMat.uniforms.u_fade.value = 1 - rippleT / RIPPLE_LIFE
}

// 重播/恢复: 收起现有波并重新武装(下次"踩卡"再触发一次)
function resetRipplePlayback() {
  rippleArmed = true
  rippleT = -1
  rippleMesh.visible = false
  rippleSimMat.uniforms.u_inject.value = 0
}

// ===== 主循环: 隐藏时只取走 delta 不干活; 登场后骨骼动画+运镜一起跑 =====
let visible = false
let pendingEnter = false // 点击时模型尚未加载完: 等落地后补起跑
const clock = new THREE.Clock()
let _mixerT = -1 // 骨骼上次摆到的内容时刻(停着时不用每帧空转 setTime)
// 手抖幅度平滑状态: motionFactor 段内恒定、暂停段骤降, 直接切换会让抖动偏移瞬间跳变(卡一下)
let _shakeAmpSmooth = SHAKE_HOLD_SCALE // 平滑后的运动因子
let _shakeAmpPrevWall = -1             // 上一帧墙钟(算 dt); -1 = 尚未初始化

// 按内容时刻摆好骨骼与相机(含手抖); withShake=false 用于拖动预览(拖时免抖, 画面干净)
function poseAt(t, withShake) {
  playTime = t
  if (mixer && _mixerT !== t) {
    mixer.setTime(t) // 骨骼与运镜同轴: 内容被暂停段冻住时, 骨骼一并定格
    _mixerT = t
  }
  if (!timeline) return

  // 在时间轴上定位当前事件(停留 hold 或 移动 seg)
  const evs = timeline.events
  let ev = evs[0]
  for (let i = 0; i < evs.length; i++) {
    if (t < evs[i].end || i === evs.length - 1) { ev = evs[i]; break }
  }
  const idx = ev.index
  let motionFactor = SHAKE_HOLD_SCALE

  if (ev.type === 'hold') {
    camera.position.copy(posCurve.getPointAt(knotFractions[idx]))
    camera.quaternion.copy(waypoints[idx].quat)
  } else {
    const segDur = Math.max(1e-4, ev.end - ev.start)
    const raw = Math.min(1, Math.max(0, (t - ev.start) / segDur))
    // 段内缓动: 静止起步 ease-in, 停点/终点收尾 ease-out, 两者兼有 smoothstep, 其余匀速
    let u
    if (ev.startHeld && ev.endHeld) u = raw * raw * (3 - 2 * raw)
    else if (ev.startHeld) u = raw * raw
    else if (ev.endHeld) u = 1 - (1 - raw) * (1 - raw)
    else u = raw

    // 位置: 弧长占比映射, 保证位置与姿态在航点处同时刻到达
    const arc = knotFractions[idx] + u * (knotFractions[idx + 1] - knotFractions[idx])
    camera.position.copy(posCurve.getPointAt(arc))

    // 姿态: Squad 球面四边形插值(节点精确且角速度连续)
    const p1 = waypoints[idx]
    const p2 = waypoints[(idx + 1) % waypoints.length]
    if (Math.abs(p1.quat.dot(p2.quat)) > 0.99999) {
      camera.quaternion.copy(p1.quat)
    } else {
      const s1 = squadS[idx]
      const s2 = squadS[(idx + 1) % squadS.length]
      _qa.slerpQuaternions(p1.quat, p2.quat, u)
      _qb.slerpQuaternions(s1, s2, u)
      camera.quaternion.slerpQuaternions(_qa, _qb, 2 * u * (1 - u))
    }

    // 该段速度归一化: 越快抖动越明显
    const segSpeed = segLengths[idx] / segDur
    const ratio = timeline.avgSpeed > 0 ? Math.min(1, segSpeed / timeline.avgSpeed) : 1
    motionFactor = SHAKE_HOLD_SCALE + SHAKE_MOVE_GAIN * ratio
  }

  // 理想位姿上叠加手持抖动(相位走墙钟: 暂停平台里画面也会轻轻呼吸)
  if (withShake) {
    // 幅度平滑: motionFactor 段内恒定、暂停段骤降到 SHAKE_HOLD_SCALE, 直接切换会让抖动偏移
    // 瞬间跳变(表现为"卡一下"且幅度突变); 这里按墙钟 dt 做指数趋近, 让进出暂停段的幅度无缝过渡。
    if (_shakeAmpPrevWall < 0) {
      _shakeAmpSmooth = motionFactor // 首帧直接对齐, 不从头渐入
    } else if (wallTime > _shakeAmpPrevWall) {
      const a = 1 - Math.exp(-(wallTime - _shakeAmpPrevWall) / SHAKE_AMP_TAU)
      _shakeAmpSmooth += (motionFactor - _shakeAmpSmooth) * a
    }
    _shakeAmpPrevWall = wallTime
    // 末段渐隐: 接近末节点时手抖完全过渡到禁用(内容时刻到达 totalTime 时增益为 0)
    let endFade = 1
    if (SHAKE_END_FADE > 0) {
      let x = Math.min(1, Math.max(0, (timeline.totalTime - t) / SHAKE_END_FADE))
      endFade = x * x * (3 - 2 * x) // smoothstep: 两端斜率为 0, 起止无顿挫
    }
    applyHandheldShake(wallTime, _shakeAmpSmooth * shakeGain(t, wallTime) * endFade)
  }
}

// ===== 聚焦收尾: 运镜停到白球后, 世界整个撤退 =====
// 触发点 = 运镜播完那一刻: 人物与页面卡在末机位已全在画面外, 直接藏掉不穿帮; 地面按墙钟
// 渐隐 FOCUS_GROUND_FADE 秒后再关(连每帧更新一起停)。重播/拖进度条/调起始帧走 resetFocusClear。
let focusT = -1        // -1 = 未触发; >=0 = 触发后累计的墙钟秒
let worldCleared = false
function beginFocusClear() {
  if (focusT >= 0) return
  focusT = 0
  subtitleEl.classList.add('swapped') // 电影字幕: 旧文案逐字消失 → 新文案逐字出现(逐字延迟写在字符 span 上)
  if (model) model.visible = false // 骨骼每帧计算随隐藏一起停
  shadowPlane.visible = false // 影源没了, 接影板一起收
  hideFootShadows() // 脚底接触影一起收(重播恢复后由 updateFootShadows 每帧接管可见性)
  rippleT = -1; rippleMesh.visible = false // 踩卡水波也一起收(世界都没了)
  // 环视模式就位: 快照末机位(字幕锚点), 准心亮起, 四角字幕排好待淡入, 试锁鼠标(无手势失败走点击兜底)
  _lookBasePos.copy(camera.position)
  _lookBaseQuat.copy(camera.quaternion)
  buildLabels()
  layoutLabels()
  for (let i = 0; i < labelSprites.length; i++) labelSprites[i].sp.visible = true
  _labelFade = -1 // 下一帧起按 focusT 进度淡入
  xhCanvas.classList.add('on')
  requestLookLock()
  syncLockHint()
}
function resetFocusClear() {
  if (focusT < 0) return
  resetContentInvite() // 重播/拖进度条: 反相态与按钮复刻一起撤销
  focusT = -1
  worldCleared = false
  subtitleEl.classList.remove('swapped') // 字幕回到旧文案(重播/拖进度条/调帧时)
  if (model) model.visible = true
  if (groundMesh) { groundMesh.visible = true; groundMesh.material.opacity = 1 }
  shadowPlane.visible = true
  wrap.style.visibility = '' // 恢复后交给 updateCardTransform 每帧接管
  homeReleased = false // 世界恢复: 允许 LOD 重新分级
  homeLod = 1
  if (window.HomeGate) { window.HomeGate.setScale(1); window.HomeGate.resume() } // 首页循环以全质量重新起跑(重播/拖进度条/调起始帧)
  resetRipplePlayback() // 踩卡水波重新武装(下次踩卡再触发一次)
  // 环视模式收摊: 准心/提示/四角字幕全收, 释放鼠标, 转角归零(下次进来从末机位原朝向开始)
  _lookYaw = 0; _lookPitch = 0
  _lookYawT = 0; _lookPitchT = 0
  _labelFade = -1
  for (let i = 0; i < labelSprites.length; i++) {
    labelSprites[i].sp.visible = false; labelSprites[i].sp.material.opacity = 0
    labelSprites[i].ghost.root.visible = false // 虚影一起收(下次进来重新按接近度判定)
  }
  xhCanvas.classList.remove('on')
  hintEl.classList.remove('on')
  if (_lookLocked && document.exitPointerLock) document.exitPointerLock() // 解锁触发 pointerlockchange, 光标在那里还回来
}

// ===== 环视模式(正式 wiki 部分): 指针锁定(吃掉鼠标) + 十字准心 + 四角 3D 引导字幕 =====
// 运镜停稳(或直达进入)后进入该模式; 播放/拖动/调起始帧期间不生效。
// 接入/复位见 beginFocusClear / resetFocusClear(快照末机位、亮准心、排字幕、试锁鼠标 / 全部收起)。
let _lookYawT = 0, _lookPitchT = 0 // 环视转角目标(弧度): 鼠标增量累加到这里, yaw 正 = 朝右, pitch 正 = 朝上
let _lookYaw = 0, _lookPitch = 0   // 每帧实际叠加的转角: 指数追赶目标(丝滑收尾, 不过冲)
let _lookLocked = false            // 指针是否已锁定在渲染画布上
const _lookBasePos = new THREE.Vector3()  // 末机位基准(字幕摆放锚点), 进入环视时快照
const _lookBaseQuat = new THREE.Quaternion()

function requestLookLock() {
  if (_lookLocked) return
  try {
    const p = renderer.domElement.requestPointerLock()
    if (p && typeof p.catch === 'function') p.catch(function () {}) // 无手势会被拒: 静默, 交给点击兜底
  } catch (e) {}
}
function syncLockHint() {
  hintEl.classList.toggle('on', visible && focusT >= 0 && !_lookLocked && _contentInvT < 0)
}
function _onLockChange() { // change/error 都按真实状态校正(迟到的 error 不能把已锁状态抹掉)
  _lookLocked = document.pointerLockElement === renderer.domElement
  renderer.domElement.style.cursor = _lookLocked ? 'none' : '' // 锁定才藏光标, Esc 解锁要把鼠标还回来
  syncLockHint()
}
document.addEventListener('pointerlockchange', _onLockChange)
document.addEventListener('pointerlockerror', _onLockChange)
// 锁定期间: 鼠标增量累加到目标视角(限位内钳住); 实际转角由 updateMouseLook 每帧平滑追赶
window.addEventListener('mousemove', function (e) {
  if (!_lookLocked || focusT < 0 || _contentInvT >= 0) return
  const k = THREE.MathUtils.degToRad(LOOK_SENS)
  const yawMax = THREE.MathUtils.degToRad(LOOK_YAW_MAX)
  const pitchMax = THREE.MathUtils.degToRad(LOOK_PITCH_MAX)
  _lookYawT = Math.max(-yawMax, Math.min(yawMax, _lookYawT + e.movementX * k * LOOK_YAW_SIGN))
  _lookPitchT = Math.max(-pitchMax, Math.min(pitchMax, _lookPitchT - e.movementY * k * LOOK_PITCH_SIGN))
})
// ===== 内容WIKI按钮点击: 黑边转白 + 整幅反相同起 → 白边合拢/镜头对字 → 纯白页留按钮字 =====
// 反相是画布级 CSS filter(连同首页卡/字幕/准心), 按钮的 3D 精灵会被一起反掉, 所以点击瞬间
// 换成同一张源画布做的不反相 DOM 复刻(逐帧按精灵屏幕矩形贴合), 最后随白幕一起留成页面标题。
let _contentInvT = -1        // -1 = 未触发; >=0 = 点击后累计秒(收尾后保持, 由 _released 挡住后续)
let _contentCloseT = -1      // -1 = 未进入合拢; >=0 = 合拢阶段累计秒
let _contentAimT = -1        // 镜头对位累计秒(-1 = 不接管环视)
let _contentAimFromYaw = 0, _contentAimFromPitch = 0
let _contentAimToYaw = 0, _contentAimToPitch = 0
let _contentBarH0 = 0        // 合拢起始条高(白边内侧当前位置)
let _contentInvLabel = null
let _exemptEl = null
let _released = false        // 收尾后停帧并释放 wiki 渲染器
let _exemptW = 0, _exemptH = 0 // 按钮字复刻的基准尺寸(收尾时量一次, header 定位按它换算)
let _hline3 = null           // header 横线的迷你 3D 场景(独立 GL 上下文, 只管这一根管子)
const _hitV = new THREE.Vector3(), _hitF = new THREE.Vector3()
const _exV = new THREE.Vector3(), _exF = new THREE.Vector3()

// 屏幕点命中的四角按钮(精灵永远正对相机 ⇒ 屏幕上是轴对齐矩形); 未命中返回 -1
function hitLabelAt(px, py) {
  if (!labelSprites.length) return -1
  camera.updateMatrixWorld()
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
  _hitF.set(0, 0, -1).applyQuaternion(camera.quaternion)
  const tanHalfV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
  const winW = window.innerWidth, winH = window.innerHeight
  for (let i = 0; i < labelSprites.length; i++) {
    const L = labelSprites[i]
    if (!L.sp.visible || L.sp.material.opacity < 0.3) continue
    const d = _hitV.copy(L.pos).sub(camera.position).dot(_hitF) // 精灵面到相机的视深
    if (d <= 0.01) continue
    const halfH = 0.5 * L.sp.scale.y * winH / (2 * d * tanHalfV)
    const halfW = 0.5 * L.sp.scale.x * winH / (2 * d * tanHalfV)
    _hitV.copy(L.pos).project(camera)
    if (_hitV.z > 1) continue
    const sx = (_hitV.x * 0.5 + 0.5) * winW
    const sy = (-_hitV.y * 0.5 + 0.5) * winH
    if (Math.abs(px - sx) <= halfW && Math.abs(py - sy) <= halfH) return i
  }
  return -1
}

function makeExemptOverlay(L) {
  const el = document.createElement('div')
  el.className = 'wiki-exempt'
  const cv = document.createElement('canvas')
  cv.width = L.canvas.width
  cv.height = L.canvas.height
  cv.getContext('2d').drawImage(L.canvas, 0, 0)
  const scan = document.createElement('div')
  scan.className = 'scan'
  // 扫描条纹只压在字形上(用同一张字形画布的 alpha 当遮罩), 否则透明区会浮出一个条纹方块
  const maskUrl = 'url(' + cv.toDataURL() + ')'
  scan.style.webkitMaskImage = maskUrl
  scan.style.maskImage = maskUrl
  scan.style.maskSize = '100% 100%'
  scan.style.webkitMaskSize = '100% 100%'
  scan.style.maskRepeat = 'no-repeat'
  scan.style.webkitMaskRepeat = 'no-repeat'
  el.appendChild(cv)
  el.appendChild(scan)
  if (L && L.paintLogo) { // 无描边纯黑字身: 收成 logo 时叠在上面淡入(带描边的 HUD 字身同时淡出)
    const ink = document.createElement('canvas')
    ink.className = 'logo-ink'
    ink.width = cv.width
    ink.height = cv.height
    L.paintLogo(ink)
    el.appendChild(ink)
  }
  layer.appendChild(el)
  return el
}

function startContentInvite() {
  if (_contentInvT >= 0 || focusT < 0) return
  _contentInvT = 0
  // 链接写上 #content: 保存/分享的链接再次打开时直达这一页(见 CONTENT_DEEPLINK)
  try { history.replaceState(null, '', location.pathname + location.search + CONTENT_HASH) } catch (e) { location.hash = 'content' }
  _contentInvLabel = labelSprites[CONTENT_LABEL_I]
  // 黑边转白与整幅反相同起: 一边加 to-white(CSS 过渡 0.75s), 一边点 wiki-invert(1.6s 渐变)
  document.documentElement.classList.add('wiki-invert')
  barTop.classList.add('to-white')
  barBottom.classList.add('to-white')
  // 该按钮的 3D 精灵会在画布反相里被一起反掉: 立即换成同一张源画布的不反相 DOM 复刻
  if (_contentInvLabel) {
    _contentInvLabel.sp.visible = false
    _contentInvLabel.invOff = true
    _contentInvLabel.ghost.root.visible = false
  }
  _exemptEl = makeExemptOverlay(_contentInvLabel)
  updateExemptRect() // 先量好矩形再亮起, 避免第一帧从左上角闪过来
  _exemptEl.classList.add('on')
  // 环视 HUD 退场(准心/提示/字幕/Skip/K 面板); 鼠标锁定保持到收尾再交还(期间视角由脚本接管)
  xhCanvas.classList.remove('on')
  hintEl.classList.remove('on')
  subtitleEl.classList.remove('on')
  skipBtnEl.classList.remove('on')
  kPanelEl.style.display = 'none'
}

function resetContentInvite() {
  if (_contentInvT < 0 || _released) return
  _contentInvT = -1
  _contentCloseT = -1
  _contentAimT = -1
  _contentBarH0 = 0
  document.documentElement.classList.remove('wiki-invert')
  barTop.classList.remove('to-white')
  barBottom.classList.remove('to-white')
  barTop.style.height = ''
  barBottom.style.height = ''
  if (_exemptEl) { _exemptEl.remove(); _exemptEl = null }
  if (_contentInvLabel) {
    _contentInvLabel.sp.visible = true
    _contentInvLabel.invOff = false
    _contentInvLabel = null
  }
  layoutLetterbox() // 恢复按 LETTERBOX_ASPECT 算出的条高(合拢期由逐帧驱动)
}

// 反相期间: DOM 复刻逐帧贴住原精灵的屏幕矩形(精灵正对相机 ⇒ 直接投影中心 + 视深换算尺寸)
function updateExemptRect() {
  const L = _contentInvLabel
  if (!_exemptEl || !L) return
  camera.updateMatrixWorld()
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
  _exF.set(0, 0, -1).applyQuaternion(camera.quaternion)
  const d = _exV.copy(L.pos).sub(camera.position).dot(_exF)
  if (d <= 0.01) return
  const tanHalfV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
  const winW = window.innerWidth, winH = window.innerHeight
  _exV.copy(L.pos).project(camera)
  const sx = (_exV.x * 0.5 + 0.5) * winW
  const sy = (-_exV.y * 0.5 + 0.5) * winH
  const hPx = L.sp.scale.y * winH / (2 * d * tanHalfV)
  const wPx = L.sp.scale.x * winH / (2 * d * tanHalfV)
  _exemptEl.style.left = sx + 'px'
  _exemptEl.style.top = sy + 'px'
  _exemptEl.style.width = wPx + 'px'
  _exemptEl.style.height = hPx + 'px'
}

// 反相渐变走完(1.6s)即进入合拢: 上下白边向中线长, 镜头同时转到按钮文字正中(见 updateMouseLook)
function beginContentClose() {
  if (_contentCloseT >= 0) return
  _contentCloseT = 0
  _contentAimT = 0
  _contentAimFromYaw = _lookYaw
  _contentAimFromPitch = _lookPitch
  const L = _contentInvLabel
  if (L && L.tx != null && L.ty != null) {
    // 文字中心在基准相机局部空间的方向 (tx, ty, -1): yaw = atan(tx), pitch = atan(ty / √(1+tx²))
    _contentAimToYaw = Math.atan(L.tx)
    _contentAimToPitch = Math.atan(L.ty / Math.sqrt(1 + L.tx * L.tx))
  } else {
    _contentAimToYaw = _contentAimFromYaw
    _contentAimToPitch = _contentAimFromPitch
  }
  _contentBarH0 = parseFloat(barTop.style.height) || 0
  if (_exemptEl) _exemptEl.classList.add('top') // 白边合拢过来时文字要留在最上面
}

function stepContentClose() {
  const u = Math.min(1, _contentCloseT / INV_CLOSE_SEC)
  const e = u * u * (3 - 2 * u)
  const target = window.innerHeight / 2 + 2 // 多 2px: 两条恰好在中线重叠, 不留发丝缝
  const h = _contentBarH0 + (target - _contentBarH0) * e
  barTop.style.height = h + 'px'
  barBottom.style.height = h + 'px'
  if (u >= 1) finalizeContentInvite()
}

// 白幕合拢: 页面只剩纸色底 + 按钮文字。其余全部摘除并交还 GPU/CPU 资源。
// 逐材质释放贴图(材质自带的 map/envMap 等 + ShaderMaterial 的 uniforms 贴图), 最后连 GL 上下文一起丢
const _freedTex = new Set()
function freeMaterial(m) {
  if (!m || m.__freed) return
  m.__freed = true
  const keys = Object.keys(m)
  for (let i = 0; i < keys.length; i++) {
    const v = m[keys[i]]
    if (v && v.isTexture && !_freedTex.has(v)) { _freedTex.add(v); v.dispose() }
  }
  if (m.uniforms) {
    for (const k in m.uniforms) {
      const v = m.uniforms[k] && m.uniforms[k].value
      if (v && v.isTexture && !_freedTex.has(v)) { _freedTex.add(v); v.dispose() }
    }
  }
  m.dispose()
}
function freeScene() {
  scene.traverse(function (o) {
    if (o.geometry) o.geometry.dispose()
    if (o.isSkinnedMesh && o.skeleton) {
      if (o.skeleton.boneTexture) o.skeleton.boneTexture.dispose()
      if (typeof o.skeleton.dispose === 'function') o.skeleton.dispose()
    }
    if (Array.isArray(o.material)) {
      for (let i = 0; i < o.material.length; i++) freeMaterial(o.material[i])
    } else {
      freeMaterial(o.material)
    }
  })
  scene.clear()
}

function finalizeContentInvite() {
  if (_released) return
  _released = true
  if (_exemptEl) {
    const r = _exemptEl.getBoundingClientRect()
    _exemptW = r.width; _exemptH = r.height // 基准尺寸: 飞成 logo 的缩放与 header 定位都按它换算
    document.body.appendChild(_exemptEl) // 离开 wiki 层: 最终页面只留它与纸色底
    _exemptEl.style.left = '50%'
    _exemptEl.style.top = '50%'
    _exemptEl.style.width = r.width + 'px'
    _exemptEl.style.height = r.height + 'px'
  }
  releaseGL() // 先把首页画布引用取出来, 随后再清 DOM
  // 除按钮文字复刻外, body 里的一切(首页整页卡/调试面板/各脚本 UI/wiki 层)全部移除
  Array.prototype.slice.call(document.body.children).forEach(function (el) {
    if (el !== _exemptEl) el.remove()
  })
  startHeaderFormation() // 白底 + 居中标题 → 字飞左上变黑 logo, 3D 曲线飞入压平成 header 横线
}

// 释放首页与 wiki 的全部 GPU/循环资源(白幕收尾与 #content 直达共用)
function releaseGL() {
  // 首页那几张画布(体积光/雪/唱片/光斑/色散)随 wrap 一起摘除; 先留引用, 下面连上下文一起释放
  const homeCanvases = Array.prototype.slice.call(document.body.querySelectorAll('canvas')).filter(function (c) {
    return c !== renderer.domElement && !(_exemptEl && _exemptEl.contains(c)) // 渲染器自己的下面单独释放; 按钮复刻是 2D 要留
  })
  if (window.HomeGate) window.HomeGate.pause() // 首页循环保持停机(不再有空转的 rAF)
  freeScene() // 3D 场景: 几何/材质/贴图
  // 本模块持有的离屏缓冲: 踩卡水波模拟 + 光斑/色散中继
  if (rippleFboA) { rippleFboA.dispose(); rippleFboA = null }
  if (rippleFboB) { rippleFboB.dispose(); rippleFboB = null }
  if (glowRT) { glowRT.dispose(); glowRT = null }
  if (chainRT) { chainRT.dispose(); chainRT = null }
  pmrem.dispose()
  renderer.dispose()
  try { renderer.forceContextLoss() } catch (e) {} // 着色器程序/纹理/缓冲随上下文一起销毁
  // 首页画布的 GL/2D 上下文一并交还(渲染循环早已停机, 不会再有恢复入口)
  for (let i = 0; i < homeCanvases.length; i++) {
    const c = homeCanvases[i]
    try {
      const g = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl')
      const ext = g && g.getExtension('WEBGL_lose_context')
      if (ext) ext.loseContext()
    } catch (e) {}
  }
  if (_lookLocked && document.exitPointerLock) document.exitPointerLock()
}

// 内容 wiki 只挂一次: 直达时立即挂, 正常收尾时等 header 横线落位后再挂(避免被入场动画抢帧)
let _contentWikiMounted = false
function mountContentWiki(delayMs) {
  const run = function () {
    if (_contentWikiMounted) return
    _contentWikiMounted = true
    import('../linsmagic/linsmagic.js?v=11').then(function (mod) {
      if (!document.querySelector('.lm-root')) mod.mountLinsmagic()
    }).catch(function (e) {
      _contentWikiMounted = false
      console.warn('[wiki] linsmagic mount failed:', e)
    })
  }
  if (delayMs) setTimeout(run, delayMs)
  else run()
}

// #content 直达: 页面直接就是终态(纸色底 + 左上黑字 logo + header 横线), 不播任何过渡动画
function bootContentPage() {
  _released = true // 停掉 wiki 帧循环与迟到的加载回调
  document.documentElement.classList.add('wiki-invert') // 纸色底(与正常收尾同一套 CSS)
  const hud = makeLabelCanvas(LABEL_TR_EN, LABEL_TR, false)
  const ink = makeLabelCanvas(LABEL_TR_EN, LABEL_TR, true)
  ink.className = 'logo-ink' // 只有纯黑字身可见; 带描边的 hud 画布在 .logo 态下透明(与正常收尾一致)
  const el = document.createElement('div')
  el.className = 'wiki-exempt logo on'
  el.appendChild(hud)
  el.appendChild(ink)
  el.style.left = '50%'
  el.style.top = '50%'
  el.style.width = hud.width + 'px'
  el.style.height = hud.height + 'px'
  _exemptEl = el
  _exemptW = hud.width; _exemptH = hud.height
  const m = headerMetrics()
  el.style.setProperty('--logo-tx', m.tx.toFixed(2) + 'px')
  el.style.setProperty('--logo-ty', m.ty.toFixed(2) + 'px')
  el.style.setProperty('--logo-s', m.s.toFixed(4))
  document.body.appendChild(el) // 先挂 .logo 终态再插入: 首帧即落位, 不跑飞行动画
  releaseGL()
  Array.prototype.slice.call(document.body.children).forEach(function (c) {
    if (c !== el) c.remove()
  })
  // startHeaderLine 内部会再起一个小型 GL 上下文来画横线; 如果失败(Three.js 某些版本 API 变动)
  // 不阻断后续的 linsmagic 挂载
  try { startHeaderLine(true) } catch (e) { console.warn('[wiki] header line failed:', e) }
  // 挂载 linsmagic wiki 内容（带版本号避免浏览器沿用旧模块缓存）
  mountContentWiki()
}

// ===== header 成形: 字飞向左上变纯黑 logo, 下方一条 3D 曲线飞入并压平成横线 =====
// 白幕后页面上只剩按钮字这一张 2D 画布: 字的位移/缩小走 CSS transform;
// 横线是独立的迷你 GL 上下文里一根真 3D 圆管, 从镜头左前方贴着画面外游入并逐渐压平。
function headerMetrics() {
  const vw = window.innerWidth, vh = window.innerHeight
  const logoH = Math.max(40, Math.min(76, vh * 0.058)) // logo 高度随窗口走(1080p ≈ 63px)
  const s = logoH / Math.max(1, _exemptH)
  const w = _exemptW * s
  return {
    vw: vw, vh: vh, s: s,
    tx: HEADER_MARGIN_X + w / 2 - vw / 2, // 元素钉在视口中心: 位移量 = 目标中心 - 视口中心
    ty: HEADER_MARGIN_Y + logoH / 2 - vh / 2,
    y: HEADER_MARGIN_Y + logoH + HEADER_GAP // 横线基线(logo 底缘下 HEADER_GAP)
  }
}

function startHeaderFormation() {
  if (!_exemptEl) return
  setTimeout(function () {
    if (!_exemptEl) return
    const m = headerMetrics()
    _exemptEl.style.setProperty('--logo-tx', m.tx.toFixed(2) + 'px')
    _exemptEl.style.setProperty('--logo-ty', m.ty.toFixed(2) + 'px')
    _exemptEl.style.setProperty('--logo-s', m.s.toFixed(4))
    void _exemptEl.offsetWidth // 先让"居中"这一帧落定, 再挂 .logo 才会从居中位置起飞
    _exemptEl.classList.add('logo')
    setTimeout(startHeaderLine, HLINE_DELAY_SEC * 1000)
    // 横线飞完并压平的同一时刻再挂 wiki, 让新壳直接出现在终态 header 下方
    mountContentWiki((HLINE_DELAY_SEC + HLINE_FLY_SEC) * 1000)
  }, LOGO_HOLD_SEC * 1000)
}

function startHeaderLine(instant) {
  if (!_exemptEl || _hline3) return
  const m = headerMetrics()
  const wrap = document.createElement('div')
  wrap.className = 'wiki-hline'
  const canvas = document.createElement('canvas')
  wrap.appendChild(canvas)
  document.body.appendChild(wrap)

  // 白幕后单独起一个极小的 GL 上下文, 只画这一根圆管
  const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(m.vw, m.vh, false)
  renderer.setClearAlpha(0)
  const scene = new THREE.Scene()
  const D = 10 // 最终线所在平面(z=0)到相机的距离
  const cam = new THREE.PerspectiveCamera(30, m.vw / m.vh, 0.05, 200)
  cam.position.set(0, 0, D) // 正对 header 平面, 只靠线的自身纵深出透视
  // 圆管的自着色: 法线朝上的那一侧提亮一点, 读起来是一根圆柱墨线
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec3 vN; void main() { vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vN; void main() { float l = clamp(dot(vN, normalize(vec3(-0.5, 0.75, 0.85))), 0.0, 1.0); gl_FragColor = vec4(mix(vec3(0.07, 0.07, 0.08), vec3(0.30, 0.30, 0.33), smoothstep(0.15, 0.95, l)), 1.0); }'
  })
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat)
  scene.add(mesh)
  const st = { renderer: renderer, scene: scene, cam: cam, done: false }
  st.layout = straight
  _hline3 = st

  function unitPx(metrics) { return 2 * D * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / metrics.vh }
  function setTube(points, metrics) {
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5), 140, 0.9 * unitPx(metrics), 6, false)
    mesh.geometry.dispose()
    mesh.geometry = g
  }
  // 落位态: 严格压在 header 基线上, z=0, 与像素坐标一一对应
  function straight(metrics) {
    const u = unitPx(metrics)
    const y = (metrics.vh / 2 - metrics.y) * u
    const xa = (HEADER_MARGIN_X - metrics.vw / 2) * u
    const xb = ((metrics.vw - HEADER_MARGIN_X) - metrics.vw / 2) * u
    setTube([new THREE.Vector3(xa, y, 0), new THREE.Vector3((xa + xb) / 2, y, 0), new THREE.Vector3(xb, y, 0)], metrics)
  }

  const SEG = 48
  const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)
  const tanH = tanV * m.vw / m.vh
  const um = unitPx(m)
  const xEnd = (m.vw / 2 - HEADER_MARGIN_X) * um // 落位直线两端(右端是"线头")
  const yEnd = (m.vh / 2 - m.y) * um
  // 起手两端的相机空间位置: 线头贴到镜头左前方 2.6m 处(整条线在画面外), 尾巴甩到 7m 外 ⇒
  // 进画那一瞬近端放大约 3.8 倍、远端只有 0.6 倍, 透视拉满; 相机不动, 落位映射始终精确。
  const hx = -2.6 * tanH * 1.33, hy = -2.6 * tanV * 0.5, hz = D - 2.6
  const tx = -7.0 * tanH * 1.18, ty = -7.0 * tanV * 0.45, tz = D - 7.0
  const t0 = performance.now()

  function tick(now) {
    let uu = (now - t0) / (HLINE_FLY_SEC * 1000)
    if (uu > 1) uu = 1
    const e = uu < 0.5 ? 4 * uu * uu * uu : 1 - Math.pow(-2 * uu + 2, 3) / 2 // easeInOutCubic
    if (uu >= 1) {
      straight(m)
      renderer.render(scene, cam)
      st.done = true
      return
    }
    const spread = 1 - e
    // 蛇形行波: 纵向摇摆 + z 方向纵深摇摆; 摆幅随落位平方衰减、相位回卷 ⇒ 一边游进一边松开压平
    const ampY = 0.35, ampZ = 0.55
    const phase = spread * Math.PI * 3.4
    const pts = []
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG
      const env = Math.sin(Math.PI * t)
      // 起手曲线(t=0 尾 / t=1 线头) 与 落位直线 逐点插值
      const sx = tx + (hx - tx) * t, sy = ty + (hy - ty) * t, sz = tz + (hz - tz) * t
      const ex = -xEnd + 2 * xEnd * t, ey = yEnd, ez = 0
      const w = env * spread * spread
      pts.push(new THREE.Vector3(
        sx + (ex - sx) * e,
        sy + (ey - sy) * e + w * ampY * Math.sin(t * Math.PI * 4.2 + phase),
        sz + (ez - sz) * e + w * ampZ * Math.sin(t * Math.PI * 2.8 + phase + 1.3)
      ))
    }
    setTube(pts, m)
    renderer.render(scene, cam)
    requestAnimationFrame(tick)
  }
  if (instant) { // 直达: 不飞入, 直接出落位后的横线并停帧
    straight(m)
    renderer.render(scene, cam)
    st.done = true
    return
  }
  requestAnimationFrame(tick)
}

// 落位后的 header 跟随窗口重排(logo 位置/缩放与横线端点)
function relayoutHeader() {
  if (!_exemptEl) return
  const m = headerMetrics()
  _exemptEl.style.setProperty('--logo-tx', m.tx.toFixed(2) + 'px')
  _exemptEl.style.setProperty('--logo-ty', m.ty.toFixed(2) + 'px')
  _exemptEl.style.setProperty('--logo-s', m.s.toFixed(4))
  const st = _hline3
  if (!st || !st.done) return
  st.cam.aspect = m.vw / m.vh
  st.cam.updateProjectionMatrix()
  st.renderer.setSize(m.vw, m.vh, false)
  st.layout(m)
  st.renderer.render(st.scene, st.cam)
}

function updateContentInvite(delta) {
  if (_contentInvT < 0 || _released) return
  _contentInvT += delta
  if (_contentCloseT < 0 && _contentInvT >= INV_FADE_SEC) beginContentClose()
  if (_contentCloseT >= 0) {
    _contentCloseT += delta
    stepContentClose()
  }
  if (!_released) updateExemptRect() // 对位/合拢期间逐帧贴住(转向时文字随场景一起被"推"到中心)
}

// 未锁定时点击画面重新锁定(K 面板上的点击除外); 锁定后准心即指针: 点中右上内容WIKI按钮触发反相动画
window.addEventListener('click', function (e) {
  if (!visible || focusT < 0 || _contentInvT >= 0) return
  if (e.target && e.target.closest && e.target.closest('.wiki-kpanel')) return
  const px = _lookLocked ? window.innerWidth / 2 : e.clientX
  const py = _lookLocked ? window.innerHeight / 2 : e.clientY
  if (hitLabelAt(px, py) === CONTENT_LABEL_I) { startContentInvite(); return }
  if (!_lookLocked) requestLookLock()
})

// 每帧在 poseAt 摆完位姿后调用: 实际转角指数追赶目标(帧率无关), 再叠加到末机位基准朝向(只转朝向, 不动机位)
function updateMouseLook(delta) {
  if (focusT < 0) return
  if (_contentAimT >= 0) {
    // 合拢阶段: 镜头沿同一条 smoothstep 转到按钮文字中心(白边合拢与对位同步收口)
    _contentAimT += delta
    const u = Math.min(1, _contentAimT / INV_CLOSE_SEC)
    const e = u * u * (3 - 2 * u)
    _lookYaw = _contentAimFromYaw + (_contentAimToYaw - _contentAimFromYaw) * e
    _lookPitch = _contentAimFromPitch + (_contentAimToPitch - _contentAimFromPitch) * e
    _lookYawT = _lookYaw; _lookPitchT = _lookPitch
    camera.rotateY(-_lookYaw)
    camera.rotateX(_lookPitch)
    return
  }
  const k = 1 - Math.exp(-delta / LOOK_TAU) // 一阶低通: 快甩后拖着滑到位, 就是"速度余量"
  _lookYaw += (_lookYawT - _lookYaw) * k
  _lookPitch += (_lookPitchT - _lookPitch) * k
  if (Math.abs(_lookYawT - _lookYaw) < 2e-4) _lookYaw = _lookYawT // 够近就吸附, 免得永远追不干净
  if (Math.abs(_lookPitchT - _lookPitch) < 2e-4) _lookPitch = _lookPitchT
  if (_lookYaw === 0 && _lookPitch === 0) return
  camera.rotateY(-_lookYaw) // rotateY 正角朝左, 取负 ⇒ yaw 正 = 朝右(见上方约定)
  camera.rotateX(_lookPitch) // rotateX 正角朝上
}

// ---- 十字准心(屏幕中心): 故障 RGB 闪动 —— 逐帧画三色通道错位 + 随机爆发撕裂; CSS 反色(difference) ----
const xhCanvas = document.createElement('canvas')
xhCanvas.className = 'wiki-xhair'
const _xhDpr = Math.min(window.devicePixelRatio || 1, 2)
xhCanvas.width = XH_SIZE * _xhDpr
xhCanvas.height = XH_SIZE * _xhDpr
const xhCtx = xhCanvas.getContext('2d')
layer.appendChild(xhCanvas)
// 未锁定鼠标时的提示(准心下方一行小字)
const hintEl = document.createElement('div')
hintEl.className = 'wiki-lockhint'
hintEl.textContent = LOOK_HINT
layer.appendChild(hintEl)

let _xhBurstUntil = 0, _xhNextBurst = 0
function drawCrosshair(now) {
  const c = xhCtx
  const C = XH_SIZE / 2
  if (now >= _xhNextBurst) { // 安排下一次故障爆发(爆发期通道错位与撕裂都放大)
    _xhBurstUntil = now + 0.05 + Math.random() * 0.13
    _xhNextBurst = now + 0.9 + Math.random() * 1.9
  }
  const burst = now < _xhBurstUntil
  const amp = burst ? 3.2 : 0.7 // 三色通道错位幅度(css px)
  const dx = (Math.random() - 0.5) * 2 * amp
  const dy = (Math.random() - 0.5) * 2 * amp
  c.setTransform(_xhDpr, 0, 0, _xhDpr, 0, 0)
  c.clearRect(0, 0, XH_SIZE, XH_SIZE)
  c.globalCompositeOperation = 'lighter' // R/G/B 三份叠加: 重合处成白, 错开处见彩边(故障感)
  c.globalAlpha = burst ? 0.45 + Math.random() * 0.55 : 0.78 + Math.random() * 0.22 // 闪动
  c.lineWidth = XH_W
  function arms(ox, oy, color) {
    c.strokeStyle = color
    c.beginPath()
    c.moveTo(C + ox, C + oy - XH_GAP - XH_ARM); c.lineTo(C + ox, C + oy - XH_GAP)
    c.moveTo(C + ox, C + oy + XH_GAP); c.lineTo(C + ox, C + oy + XH_GAP + XH_ARM)
    c.moveTo(C + ox - XH_GAP - XH_ARM, C + oy); c.lineTo(C + ox - XH_GAP, C + oy)
    c.moveTo(C + ox + XH_GAP, C + oy); c.lineTo(C + ox + XH_GAP + XH_ARM, C + oy)
    c.stroke()
  }
  arms(dx, dy, 'rgb(255, 48, 48)')
  arms(0, 0, 'rgb(48, 255, 48)')
  arms(-dx, -dy, 'rgb(48, 48, 255)')
  if (burst) { // 撕裂: 中间一条横带整体错位(只重画被裁进带内的部分)
    const bandY = C - 5, shift = (Math.random() - 0.5) * 14
    c.save()
    c.beginPath(); c.rect(0, bandY, XH_SIZE, 10); c.clip()
    c.globalAlpha = 0.9
    arms(dx + shift, dy, 'rgb(255, 48, 48)')
    arms(shift, 0, 'rgb(48, 255, 48)')
    arms(-dx + shift, dy, 'rgb(48, 48, 255)')
    c.restore()
  }
  c.globalCompositeOperation = 'source-over'
  c.globalAlpha = 1
}

// ---- 四角 3D 引导字幕(面朝摄像机的精灵文字, 双行: 英文放大 + 中文现尺寸; 摆放见 layoutLabels) ----
const labelSprites = [] // { sp, sideX, sideY, asp, hunit, pos }
let _labelFade = -1     // 已写入材质的淡入进度(值变才写, 平时零开销)
const _labelScanU = { uTime: { value: 0 } } // 扫描闪动共享时间 uniform: 四个标签同一节奏
// 扫描闪动 GLSL(注入精灵片段着色器, 见 makeLabelSprite): 屏幕空间细横纹上扫 + 24Hz 亮度抖动 + 偶发强闪。
// 用 gl_FragCoord 而非 uv —— 纹路钉在屏幕上扫, 是"显示层"故障语言(同准心), 不是世界里的雾。
const LABEL_SCAN_GLSL =
  'float scan = ' + LABEL_SCAN_MIN.toFixed(3) + ' + ' + (1 - LABEL_SCAN_MIN).toFixed(3) +
  ' * (0.5 + 0.5 * sin((gl_FragCoord.y + uTime * ' + LABEL_SCAN_SPEED.toFixed(1) + ') * ' + LABEL_SCAN_FREQ.toFixed(3) + '));\n' +
  'float flick = 1.0 - ' + LABEL_FLICKER.toFixed(3) + ' * wkhash(floor(uTime * 24.0));\n' +
  'float strobe = wkhash(floor(uTime * 2.0) + 7.0) > 0.88 ? 1.3 : 1.0;\n' +
  'diffuseColor.rgb *= scan * flick * strobe;'
// 扫描闪动注入: 精灵贴图与虚影纯色材质共用(两者片段着色器都带 map_fragment); 时间走 _labelScanU
function injectScan(mat) {
  mat.onBeforeCompile = function (shader) {
    shader.uniforms.uTime = _labelScanU.uTime
    shader.fragmentShader = 'uniform float uTime;\nfloat wkhash(float x) { return fract(sin(x * 127.1) * 43758.5453); }\n' +
      shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + LABEL_SCAN_GLSL)
  }
}
// 双行标签画布(英文放大在上 / 中文在下); ink = 不描边、只填纯黑(收成 logo 用)
function makeLabelCanvas(enText, zhText, ink) {
  const F = 96, PAD = 18 // 中文行画布字号/留白: 只决定贴图清晰度, 屏上大小由 LABEL_PX 换算
  const FEN = Math.round(F * LABEL_EN_BIG) // 英文行字号 = 中文行 × 放大倍数
  const lineHen = Math.round(FEN * 1.3), lineHz = Math.round(F * 1.4), gap = Math.round(F * 0.18)
  const cv = document.createElement('canvas')
  const cx = cv.getContext('2d')
  const serif = '"Source Han Serif CN", "Noto Serif CJK SC", "Songti SC", "STSong", "SimSun", serif'
  const spEn = Math.round(FEN * 0.12) + 'px', spZh = Math.round(F * 0.15) + 'px' // 衬线大间距, 同 RPG 菜单
  function meas(text, size, spacing) {
    if ('letterSpacing' in cx) cx.letterSpacing = spacing
    cx.font = '700 ' + size + 'px ' + serif
    return Math.ceil(cx.measureText(text).width)
  }
  const twEn = meas(enText, FEN, spEn), twZh = meas(zhText, F, spZh)
  cv.width = Math.max(twEn, twZh) + PAD * 2
  cv.height = lineHen + gap + lineHz
  function draw(text, size, spacing, cyCenter) { // 改画布尺寸会重置 2D 状态: 每次调用重设全套
    if ('letterSpacing' in cx) cx.letterSpacing = spacing
    cx.font = '700 ' + size + 'px ' + serif
    cx.textAlign = 'center'
    cx.textBaseline = 'middle'
    if (ink) {
      cx.fillStyle = '#000'
    } else {
      cx.lineJoin = 'round'
      cx.lineWidth = Math.round(size * LABEL_STROKE)
      cx.strokeStyle = '#000'
      cx.strokeText(text, cv.width / 2, cyCenter) // 先描黑边再填字身(描边被字身盖掉内半, 外面留厚黑边)
      cx.fillStyle = 'rgba(228, 233, 240, 0.92)'
    }
    cx.fillText(text, cv.width / 2, cyCenter)
  }
  draw(enText, FEN, spEn, lineHen / 2)              // 第一行: 英文(放大)
  draw(zhText, F, spZh, lineHen + gap + lineHz / 2) // 第二行: 中文(现尺寸)
  return cv
}
function makeLabelSprite(enText, zhText) {
  const cv = makeLabelCanvas(enText, zhText, false)
  // 无描边的纯黑字身(同排版): 收成 logo 时叠上去交叉淡入, 把 HUD 的厚黑描边一起去掉
  function paintLogo(out) {
    out.getContext('2d').drawImage(makeLabelCanvas(enText, zhText, true), 0, 0)
    return out
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, toneMapped: false, opacity: 0 })
  injectScan(mat) // 扫描闪动(见 LABEL_SCAN_GLSL): 时间走 _labelScanU, 四个标签共享
  const sp = new THREE.Sprite(mat)
  sp.visible = false
  scene.add(sp)
  return {
    sp: sp,
    canvas: cv, // 反相时用同一张源画布做不反相的 DOM 复刻
    paintLogo: paintLogo, // 同一排版的无描边纯黑字身
    asp: cv.width / cv.height,
    hunit: cv.height / Math.ceil(96 * 1.4) // 全块高/旧单行画布高: 中文行屏上大小与旧版逐像素一致
  }
}
function buildLabels() {
  if (labelSprites.length) return
  // [英文行, 中文行, 横向, 纵向, 虚影模型] —— 模型与四角一一对应(wiki-ui 目录)
  const defs = [
    [LABEL_TL_EN, LABEL_TL, -1, 1, 'worldview.glb'],
    [LABEL_BL_EN, LABEL_BL, -1, -1, 'design.glb'],
    [LABEL_TR_EN, LABEL_TR, 1, 1, 'content.glb'],
    [LABEL_BR_EN, LABEL_BR, 1, -1, 'deployment.glb']
  ]
  for (let i = 0; i < defs.length; i++) {
    const r = makeLabelSprite(defs[i][0], defs[i][1])
    labelSprites.push({ sp: r.sp, canvas: r.canvas, paintLogo: r.paintLogo, sideX: defs[i][2], sideY: defs[i][3], asp: r.asp, hunit: r.hunit, pos: new THREE.Vector3(), ghost: makeLabelGhost(defs[i][4]) })
  }
}
// 按当前窗口的"可见半角"摆四角(锚点 = 快照的末机位): 横向中心放到画面外, 只露 LABEL_PEEK 比例;
// 纵向贴黑条内侧(见 LABEL_* 常量)。窗口比例变了重排即保持"微微露出"。
function layoutLabels() {
  if (!labelSprites.length) return
  const winW = window.innerWidth, winH = window.innerHeight
  const tanHalfV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
  const tanHalfH = tanHalfV * (winW / winH)
  const bandH = Math.min(winH, winW / LETTERBOX_ASPECT) // 遮幅后的可见高
  const tanHalfVv = tanHalfV * (bandH / winH)
  const _v = new THREE.Vector3()
  for (let i = 0; i < labelSprites.length; i++) {
    const L = labelSprites[i]
    const hh = tanHalfV * (LABEL_PX / 1080) * L.hunit // 全块半高的 tan 值(中文行基准尺寸 × 块高倍数)
    const hw = hh * L.asp                              // 全块半宽的 tan 值
    const tx = L.sideX * (tanHalfH + hw * (1 - 2 * LABEL_PEEK))
    const ty = L.sideY * (tanHalfVv - hh - tanHalfVv * LABEL_EDGE_INSET) // 外侧一行(顶标签=英文, 底标签=中文)贴黑条内沿
    const hWorld = 2 * LABEL_DIST * hh                 // 全块世界高: 中文行屏上大小 = LABEL_PX(与旧版一致)
    L.tx = tx; L.ty = ty // 基准相机坐标下的 tan 偏移: 收拢阶段据此把镜头对准文字中心
    _v.set(tx * LABEL_DIST, ty * LABEL_DIST, -LABEL_DIST).applyQuaternion(_lookBaseQuat)
    L.pos.copy(_lookBasePos).add(_v) // 世界锚点(扫描闪动在屏幕空间着色, 锚点本身不动)
    L.sp.position.copy(L.pos)
    L.sp.scale.set(hWorld * L.asp, hWorld, 1)
    // 虚影: 同一视线上再往深 LABEL_GHOST_DEPTH 米(角度与标签完全同位, 深度更远 → 透明排序垫在标签
    // 之下), 屏上尺寸 = 标签文字块高 × LABEL_GHOST_SIZE; qInv/scale 供逐帧把屏幕向错位换算回 root 局部
    const G = L.ghost
    const Dg = LABEL_DIST + LABEL_GHOST_DEPTH
    G.dist = Dg
    G.scale = 2 * Dg * hh * LABEL_GHOST_SIZE
    _v.set(tx * Dg, ty * Dg, -Dg).applyQuaternion(_lookBaseQuat)
    G.pos.copy(_lookBasePos).add(_v)
    G.root.position.copy(G.pos)
    G.root.quaternion.copy(_lookBaseQuat)
    G.root.scale.setScalar(G.scale)
    G.qInv.copy(_lookBaseQuat).invert()
  }
}

// 按钮虚影: 载入对应模型 → Box3 归一化(居中, 最长边=1) → 克隆三个 RGB 通道层(纯色加法混合,
// 各自记录屏幕错位方向), 全挂在一个 root 组下(摆位/缩放见 layoutLabels, 逐帧错位见 updateLabelGhosts)。
const WIKI_UI_LOADER = new GLTFLoader()
const GHOST_CHANNELS = [[0xff4040, 1, 0.12], [0x40ff40, 0, 0], [0x5050ff, -1, -0.12]] // [色, 横错位方向, 纵错位方向]
function makeLabelGhost(file) {
  const root = new THREE.Group()
  root.visible = false
  scene.add(root)
  const G = { root: root, chans: null, pos: new THREE.Vector3(), qInv: new THREE.Quaternion(), scale: 1, dist: LABEL_DIST + LABEL_GHOST_DEPTH }
  WIKI_UI_LOADER.load(WIKI_UI_DIR + file, function (gltf) {
    if (_released) return // 白幕已收尾: 场景已释放, 迟到的模型不再挂回去
    const norm = new THREE.Group() // 归一化层: 原模型塞进去整体缩/移, 最长边=1 且中心在原点
    norm.add(gltf.scene)
    norm.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(norm)
    const sz = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3())
    const s = 1 / Math.max(sz.x, sz.y, sz.z, 1e-6)
    norm.scale.setScalar(s)
    norm.position.set(-c.x * s, -c.y * s, -c.z * s)
    const chans = []
    for (let i = 0; i < GHOST_CHANNELS.length; i++) {
      const node = new THREE.Group() // 外套一层: 逐帧往这里写色散错位, 内层保持归一化变换
      node.add(norm.clone(true))     // 几何共享(Mesh.clone 不深拷 geometry), 材质逐层换成纯色
      const mat = new THREE.MeshBasicMaterial({
        color: GHOST_CHANNELS[i][0], transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
      })
      injectScan(mat)
      node.traverse(function (o) { if (o.isMesh) o.material = mat })
      root.add(node)
      chans.push({ node: node, mat: mat, sx: GHOST_CHANNELS[i][1], sy: GHOST_CHANNELS[i][2] })
    }
    G.chans = chans
  }, undefined, function () {}) // 加载失败静默: 虚影缺席不影响四角字幕
  return G
}

// 逐帧(仅环视模式): 按"准心方向 ↔ 按钮方向"夹角把虚影淡入淡出, 并给三通道写屏幕向色散错位。
// 偶发爆发(共享调度)瞬间放大错位 —— 与扫描闪动同一套"共享故障"语言; 屏幕横/纵轴取当前相机朝向。
const _ghFwd = new THREE.Vector3(), _ghDir = new THREE.Vector3()
const _ghRight = new THREE.Vector3(), _ghUp = new THREE.Vector3(), _ghOff = new THREE.Vector3()
let _ghBurstUntil = -1, _ghBurstNext = 0
function ghHash(x) { const s = Math.sin(x * 127.1) * 43758.5453; return s - Math.floor(s) }
function updateLabelGhosts(now, fade) {
  if (fade <= 0) return // 还没开始淡入: 不动(材质本来 opacity 0)
  _ghFwd.set(0, 0, -1).applyQuaternion(camera.quaternion)
  if (now >= _ghBurstNext) { // 偶发爆发调度(四个虚影共节奏)
    _ghBurstNext = now + 0.7 + ghHash(now) * 1.8
    _ghBurstUntil = now + 0.1 + ghHash(now + 3.7) * 0.22
  }
  const burst = now < _ghBurstUntil ? LABEL_GHOST_BURST : 1
  const winH = window.innerHeight
  const tanHalfV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
  _ghRight.set(1, 0, 0).applyQuaternion(camera.quaternion)
  _ghUp.set(0, 1, 0).applyQuaternion(camera.quaternion)
  for (let i = 0; i < labelSprites.length; i++) {
    const G = labelSprites[i].ghost
    if (labelSprites[i].invOff) { if (G.root.visible) G.root.visible = false; continue } // 反相期间: 按钮文字不反相, 虚影一起收
    if (!G.chans) continue // 模型还没加载完
    _ghDir.copy(G.pos).sub(camera.position)
    const ang = Math.acos(Math.min(1, Math.max(-1, _ghDir.normalize().dot(_ghFwd)))) * 180 / Math.PI
    let k = (LABEL_GHOST_FAR - ang) / (LABEL_GHOST_FAR - LABEL_GHOST_NEAR)
    k = k <= 0 ? 0 : k >= 1 ? 1 : k
    k = k * k * (3 - 2 * k) // smoothstep: 进入/退出两端都柔和
    if (k <= 0.002) { if (G.root.visible) G.root.visible = false; continue }
    G.root.visible = true
    const split = LABEL_GHOST_DISP * burst * (0.75 + 0.25 * Math.sin(now * 9.1 + i * 1.7) + 0.15 * Math.sin(now * 23.7 + i * 2.3))
    const wpp = 2 * G.dist * tanHalfV / winH // 该深度上 1px 对应的世界长度
    for (let c = 0; c < G.chans.length; c++) {
      const C = G.chans[c]
      C.mat.opacity = LABEL_GHOST_OPACITY * k * fade
      _ghOff.copy(_ghRight).multiplyScalar(C.sx * split * wpp).addScaledVector(_ghUp, C.sy * split * wpp)
      _ghOff.applyQuaternion(G.qInv).divideScalar(G.scale)
      C.node.position.copy(_ghOff)
    }
  }
}

// 每帧(仅环视模式): 准心动画 + 字幕淡入/扫描闪动 + 按钮虚影(显示开关都在 beginFocusClear/resetFocusClear 里)
function updateLookUi(now) {
  if (!visible || focusT < 0) return
  drawCrosshair(now)
  if (labelSprites.length) {
    const f = Math.min(1, focusT / LABEL_FADE)
    if (f !== _labelFade) {
      _labelFade = f
      for (let i = 0; i < labelSprites.length; i++) labelSprites[i].sp.material.opacity = f
    }
    _labelScanU.uTime.value = now // 扫描闪动: 推进共享时间(注入着色器的 uTime)
    updateLabelGhosts(now, f)     // 虚影: 按准心接近度淡入 + 色散错位动画
  }
}

// ===== 控制台性能检测(定位 wiki 卡顿来源, 自点击「Wiki」那一刻起算) =====
// 与首页体积光检测同款思路: 帧间隔 avg/p95/max 反映实际流畅度与尖刺; 主线程按功能段拆开分别计时
// (pose 骨骼/运镜 · 影 · 球 · 眩光 · 海 · 特效 · 场景绘制 · 后处理 · 卡投影 · 面板);
// 本机无 EXT_disjoint_timer_query, 故每隔若干帧用 gl.finish() 做一次真同步探针, 拿"场景+后处理"的 GPU 真耗时。
const WIKI_PROFILE = true       // 总开关: false = 完全不采样(零开销)
const WIKI_PROFILE_EVERY = 2000 // 每多少毫秒往控制台输出一次
let profOn = false              // 点击 Wiki 后置 true
let profLast = 0                // 上一帧时间戳
let profLastFlush = 0           // 上次输出时间戳
let profProbe = true            // 本帧是否执行 gl.finish 探针
const profFrames = []           // 帧间隔采样
const profSegs = Object.create(null) // 各功能段耗时采样
const gl = renderer.getContext()

function profAdd(name, ms) {
  const a = profSegs[name] || (profSegs[name] = [])
  a.push(ms)
}
function profReset() {
  profFrames.length = 0
  for (const k in profSegs) profSegs[k].length = 0
  profProbe = true
}
function profAvg(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0 }
function profPct(a, p) { if (!a.length) return 0; const s = a.slice().sort(function (x, y) { return x - y }); return s[Math.min(s.length - 1, Math.floor(s.length * p))] }

function wikiProfFlush() {
  if (!profFrames.length) return
  const frame = profAvg(profFrames)
  const f95 = profPct(profFrames, 0.95), fmax = profPct(profFrames, 1)
  const gpuArr = profSegs.gpu || []
  const gpu = gpuArr.length ? profAvg(gpuArr) : -1
  const w = renderer.domElement.width, h = renderer.domElement.height
  console.log(
    '%c[Wiki性能] ' + frame.toFixed(2) + 'ms/帧 (' + (1000 / frame).toFixed(1) + ' FPS)',
    'color:#8acaff;font-weight:bold',
    '\n  帧间隔   avg ' + frame.toFixed(2) + '  p95 ' + f95.toFixed(2) + '  max ' + fmax.toFixed(2) + ' ms',
    '\n  主线程   pose ' + profAvg(profSegs.pose || []).toFixed(3) +
             ' | 影 ' + profAvg(profSegs.feet || []).toFixed(3) +
             ' | 球 ' + profAvg(profSegs.orb || []).toFixed(3) +
             ' | 眩光 ' + profAvg(profSegs.glare || []).toFixed(3) +
             ' | 海 ' + profAvg(profSegs.sea || []).toFixed(3) +
             ' | 水波 ' + profAvg(profSegs.ripple || []).toFixed(3) +
             ' | 特效 ' + profAvg(profSegs.fx || []).toFixed(3) +
             ' | 场景 ' + profAvg(profSegs.scene || []).toFixed(3) +
             ' | 后处理 ' + profAvg(profSegs.post || []).toFixed(3) +
             ' | 卡 ' + profAvg(profSegs.card || []).toFixed(3) +
             ' | 面板 ' + profAvg(profSegs.hud || []).toFixed(3) + ' ms',
    '\n  GPU      ' + (gpu >= 0 ? '场景+后处理 ' + gpu.toFixed(2) + ' ms' : '采样中…'),
    '\n  负载     ' + w + '×' + h + ' = ' + (w * h / 1e6).toFixed(2) + 'M 片元  dpr=' + (window.devicePixelRatio || 1).toFixed(2) +
             '  卡占比 ' + _cardScreenFrac.toFixed(2) + ' 首页档 ' + (homeLod === 0 ? '冻结' : (homeLod === 1 ? '全' : homeLod + '×'))
  )
  // 暴露给浏览器控制台/自动化读取, 避免仅靠 console 文本
  const _hist = window.__WIKI_PERF__ = window.__WIKI_PERF__ || []
  _hist.push({
    t: Math.round(performance.now()),
    frame: +frame.toFixed(2), p95: +f95.toFixed(2), max: +fmax.toFixed(2),
    cardFrac: +_cardScreenFrac.toFixed(3), homeLod: homeLod,
    ms: {
      pose: +profAvg(profSegs.pose || []).toFixed(3), feet: +profAvg(profSegs.feet || []).toFixed(3),
      orb: +profAvg(profSegs.orb || []).toFixed(3), glare: +profAvg(profSegs.glare || []).toFixed(3),
      sea: +profAvg(profSegs.sea || []).toFixed(3), fx: +profAvg(profSegs.fx || []).toFixed(3),
      ripple: +profAvg(profSegs.ripple || []).toFixed(3),
      scene: +profAvg(profSegs.scene || []).toFixed(3), post: +profAvg(profSegs.post || []).toFixed(3),
      card: +profAvg(profSegs.card || []).toFixed(3), hud: +profAvg(profSegs.hud || []).toFixed(3)
    },
    gpu: gpu >= 0 ? +gpu.toFixed(2) : null
  })
  if (_hist.length > 60) _hist.shift()
  profReset()
}

function frame() {
  if (_released) return // 白幕收尾完成: 渲染器已释放, 不再调度下一帧
  requestAnimationFrame(frame)
  const delta = clock.getDelta() // 始终取走(隐藏期丢弃), 避免登场首帧累计大跳
  if (!visible) return

  // 性能采样: 记帧间隔, 到点输出(自点击 Wiki 起算)
  let _pt = 0
  if (profOn) {
    const _pn = performance.now()
    if (profLast) profFrames.push(_pn - profLast)
    profLast = _pn
    if (_pn - profLastFlush >= WIKI_PROFILE_EVERY) { profLastFlush = _pn; wikiProfFlush() }
    _pt = _pn
  }

  if (timeline) {
    if (isPlaying) {
      wallTime += delta
      const endW = playSegs.length ? playSegs[playSegs.length - 1].w1 : timeline.totalTime
      if (wallTime >= endW) {
        wallTime = endW
        isPlaying = false // 播完停在末机位(与 model.html 停止播放后的状态一致)
        skipBtnEl.classList.remove('on') // 播放结束: Skip 按钮淡出
        poseAt(timeline.totalTime, true)
        syncPlayLabel()
        beginFocusClear() // 聚焦收尾: 世界撤退(地面渐隐, 见 FOCUS_GROUND_FADE)
      } else {
        poseAt(contentAt(wallTime), true) // 墙钟经暂停段调度 → 内容时刻
      }
    } else if (startEdit) {
      // 调起始帧: 相机由轨道控制驱动, 卡按实时相机反推(页面恰好满屏, 只见人相对页面的位置)
      updateOrbitCamera()
      buildCardRect(true)
    } else {
      // 停着也每帧重摆(拖动/改键即时生效); 模型未落地/拖动预览时不加手抖
      poseAt(playTime, scrubbing ? false : modelReady)
      // 运镜播完(未进聚焦收尾): 骨骼继续循环(与 model.html 播完的观感一致); 手动暂停/拖动时骨骼定格
      if (mixer && focusT < 0 && playTime >= timeline.totalTime - 1e-6) mixer.update(delta)
    }
  }

  // 鼠标环视: 聚焦收尾后(正式 wiki 部分)生效(指针锁定, 见"环视模式"段)
  updateMouseLook(delta)

  // 聚焦收尾: 地面渐隐, 完了把地面网格与页面卡整个关掉(每帧更新随之停)
  if (focusT >= 0 && !worldCleared) {
    focusT += delta
    const g = Math.min(1, focusT / FOCUS_GROUND_FADE)
    if (groundMesh) groundMesh.material.opacity = 1 - g
    if (g >= 1) {
      worldCleared = true
      if (groundMesh) groundMesh.visible = false
      wrap.style.visibility = 'hidden'
      homeReleased = true // 世界已撤: 首页永久停机(LOD 逻辑不再解冻)
      // 卡片与地面都撤了: 首页(体积光/雪/唱片波形等)整套每帧循环彻底停机, 不再空转抢 GPU
      if (window.HomeGate) window.HomeGate.pause()
    }
  }
  if (profOn) { profAdd('pose', performance.now() - _pt); _pt = performance.now() }

  updateFootShadows() // 脚底接触影: 贴脚骨, 抬脚渐隐
  if (profOn) { profAdd('feet', performance.now() - _pt); _pt = performance.now() }
  const nowS = performance.now() * 0.001
  updateOrbShell(delta, nowS) // 引力球: 小球物理 + 云的时间/位置
  if (profOn) { profAdd('orb', performance.now() - _pt); _pt = performance.now() }
  updateGlare(nowS) // 眩光: 广告牌面向相机 + 云絮噪波推进
  if (profOn) { profAdd('glare', performance.now() - _pt); _pt = performance.now() }
  updateSea(nowS) // 海面: 推波的时间
  if (profOn) { profAdd('sea', performance.now() - _pt); _pt = performance.now() }
  updateRipple(delta) // 踩卡水波: 触发/推进波场(只在存活期内跑, 平时零开销)
  if (profOn) { profAdd('ripple', performance.now() - _pt); _pt = performance.now() }
  // 光斑滤镜: 两条数值轨(散焦半径/曝光)按内容时刻采样后逐帧下发(wiki 画面本身; 半径 0 = 整条链摘除)
  if (wikiGlow) wikiGlow.setKeyed(sampleTrack(GLOW_RADIUS_KEYS, playTime), sampleTrack(GLOW_EXPOSURE_KEYS, playTime))
  // RGB 色散: 有键 = 按内容时间插值(可在面板 K); 无键 = dispfilter 自带的墙钟渐进(DISP_RAMP_SEC 秒升满并保持)
  if (wikiDisp) {
    const dV = sampleTrack(DISP_KEYS, playTime)
    if (dV == null) wikiDisp.update(delta)
    else wikiDisp.setStrength(dV)
  }
  if (profOn) profAdd('fx', performance.now() - _pt)

  const _gpuT = (profOn && profProbe) ? performance.now() : 0
  renderScene()
  if (_gpuT) { gl.finish(); profAdd('gpu', performance.now() - _gpuT); profProbe = false } // 探针帧: 同步取"场景+后处理"GPU 真耗时

  if (profOn) _pt = performance.now()
  updateCardTransform() // 卡 = 实时页面: 每帧把页面投影到卡面(与 GL 同相机)
  applyHomeLod() // 按卡片屏幕占比分级削减首页开销(镜头远 → 降分辨率 → 冻结)
  if (profOn) { profAdd('card', performance.now() - _pt); _pt = performance.now() }
  updateLookUi(nowS) // 准心逐帧故障动画 + 四角字幕淡入(仅环视模式)
  updateContentInvite(delta) // 内容WIKI按钮: 黑边转白 → 全画面反相(按钮文字除外)
  updateKPanelHud()
  if (profOn) profAdd('hud', performance.now() - _pt)
}

// ===== 对外接口: 菜单「Wiki」点击后登场 =====
// 骨骼动画与运镜同轴从 PLAY_FROM 起跑(与 model.html 同一动画, 只是砍掉开场那一截)
function startPlayback() {
  pendingEnter = false
  if (startEdit) exitStartEdit()
  resetFocusClear() // 重播: 世界(地面/人物/页面卡)全部恢复
  resetRipplePlayback() // 踩卡水波重新武装(重播后再踩一次)
  wallTime = 0
  _shakeAmpPrevWall = -1 // 手抖幅度平滑重新对齐(避免与上次播放的墙钟差出大 dt 造成突跳)
  playTime = PLAY_FROM
  isPlaying = true
  syncPlayLabel()
  skipBtnEl.classList.add('on') // Skip 按钮随播放淡入(与首页开场 Skip 同款过渡)
}

window.WikiModel = {
  enter: function () {
    if (visible) return
    visible = true
    // 链接写上 #wiki 标签: 玩家保存/分享的链接再次打开时直达 wiki 终态(见 WIKI_DEEPLINK)
    try { history.replaceState(null, '', location.pathname + location.search + '#wiki') } catch (e) { location.hash = 'wiki' }
    // 性能采样自点击「Wiki」这一刻开始(含模型未就绪的加载/等待阶段)
    profOn = WIKI_PROFILE
    profLast = 0
    profLastFlush = performance.now()
    profReset()
    if (WIKI_PROFILE) console.log('%c[Wiki性能] 开始采样(自点击「Wiki」起, 每 ' + (WIKI_PROFILE_EVERY / 1000) + 's 输出一次)', 'color:#8acaff;font-weight:bold')
    // 晚创建的元素(碎块飞出画布等)一并收进载体, 免得留在卡外穿帮
    Array.prototype.slice.call(document.body.children).forEach(function (el) {
      if (el !== layer && el !== wrap) wrap.appendChild(el)
    })
    poseAt(contentAt(0), false) // 摆到起播帧(相机+骨骼归位, 不抖)
    buildCardRect(true) // 卡位从起播视角按当期视口比例反推
    if (WIKI_DEEPLINK) poseAt(timeline.totalTime, false) // 直达: 相机一步摆到末机位(卡位已反推, 收尾状态与正常播完一致)
    if (wikiDisp) wikiDisp.enter() // RGB 色散重新从 0 渐进入场
    renderScene() // 先出运镜第一帧(相机矩阵就位; 直达时即终帧)
    updateCardTransform() // 此刻为恒等变换: 页面与切场前逐像素同位
    layer.classList.add('show')
    layoutLetterbox() // 先按当前窗口量好条高(此时条还在画面外)
    void layer.offsetHeight // 强制一次布局冲刷: 黑条已就位在画面外, 下面加 .on 才会走过渡滑入
    barTop.classList.add('on')
    barBottom.classList.add('on')
    subtitleEl.classList.add('on') // 字幕: 文案淡入 + 两侧线向文字画出(CSS 里各带延迟)
    document.body.classList.add('wiki-on') // 页面本体已"变成"3D 里的整页卡
    if (!WIKI_DEEPLINK) bakeGroundTile() // 异步烘焙世界地面贴图(在占位 hold 的两秒里完成, 拉远前就位); 直达时世界立即撤退, 不需要地面
    wrap.style.willChange = 'transform'
    if (WIKI_DEEPLINK) beginFocusClear() // 直达: 世界立即进入收尾(与运镜播完那一刻同一路径)
    else if (modelReady) startPlayback()
    else pendingEnter = true // 模型未就绪: 先只展示卡面空场, 落地回调里再起跑
  }
}

// ===== K 帧面板: 现场调控「何时渐停/停留/渐起」「手抖何时开/关」与「起始帧取景」 =====
// 面板挂在覆盖层里(不进卡面), 进入 Wiki 即自动可见; 播放中随时可 K。
// 「导出到控制台」打印两行 const, 粘回文件上方同名常量即可把这次 K 的结果固化下来。
const kPanelEl = document.createElement('div')
kPanelEl.className = 'wiki-kpanel'
kPanelEl.innerHTML = [
  '<div class="wk-head" id="wk-fold"><span>⏱ K 帧调控</span><span class="fold" id="wk-fold-mark">收起 ▾</span></div>',
  '<div class="wk-body" id="wk-body">',
  '  <div class="wk-row">',
  '    <button id="wk-play">⏸ 暂停</button>',
  '    <button id="wk-restart">⟲ 重播</button>',
  '    <button id="wk-start">✎ 调起始帧</button>',
  '    <button id="wk-apply" class="wk-hidden">✓ 应用为起始帧</button>',
  '    <button id="wk-cancel" class="wk-hidden">✖ 取消</button>',
  '    <span class="wk-info" id="wk-info">—</span>',
  '  </div>',
  '  <input class="wk-scrub" id="wk-scrub" type="range" min="0" max="1" step="0.0005" value="0">',
  '  <div class="wk-track" id="wk-track" title="点一下跳到该内容位置; 暗带=开场跳过, 灰带=运镜自带停留, 橙=暂停段, 圆点=手抖键/散焦半径(粉)/曝光(黄)/色散(青)"></div>',
  '  <div class="wk-row wk-kbtns">',
  '    <button id="wk-kpause">K 暂停段 @ 现在</button>',
  '    <button id="wk-kshon">K 手抖开 @ 现在</button>',
  '    <button id="wk-kshoff">K 手抖关 @ 现在</button>',
  '    <button id="wk-kradius">K 散焦半径 @ 现在</button>',
  '    <button id="wk-kexposure">K 曝光 @ 现在</button>',
  '    <button id="wk-kdisp">K 色散 @ 现在</button>',
  '  </div>',
  '  <div class="wk-info">t = 内容秒(运镜轴, 起播跳过前 ' + PLAY_FROM + 's) · hold/渐停/渐起/渐变 = 墙钟秒 · 无手抖键 = 全程开, 有键 = 首键前默认关 · 散焦半径/曝光 = wiki 画面的光斑滤镜(内容秒, 半径 0 = 关) · 色散 = wiki 画面 RGB 色散(内容秒, 强度 0~1, 无键 = 墙钟渐进)</div>',
  '  <div class="wk-rows" id="wk-rows"></div>',
  '  <div class="wk-row">',
  '    <button id="wk-export">导出到控制台</button>',
  '    <button id="wk-clear">清空</button>',
  '    <span class="wk-toast" id="wk-toast"></span>',
  '  </div>',
  '</div>'
].join('')
layer.appendChild(kPanelEl)
if (!SHOW_KPANEL) kPanelEl.style.display = 'none' // 开关 = 上方 SHOW_KPANEL

const hFold = kPanelEl.querySelector('#wk-fold')
const hFoldMark = kPanelEl.querySelector('#wk-fold-mark')
const hBody = kPanelEl.querySelector('#wk-body')
const hPlay = kPanelEl.querySelector('#wk-play')
const hInfo = kPanelEl.querySelector('#wk-info')
const hScrub = kPanelEl.querySelector('#wk-scrub')
const hTrack = kPanelEl.querySelector('#wk-track')
const hRows = kPanelEl.querySelector('#wk-rows')
const hToast = kPanelEl.querySelector('#wk-toast')
const hBtnStart = kPanelEl.querySelector('#wk-start')
const hBtnApply = kPanelEl.querySelector('#wk-apply')
const hBtnCancel = kPanelEl.querySelector('#wk-cancel')

let scrubbing = false // 正在拖进度条: 期间禁手抖、暂离播放
let scrubbingWasPlaying = false
let playheadEl = null
let toastTimer = 0

// ---- 调起始帧: 绕身轨道相机(左键拖动绕转, 滚轮拉远近; 目标点与 model.html 的 OrbitControls 相同) ----
// 该模式里卡按实时相机反推 → 页面恰好满屏, 画面即"起始帧会长什么样": 只见人相对页面的位置与大小。
let startEdit = false
let orbitR = 2, orbitPhi = 1.2, orbitTheta = 0

function enterOrbitFromCamera() {
  const v = camera.position.clone().sub(LOOK_TARGET)
  const len = Math.max(1e-6, v.length())
  orbitR = Math.max(0.8, Math.min(20, len))
  orbitTheta = Math.atan2(v.x, v.z)
  orbitPhi = Math.acos(Math.max(-1, Math.min(1, v.y / len)))
  orbitPhi = Math.max(0.21, Math.min(1.40, orbitPhi)) // 限制俯仰: 太平会让地面卡退化成无限大
}

function updateOrbitCamera() {
  const sp = Math.sin(orbitPhi)
  camera.position.set(
    LOOK_TARGET.x + orbitR * sp * Math.sin(orbitTheta),
    LOOK_TARGET.y + orbitR * Math.cos(orbitPhi),
    LOOK_TARGET.z + orbitR * sp * Math.cos(orbitTheta)
  )
  camera.up.set(0, 1, 0)
  camera.lookAt(LOOK_TARGET)
}

function enterStartEdit() {
  if (startEdit) return
  resetFocusClear() // 从聚焦收尾态进来调帧: 先把世界恢复
  isPlaying = false
  scrubbing = false
  playTime = PLAY_FROM
  wallTime = 0
  poseAt(PLAY_FROM, false) // 骨骼/相机先归位起播帧, 再交给轨道控制
  enterOrbitFromCamera()
  startEdit = true
  syncPlayLabel()
  document.body.classList.add('wiki-editing')
  kPanelEl.classList.add('editing')
  hBtnStart.classList.add('wk-hidden')
  hBtnApply.classList.remove('wk-hidden')
  hBtnCancel.classList.remove('wk-hidden')
  showToast('拖动=绕转 · 滚轮=远近; 满意后「应用为起始帧」')
}

function exitStartEdit() {
  startEdit = false
  document.body.classList.remove('wiki-editing')
  kPanelEl.classList.remove('editing')
  hBtnStart.classList.remove('wk-hidden')
  hBtnApply.classList.add('wk-hidden')
  hBtnCancel.classList.add('wk-hidden')
}

function applyStartFrame() {
  waypoints[0].pos.copy(camera.position)
  waypoints[0].quat.copy(camera.quaternion)
  updateCurves()  // 曲线/弧长/Squad/时间轴按新起点整体重建(hold:2 等属性保留, 总时长不变)
  buildSchedule()
  buildCardRect() // 与实时反推结果一致, 无跳变
  exitStartEdit()
  playTime = PLAY_FROM
  wallTime = 0
  renderTrack()
  showToast('起始帧已应用; 点「导出到控制台」把新航点粘回代码')
}

hBtnStart.addEventListener('click', enterStartEdit)
hBtnApply.addEventListener('click', applyStartFrame)
hBtnCancel.addEventListener('click', function () { exitStartEdit(); showToast('已取消(起始帧未改动)') })

renderer.domElement.addEventListener('mousedown', function (e) {
  if (!startEdit) return
  e.preventDefault()
  let px = e.clientX, py = e.clientY
  function onMove(ev) {
    orbitTheta -= (ev.clientX - px) * 0.005 // 方向与 OrbitControls 一致
    orbitPhi -= (ev.clientY - py) * 0.005
    orbitPhi = Math.max(0.21, Math.min(1.40, orbitPhi))
    px = ev.clientX; py = ev.clientY
  }
  function onUp() {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
})

renderer.domElement.addEventListener('wheel', function (e) {
  if (!startEdit) return
  e.preventDefault()
  orbitR = Math.max(0.8, Math.min(20, orbitR * (e.deltaY > 0 ? 1.1 : 1 / 1.1)))
}, { passive: false })

function syncPlayLabel() { hPlay.textContent = isPlaying ? '⏸ 暂停' : '▶ 播放' }

function showToast(msg) {
  hToast.textContent = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(function () { hToast.textContent = '' }, 2600)
}

// 跳到内容时刻: 摆位交给下一帧的两个分支(都每帧重摆), 这里只改时间
function seekTo(c) {
  if (!timeline) return
  resetFocusClear() // 拖进度条回焦点之前: 世界恢复
  c = Math.max(PLAY_FROM, Math.min(timeline.totalTime, c))
  playTime = c
  wallTime = wallAtContent(c) // 墙钟跟着跳, 手抖相位与位置对应
}

function togglePlay() {
  if (startEdit) exitStartEdit() // 从调起始帧里按播放: 退出该模式(未应用则起始帧不变)
  if (isPlaying) {
    isPlaying = false // 手动暂停: 墙钟也不走了, 便于审视当前构图
  } else if (timelineTotal > 0 && playTime >= timelineTotal - 1e-6) {
    startPlayback() // 已播完: ▶ 视为从头重播
    return
  } else {
    isPlaying = true
  }
  syncPlayLabel()
}

function addShakeKey(on) {
  SHAKE_KEYS.push({ t: Math.round(playTime * 1000) / 1000, on: on, fade: 0.5 })
  SHAKE_KEYS.sort(function (a, b) { return a.t - b.t })
  buildSchedule(); renderTrack(); renderRows()
  showToast((on ? '手抖开' : '手抖关') + '键已落在 ' + playTime.toFixed(2) + 's')
}

// 数值轨落键: 取当前采样值(无键则用默认)落一枚 { t, v }, 之后在行里手调 v
function addValueKey(arr, v) {
  arr.push({ t: Math.round(playTime * 1000) / 1000, v: v })
  arr.sort(function (a, b) { return a.t - b.t })
  renderTrack(); renderRows()
}

hFold.addEventListener('click', function () {
  const folded = hBody.style.display === 'none'
  hBody.style.display = folded ? '' : 'none'
  hFoldMark.textContent = folded ? '收起 ▾' : '展开 ▸'
})

hPlay.addEventListener('click', togglePlay)

kPanelEl.querySelector('#wk-restart').addEventListener('click', function () { startPlayback() })

hScrub.addEventListener('input', function () {
  if (!scrubbing) { scrubbing = true; scrubbingWasPlaying = isPlaying; isPlaying = false; syncPlayLabel() }
  seekTo(Number(hScrub.value))
})
hScrub.addEventListener('change', function () {
  if (!scrubbing) return
  scrubbing = false
  isPlaying = scrubbingWasPlaying
  syncPlayLabel()
})

hTrack.addEventListener('mousedown', function (e) {
  if (!(timelineTotal > 0)) return
  const r = hTrack.getBoundingClientRect()
  seekTo((e.clientX - r.left) / Math.max(1, r.width) * timelineTotal)
})

kPanelEl.querySelector('#wk-kpause').addEventListener('click', function () {
  PAUSE_KEYS.push({ t: Math.round(playTime * 1000) / 1000, hold: 2, easeIn: 0.5, easeOut: 0.5 })
  PAUSE_KEYS.sort(function (a, b) { return a.t - b.t })
  buildSchedule(); renderTrack(); renderRows()
  showToast('暂停段已落在 ' + playTime.toFixed(2) + 's')
})
kPanelEl.querySelector('#wk-kshon').addEventListener('click', function () { addShakeKey(true) })
kPanelEl.querySelector('#wk-kshoff').addEventListener('click', function () { addShakeKey(false) })
kPanelEl.querySelector('#wk-kradius').addEventListener('click', function () {
  const cur = sampleTrack(GLOW_RADIUS_KEYS, playTime)
  const v = (cur == null) ? GLOW_RADIUS_DEFAULT : Math.round(cur)
  addValueKey(GLOW_RADIUS_KEYS, v)
  showToast('散焦半径键已落在 ' + playTime.toFixed(2) + 's, 半径 ' + v + 'px')
})
kPanelEl.querySelector('#wk-kexposure').addEventListener('click', function () {
  const cur = sampleTrack(GLOW_EXPOSURE_KEYS, playTime)
  const v = (cur == null) ? GLOW_EXPOSURE_DEFAULT : cur
  addValueKey(GLOW_EXPOSURE_KEYS, v)
  showToast('曝光键已落在 ' + playTime.toFixed(2) + 's, 曝光 ' + v)
})
kPanelEl.querySelector('#wk-kdisp').addEventListener('click', function () {
  // 无键时落"当前画面上的强度"(走的是墙钟渐进值), 有键则落采样值 —— 落下去的就是眼前所见
  const cur = sampleTrack(DISP_KEYS, playTime)
  const live = (wikiDisp && wikiDisp.getStrength) ? wikiDisp.getStrength() : DISP_DEFAULT
  const v = (cur == null) ? Math.round(live * 100) / 100 : cur
  addValueKey(DISP_KEYS, v)
  showToast('色散键已落在 ' + playTime.toFixed(2) + 's, 强度 ' + v)
})

kPanelEl.querySelector('#wk-export').addEventListener('click', function () {
  const r3 = function (v) { return Math.round((Number(v) || 0) * 1000) / 1000 }
  const pl = PAUSE_KEYS.map(function (k) { return { t: r3(k.t), hold: r3(k.hold), easeIn: r3(k.easeIn), easeOut: r3(k.easeOut) } })
  const sl = SHAKE_KEYS.map(function (k) { return { t: r3(k.t), on: !!k.on, fade: r3(k.fade) } })
  const rl = GLOW_RADIUS_KEYS.map(function (k) { return { t: r3(k.t), v: r3(k.v) } })
  const el = GLOW_EXPOSURE_KEYS.map(function (k) { return { t: r3(k.t), v: r3(k.v) } })
  const dl = DISP_KEYS.map(function (k) { return { t: r3(k.t), v: r3(k.v) } })
  const w0 = waypoints[0]
  const w0line = '{ pos: [' + r3(w0.pos.x) + ', ' + r3(w0.pos.y) + ', ' + r3(w0.pos.z) + '], ' +
    'quat: [' + r3(w0.quat.x) + ', ' + r3(w0.quat.y) + ', ' + r3(w0.quat.z) + ', ' + r3(w0.quat.w) + ']' +
    (w0.hold ? ', hold: ' + w0.hold : '') + ' },'
  console.log('const PLAY_FROM = ' + PLAY_FROM +
    '\nconst PAUSE_KEYS = ' + JSON.stringify(pl) +
    '\nconst SHAKE_KEYS = ' + JSON.stringify(sl) +
    '\nconst GLOW_RADIUS_KEYS = ' + JSON.stringify(rl) + ' // 光斑滤镜: 散焦半径(px; 0 = 关)按内容秒插值\n' +
    'const GLOW_EXPOSURE_KEYS = ' + JSON.stringify(el) + ' // 光斑滤镜: 曝光按内容秒插值\n' +
    'const DISP_KEYS = ' + JSON.stringify(dl) + ' // RGB 色散: 强度 0~1 按内容秒插值(空 = 走 dispfilter 的墙钟渐进)\n' +
    '\nconst CARD_MOVE_FROM = ' + CARD_MOVE_FROM + ' // 卡片后移(走路假象)起步时刻(内容秒)\n' +
    'const CARD_MOVE_SPEED = ' + CARD_MOVE_SPEED + ' // 后移速度(米/秒; 按骨骼着地脚掌实测, 改动会滑步)\n' +
    'const CARD_MOVE_DIR = [' + CARD_MOVE_DIR.join(', ') + '] // 后移方向(世界 x, z)\n' +
    '// DEFAULT_WAYPOINTS 第一行(起始帧; 调过才需要替换):\n' + w0line)
  showToast('已打印: 常量块 + 起始帧航点一行(见控制台 F12)')
})

kPanelEl.querySelector('#wk-clear').addEventListener('click', function () {
  PAUSE_KEYS.length = 0
  SHAKE_KEYS.length = 0
  GLOW_RADIUS_KEYS.length = 0
  GLOW_EXPOSURE_KEYS.length = 0
  DISP_KEYS.length = 0
  buildSchedule(); renderTrack(); renderRows()
  showToast('已清空: 回到无暂停 / 全程手抖 / 无光斑滤镜 / 无色散键')
})

// 键行编辑: input 只改数据 + 重建调度, 不重排行(保住输入焦点); 删除/开关才重排行
hRows.addEventListener('input', function (e) {
  const inp = e.target
  if (inp.tagName !== 'INPUT') return
  const row = inp.closest('.wk-keyrow')
  const arr = KEY_SETS[row.dataset.kind]
  const k = arr[Number(row.dataset.i)]
  if (!k) return
  k[inp.dataset.f] = Math.max(0, Number(inp.value) || 0)
  buildSchedule(); renderTrack()
})
hRows.addEventListener('click', function (e) {
  const row = e.target.closest('.wk-keyrow')
  if (!row) return
  const arr = KEY_SETS[row.dataset.kind]
  const i = Number(row.dataset.i)
  if (!arr[i]) return
  if (e.target.classList.contains('del')) {
    arr.splice(i, 1)
    buildSchedule(); renderTrack(); renderRows()
  } else if (e.target.classList.contains('onoff')) {
    arr[i].on = !arr[i].on
    e.target.textContent = arr[i].on ? '开' : '关'
    buildSchedule(); renderTrack()
  }
})

function renderRows() {
  const rows = []
  PAUSE_KEYS.forEach(function (k, i) {
    rows.push('<div class="wk-keyrow" data-kind="p" data-i="' + i + '">' +
      '<span class="tag">暂停</span>' +
      't <input type="number" data-f="t" step="0.1" min="0" value="' + k.t + '">' +
      'hold <input type="number" data-f="hold" step="0.1" min="0" value="' + k.hold + '">' +
      '渐停 <input type="number" data-f="easeIn" step="0.1" min="0" value="' + k.easeIn + '">' +
      '渐起 <input type="number" data-f="easeOut" step="0.1" min="0" value="' + k.easeOut + '">' +
      '<button class="del" title="删除">✕</button></div>')
  })
  SHAKE_KEYS.forEach(function (k, i) {
    rows.push('<div class="wk-keyrow" data-kind="s" data-i="' + i + '">' +
      '<span class="tag">手抖</span>' +
      't <input type="number" data-f="t" step="0.1" min="0" value="' + k.t + '">' +
      '<button class="onoff" title="切换开/关">' + (k.on ? '开' : '关') + '</button>' +
      '渐变 <input type="number" data-f="fade" step="0.1" min="0" value="' + k.fade + '">' +
      '<button class="del" title="删除">✕</button></div>')
  })
  GLOW_RADIUS_KEYS.forEach(function (k, i) {
    rows.push('<div class="wk-keyrow" data-kind="r" data-i="' + i + '">' +
      '<span class="tag">散焦</span>' +
      't <input type="number" data-f="t" step="0.1" min="0" value="' + k.t + '">' +
      '半径 <input type="number" data-f="v" step="1" min="0" value="' + k.v + '">' +
      '<button class="del" title="删除">✕</button></div>')
  })
  GLOW_EXPOSURE_KEYS.forEach(function (k, i) {
    rows.push('<div class="wk-keyrow" data-kind="e" data-i="' + i + '">' +
      '<span class="tag">曝光</span>' +
      't <input type="number" data-f="t" step="0.1" min="0" value="' + k.t + '">' +
      '曝光 <input type="number" data-f="v" step="0.05" min="0" value="' + k.v + '">' +
      '<button class="del" title="删除">✕</button></div>')
  })
  DISP_KEYS.forEach(function (k, i) {
    rows.push('<div class="wk-keyrow" data-kind="d" data-i="' + i + '">' +
      '<span class="tag">色散</span>' +
      't <input type="number" data-f="t" step="0.1" min="0" value="' + k.t + '">' +
      '强度 <input type="number" data-f="v" step="0.05" min="0" max="1" value="' + k.v + '">' +
      '<button class="del" title="删除">✕</button></div>')
  })
  hRows.innerHTML = rows.join('') || '<div class="wk-info">暂无键: 播放/拖动到位置后点上方「K …」落键</div>'
}

function renderTrack() {
  const total = timelineTotal
  if (!(total > 0)) { hTrack.innerHTML = ''; playheadEl = null; return }
  const pct = function (v) { return (Math.max(0, Math.min(total, v)) / total) * 100 }
  const parts = []
  if (PLAY_FROM > 0) parts.push('<i class="wk-band-trim" style="left:0%;width:' + pct(PLAY_FROM) + '%"></i>') // 开场跳过区
  if (timeline) timeline.events.forEach(function (ev) { // 运镜自带停留(只停相机)
    if (ev.type === 'hold') parts.push('<i class="wk-band-hold" style="left:' + pct(ev.start) + '%;width:' + pct(ev.end - ev.start) + '%"></i>')
  })
  PAUSE_KEYS.forEach(function (k) {
    const t = Math.max(0, Math.min(total, Number(k.t) || 0))
    const cIn = Math.max(0, Math.min(0.5 * (Number(k.easeIn) || 0), t))
    const cOut = Math.max(0, Math.min(0.5 * (Number(k.easeOut) || 0), total - t))
    if (cIn > 0) parts.push('<i class="wk-band-in" style="left:' + pct(t - cIn) + '%;width:' + pct(cIn) + '%"></i>')
    if (cOut > 0) parts.push('<i class="wk-band-out" style="left:' + pct(t) + '%;width:' + pct(cOut) + '%"></i>')
    parts.push('<i class="wk-tick" style="left:' + pct(t) + '%"></i>')
  })
  SHAKE_KEYS.forEach(function (k) {
    const t = Math.max(0, Math.min(total, Number(k.t) || 0))
    parts.push('<i class="wk-dot ' + (k.on ? 'wk-dot-on' : 'wk-dot-off') + '" style="left:' + pct(t) + '%"></i>')
  })
  GLOW_RADIUS_KEYS.forEach(function (k) {
    const t = Math.max(0, Math.min(total, Number(k.t) || 0))
    parts.push('<i class="wk-dot wk-dot-rad" style="left:' + pct(t) + '%"></i>')
  })
  GLOW_EXPOSURE_KEYS.forEach(function (k) {
    const t = Math.max(0, Math.min(total, Number(k.t) || 0))
    parts.push('<i class="wk-dot wk-dot-exp" style="left:' + pct(t) + '%"></i>')
  })
  DISP_KEYS.forEach(function (k) {
    const t = Math.max(0, Math.min(total, Number(k.t) || 0))
    parts.push('<i class="wk-dot wk-dot-disp" style="left:' + pct(t) + '%"></i>')
  })
  parts.push('<i class="wk-playhead" id="wk-playhead"></i>')
  hTrack.innerHTML = parts.join('')
  playheadEl = kPanelEl.querySelector('#wk-playhead')
}

function shakeLabel() {
  if (!SHAKE_KEYS.length) return '全程开'
  const g = shakeGain(playTime, wallTime)
  return g > 0.999 ? '开' : (g < 0.001 ? '关' : Math.round(g * 100) + '%')
}

function updateKPanelHud() {
  if (hBody.style.display === 'none') return
  const radV = sampleTrack(GLOW_RADIUS_KEYS, playTime)
  const expV = sampleTrack(GLOW_EXPOSURE_KEYS, playTime)
  const dispV = sampleTrack(DISP_KEYS, playTime)
  hInfo.textContent = startEdit
    ? '✎ 调起始帧: 拖动=绕转 · 滚轮=远近 → 满意后「应用为起始帧」'
    : '内容 ' + playTime.toFixed(2) + ' / ' + timelineTotal.toFixed(2) + 's · 墙钟 ' + wallTime.toFixed(2) + 's · 手抖 ' + shakeLabel() +
      ' · 散焦 ' + (radV == null ? 0 : radV).toFixed(1) + 'px · 曝光 ' + (expV == null ? GLOW_EXPOSURE_DEFAULT : expV).toFixed(2) +
      ' · 色散 ' + (dispV == null ? '渐进' : Math.round(dispV * 100) + '%')
  if (!scrubbing) hScrub.value = String(playTime)
  if (playheadEl) playheadEl.style.left = (timelineTotal > 0 ? playTime / timelineTotal * 100 : 0) + '%'
}

hScrub.min = String(PLAY_FROM)
hScrub.max = String(timelineTotal > 0 ? timelineTotal : 1)
renderRows()
renderTrack()
syncPlayLabel()

window.addEventListener('resize', function () {
  if (_released) { relayoutHeader(); return } // 白幕收尾后只让 header 跟随窗口重排
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  layoutLetterbox() // 遮幅条高随窗口比例重算
  if (focusT >= 0) layoutLabels() // 环视模式: 四角字幕按新窗口比例重排
})

// 直达内容 wiki(URL 带 #content): 起始页直接就是终态, 首页与 wiki 的一切都不需要创建
if (CONTENT_DEEPLINK) bootContentPage()
else {
  frame()
  // 直达 wiki 链接(URL 带 #wiki): 模块就绪即自动进入, 不经过首页菜单(开场已由 tyndall.js 跳过)
  if (WIKI_DEEPLINK) WikiModel.enter()
}
