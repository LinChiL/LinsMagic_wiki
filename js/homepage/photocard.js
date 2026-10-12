// photocard.js
// "更新日志"相片卡片的状态模块(纯 2D/DOM, 不依赖 three.js):
//   1. 卡片右下角的大号悬浮标题(Rondal 字体): 独立挂在 body 上的平铺 2D 层, 不吃舞台的 3D 透视
//      (放在 #cinematic-stage 里会被一起斜切); 每帧按卡片投影后的右下角锚位, 右端收在卡角处
//   2. 相片态背景装饰: 一批与主卡同比例(视口比例)的悬浮白卡, 角度/远近各异, 越远越暗,
//      从主卡四周的暗区里露出来, 与主卡共用同一透视参数, 随相片态淡入淡出、缓慢漂移
//   3. 卡片的相片姿态(后退+三轴旋转)由本模块逐帧接管 —— 改成 JS 驱动是为了能在静态姿态上
//      叠加"悬停微倾"与"常驻微位移/微角度颤动"(纯 CSS 过渡会被逐帧写值拖成慢跟随, 无法叠加)。
// 状态约定(与 index.html / tyndall.js 配合):
//   - index.html 在碎块飞出后给 .page 挂 is-photo-mode → 本模块开始"收拢为卡片"(1.5s, 同旧缓动)
//   - 点击卡片时 index.html 摘掉 is-photo-mode → 本模块按同一缓动反向展开(与进入严格对称)
//   - window._isPhotoMode 用于冻结 tyndall.js 的运镜循环: 飞出时被置 true; 本模块在反向展开
//     走完时置回 false —— 静止态运镜的写回值与此处姿态一致, 交还时无跳变
(function () {
  var stage = document.getElementById('cinematic-stage');
  var page = document.querySelector('.page');
  if (!stage || !page) return;

  // ===== 卡片相片姿态(与原先 is-photo-mode 里的 CSS 值一致) =====
  var PHOTO_TZ = -620; // 向景深后退(px): 视口缩小成相片
  var PHOTO_RX = 15;   // 俯仰(度)
  var PHOTO_RY = -18;  // 偏航(度)
  var PHOTO_RZ = -3;   // 侧倾(度)
  var TWEEN_DURATION = 1.5; // 进入/退出过渡时长(秒), 同旧 CSS transition

  // ===== 手感参数(均为"微微"级, 调大即更明显) =====
  var IDLE_RX = 0.55;      // 常驻微颤: 俯仰幅度(度)
  var IDLE_RY = 0.75;      // 常驻微颤: 偏航幅度(度)
  var IDLE_RZ = 0.28;      // 常驻微颤: 侧倾幅度(度)
  var IDLE_TX = 2.6;       // 常驻微颤: 水平位移(px)
  var IDLE_TY = 2.0;       // 常驻微颤: 垂直位移(px)
  var HOVER_RX = 1.8;      // 悬停微倾: 俯仰上限(度)
  var HOVER_RY = 2.6;      // 悬停微倾: 偏航上限(度)
  var HOVER_FOLLOW = 6.5;  // 悬停微倾的平滑跟随速度(1/s)

  // 悬浮标题右/下端相对卡片右下角的外扩量(em, 随字号缩放): 右端收进卡角内侧(负值继续收进)
  // (横向一路左移 0.5 → 0 → -0.5em), 底边悬在卡角上方少许(0.9 → 0.25em 逐步下移, 0 = 贴卡角)
  var TITLE_OVX_EM = -0.5
  var TITLE_OVY_EM = 0.25

  var CSS = [
    '/* 字体家族 Rondal 在 turntable.js 注册了 Regular; 这里补上自带的真粗体面(700),',
    '   避免浏览器合成粗体发胖 —— 标题用 font-weight:700 即命中此档 */',
    "@font-face { font-family: 'Rondal'; src: url('../asset/font/Rondal-Bold.otf') format('opentype'); font-weight: 700; font-display: swap; }",
    '/* 卡片右下角的大号悬浮标题: 平铺 2D —— 挂在 body 上(不在 #cinematic-stage 内), 不随卡片斜切;',
    '   位置由 photocard.js 每帧把右/下边锚到卡片投影后的右下角, 自身缓慢上下浮动 */',
    '.card-float-title {',
    '  position: fixed;',
    '  right: 0; bottom: 0; /* 占位值, 每帧被 JS 覆盖 */',
    '  z-index: 30; /* 高于 .page 整层(含雪花), 作为前景字形压在最上面 */',
    "  font-family: 'Rondal', serif;",
    '  font-weight: 700; /* 命中上面注册的 Rondal-Bold 真粗体 */',
    '  font-size: clamp(68px, 6vw, 166px); /* 放大后的字号规格(原 clamp(34px,4vw,108px)) */',
    '  line-height: 1;',
    '  letter-spacing: 0.02em;',
    '  color: #ffffff; /* 字身纯白 */',
    '  text-shadow: 0 0 6px rgba(0, 0, 0, 1), 0 0 16px rgba(0, 0, 0, 0.95), 0 0 40px rgba(0, 0, 0, 0.8), 0 0 80px rgba(0, 0, 0, 0.5); /* 黑色模糊描边(加深加强): 近描边两层 + 大晕两层 */',
    '  white-space: nowrap;',
    '  pointer-events: none;',
    '  opacity: 0;',
    '  transition: opacity 0.45s ease; /* 退场: 快速淡出 */',
    '}',
    '/* 中文副标「（虚空与深渊更新）」: 主标 1/3 号 + 常规字重(更细), 另起一行, 与主标左对齐 */',
    '.card-float-title-sub {',
    '  display: block;',
    '  font-size: 0.333em;',
    '  font-weight: 400;',
    '  letter-spacing: 0.08em;',
    '  margin-top: 0.35em;',
    '}',
    '.card-float-title.show {',
    '  opacity: 1;',
    '  transition: opacity 0.9s ease 0.55s; /* 入场: 等卡片基本收拢完再浮现 */',
    '}',
    '@keyframes card-float-bob {',
    '  from { transform: translateY(-3px); }',
    '  to   { transform: translateY(3px); }',
    '}',
    '.card-float-title {',
    '  animation: card-float-bob 6s ease-in-out infinite alternate;',
    '}',
    '/* 相片态背景装饰: 悬浮白卡群(视口比例), 主卡之外的暗区里从近到远铺开 */',
    '.card-deco {',
    '  position: absolute; inset: 0;',
    '  perspective: 1200px; /* 与 .page 同参数: 白卡群与主卡共用一套纵深投影 */',
    '  perspective-origin: center center;',
    '  pointer-events: none;',
    '  opacity: 0;',
    '  transition: opacity 0.5s ease; /* 退场 */',
    '}',
    '.card-deco.show {',
    '  opacity: 1;',
    '  transition: opacity 1.4s ease 0.35s; /* 入场: 卡片收拢过程中慢慢浮现 */',
    '}',
    '.card-deco-card {',
    '  position: absolute; left: 50%; top: 50%;',
    '  border-radius: 4px;',
    '  transform: translate(-50%, -50%) translate3d(var(--dx), var(--dy), var(--z)) rotateX(var(--rx)) rotateY(var(--ry)) rotateZ(var(--rz));',
    '  animation: deco-drift 26s ease-in-out infinite alternate; /* 时长/相位逐卡覆盖 */',
    '}',
    '/* 卡内容区(占位): 相框比例与主卡一致 —— 左右/上 12px 边 + 底部 56px 签名带, 暂用深灰 */',
    '.card-deco-inner {',
    '  position: absolute;',
    '  inset: 1.111% 0.625% 5.185% 0.625%;',
    '  border-radius: 2px;',
    '}',
    '.card-deco:not(.show) .card-deco-card { animation-play-state: paused; /* 隐藏时停转 */ }',
    '/* 缓慢漂移浮空: 关键帧里用 var 复读整条摆放变换, 只叠一点位移与转动 */',
    '@keyframes deco-drift {',
    '  from { transform: translate(-50%, -50%) translate3d(var(--dx), var(--dy), var(--z)) translate3d(0, -1.4vh, 0) rotateX(var(--rx)) rotateY(var(--ry)) rotateZ(calc(var(--rz) - 0.9deg)); }',
    '  to   { transform: translate(-50%, -50%) translate3d(var(--dx), var(--dy), var(--z)) translate3d(0, 1.4vh, 0) rotateX(var(--rx)) rotateY(var(--ry)) rotateZ(calc(var(--rz) + 0.9deg)); }',
    '}'
  ].join('\n')

  var style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  var title = document.createElement('div')
  title.className = 'card-float-title'
  title.appendChild(document.createTextNode('1.10：Void'))
  var titleSub = document.createElement('span')
  titleSub.className = 'card-float-title-sub'
  titleSub.textContent = '（虚空与深渊更新）'
  title.appendChild(titleSub)
  document.body.appendChild(title)

  // 角落探针: 贴在舞台右下角, 借浏览器的 3D 投影直接读出卡片右下角投影后的屏幕坐标
  var anchor = document.createElement('i')
  anchor.style.cssText = 'position:absolute;right:0;bottom:0;width:1px;height:1px;visibility:hidden;pointer-events:none;'
  stage.appendChild(anchor)

  // 标题外扩量随 clamp() 字号变化, 尺寸改变时重测
  var _ovx = 0, _ovy = 0
  function measureTitle() {
    var fs = parseFloat(getComputedStyle(title).fontSize) || 64
    _ovx = fs * TITLE_OVX_EM
    _ovy = fs * TITLE_OVY_EM
  }
  measureTitle()
  window.addEventListener('resize', measureTitle)

  // ===== 相片态背景装饰: 悬浮白卡群 =====
  // [投影后的屏幕中心x(%), 屏幕中心y(%), 屏幕宽(vw), z(px), rotX, rotY, rotZ, 漂移时长(s), 相位(s)]
  // 屏幕坐标按"落点"编排: 让白卡从主卡四周的暗区里露出来, z 全部在主卡之后(-620)由近到远;
  // 近端同样拉深(原 -900 → -2700, 即近端也乘 3), 远端 -12600;
  // 越近的卡尺寸同时收小 —— 共用一个透视投影, 只推 z 肉眼几乎无差别, 尺寸才是"远近"的读数
  var DECO_SPECS = [
    [13, 14, 20,  -2700,  16,  22,  -9, 24,  -6],
    [55,  6, 19,  -4200, -12,  18,   6, 30, -14],
    [95, 42, 25,  -3400,  20, -28,  12, 26, -21],
    [12, 86, 24,  -5300,  26,  30, -14, 34,  -9],
    [46, 95, 34,  -6600, -24, -20,   9, 28, -17],
    [76, 12, 16, -10300, -18,  34,  -6, 37, -25],
    [ 5, 45, 14,  -8200,  22, -26,  15, 22, -12],
    [88, 92, 18, -12600,  30,  24, -12, 33,  -3]
  ]
  var DECO_PERSPECTIVE = 1200 // 与 .page 的 perspective 一致

  var deco = document.createElement('div')
  deco.className = 'card-deco'
  // 远卡先入 DOM → 后画的近卡天然盖在上面(纯 2D 绘制序, 不依赖 3D 深度排序)
  DECO_SPECS.slice().sort(function (a, b) { return a[3] - b[3] }).forEach(function (s) {
    var z = s[3]
    var scale = DECO_PERSPECTIVE / (DECO_PERSPECTIVE - z) // z 为负 → <1
    var tone = Math.round((242 - 214 * Math.min(1, Math.max(0, (-z - 2400) / 10200))) * 0.2) // 基础暗度: 梯度整体压暗(系数越小越暗, 现 0.2) —— 近端 ≈#2f, 远端 ≈#06, 越深越暗
    var card = document.createElement('div')
    card.className = 'card-deco-card'
    card.style.width = (s[2] / scale).toFixed(1) + 'vw' // 宽高同值 → 与主卡(视口)同比例
    card.style.height = (s[2] / scale).toFixed(1) + 'vh'
    card.style.background = 'rgb(' + tone + ',' + tone + ',' + tone + ')'
    card.style.setProperty('--dx', ((s[0] - 50) / scale).toFixed(1) + 'vw')
    card.style.setProperty('--dy', ((s[1] - 50) / scale).toFixed(1) + 'vh')
    card.style.setProperty('--z', z + 'px')
    card.style.setProperty('--rx', s[4] + 'deg')
    card.style.setProperty('--ry', s[5] + 'deg')
    card.style.setProperty('--rz', s[6] + 'deg')
    card.style.animationDuration = s[7] + 's'
    card.style.animationDelay = s[8] + 's'
    // 内容区占位(留边见 .card-deco-inner): 深灰, 随远卡一起压暗
    var inner = document.createElement('i')
    inner.className = 'card-deco-inner'
    var ct = Math.round(tone * 0.25)
    inner.style.background = 'rgb(' + ct + ',' + ct + ',' + ct + ')'
    card.appendChild(inner)
    deco.appendChild(card)
  })
  page.insertBefore(deco, stage) // 排在舞台之前 → 整体压在主卡后面

  // CSS cubic-bezier(0.16, 1, 0.3, 1) 的 JS 版(与旧过渡曲线一致)
  function createBezierEasing(x1, y1, x2, y2) {
    var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
    var cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
    function sampleX(t) { return ((ax * t + bx) * t + cx) * t }
    function sampleY(t) { return ((ay * t + by) * t + cy) * t }
    function sampleDX(t) { return (3 * ax * t + 2 * bx) * t + cx }
    return function (x) {
      var t = x
      for (var i = 0; i < 6; i++) {
        var dx = sampleX(t) - x
        if (Math.abs(dx) < 1e-5) break
        var d = sampleDX(t)
        if (Math.abs(d) < 1e-6) break
        t -= dx / d
      }
      return sampleY(t)
    }
  }
  var easeCard = createBezierEasing(0.16, 1, 0.3, 1)

  // ===== 状态机 =====
  var _active = false;   // 卡片态(收拢/常驻/展开全程)
  var _entering = true;  // 目标方向: true=收拢为卡片, false=反向展开
  var _traw = 0;         // 线性过渡时间轴 0..1(缓动由 easeCard 作用, 中途反向也连续)
  var _raf = 0;
  var _lastMs = 0;
  var _hoverOn = false;  // 指针是否在卡片范围内
  var _tgtHX = 0, _tgtHY = 0;   // 悬停目标角(指针在卡片内的归一化位置 -0.5..0.5)
  var _hX = 0, _hY = 0;         // 悬停角平滑值

  function frame(now) {
    var dt = Math.min(Math.max((now - _lastMs) / 1000, 0), 0.05)
    _lastMs = now

    // 1. 过渡进度: 线性轴往返 —— 与碎块的飞出/倒放同一思路, 中途反向无跳变
    _traw = Math.min(1, Math.max(0, _traw + (_entering ? 1 : -1) * dt / TWEEN_DURATION))
    var e = easeCard(_traw)

    // 2. 悬停微倾: 目标角随指针位置, 指数平滑跟随(离开即回正)
    var k = 1 - Math.exp(-dt * HOVER_FOLLOW)
    _hX += ((_hoverOn ? _tgtHX : 0) - _hX) * k
    _hY += ((_hoverOn ? _tgtHY : 0) - _hY) * k

    // 3. 常驻微颤: 每轴两组低频正弦叠加(避免周期性), 位移+三轴角度, 幅度随过渡两头平滑归零
    var t = now * 0.001
    var wob = e * e
    var idleRx = IDLE_RX * (0.6 * Math.sin(t * 0.31 + 2.1) + 0.4 * Math.sin(t * 0.77 + 0.5))
    var idleRy = IDLE_RY * (0.6 * Math.sin(t * 0.23 + 0.9) + 0.4 * Math.sin(t * 0.61 + 3.7))
    var idleRz = IDLE_RZ * (0.6 * Math.sin(t * 0.19 + 4.2) + 0.4 * Math.sin(t * 0.53 + 1.3))
    var idleTx = IDLE_TX * (0.6 * Math.sin(t * 0.27 + 0.3) + 0.4 * Math.sin(t * 0.71 + 2.9))
    var idleTy = IDLE_TY * (0.6 * Math.sin(t * 0.21 + 5.1) + 0.4 * Math.sin(t * 0.59 + 1.9))

    // 悬停微倾方向: 指针在哪侧, 卡片哪侧朝观察者微倾(rotateX/rotateY 正方向为远离观察者)
    var rx = PHOTO_RX * e + wob * (idleRx + _hY * HOVER_RX)
    var ry = PHOTO_RY * e + wob * (idleRy - _hX * HOVER_RY)
    var rz = PHOTO_RZ * e + wob * idleRz
    var tx = wob * idleTx
    var ty = wob * idleTy

    stage.style.transform =
      'translateZ(' + (PHOTO_TZ * e).toFixed(2) + 'px) ' +
      'rotateX(' + rx.toFixed(3) + 'deg) ' +
      'rotateY(' + ry.toFixed(3) + 'deg) ' +
      'rotateZ(' + rz.toFixed(3) + 'deg) ' +
      'translate3d(' + tx.toFixed(2) + 'px, ' + ty.toFixed(2) + 'px, 0)'

    // 4. 悬浮标题: 每帧把右/下边锚到卡片投影后的右下角(跟随微颤/悬停/收拢全程);
    //    反向展开时冻结在原地随淡出, 不跟着卡片横扫回全屏
    if (_entering) {
      var corner = anchor.getBoundingClientRect()
      title.style.right = (window.innerWidth - corner.right - _ovx).toFixed(1) + 'px'
      title.style.bottom = (window.innerHeight - corner.bottom + _ovy).toFixed(1) + 'px'
    }

    // 5. 反向展开走完: 清空内联姿态, 把运镜循环解冻交还(其静止态写回值与此一致, 无跳变)
    if (!_entering && _traw <= 0) {
      stage.style.transform = ''
      window._isPhotoMode = false
      _active = false
      _raf = 0
      return
    }
    _raf = requestAnimationFrame(frame)
  }

  function startCard() {
    _active = true
    _entering = true
    _lastMs = performance.now()
    measureTitle()
    title.classList.add('show')
    deco.classList.add('show')
    if (!_raf) _raf = requestAnimationFrame(frame)
  }
  function endCard() {
    _entering = false // 反向展开, 归零后自行收尾
    title.classList.remove('show')
    deco.classList.remove('show')
  }

  // 观察 is-photo-mode 挂载/摘除驱动状态机(is-returning 的增删不影响)
  var _wasOn = page.classList.contains('is-photo-mode')
  if (_wasOn) startCard()
  new MutationObserver(function () {
    var on = page.classList.contains('is-photo-mode')
    if (on === _wasOn) return
    _wasOn = on
    if (on) startCard()
    else if (_active) endCard()
  }).observe(page, { attributes: true, attributeFilter: ['class'] })

  // ===== 悬停检测: 相片姿态下舞台的屏幕包围盒即卡片范围 =====
  function onPointerMove(e) {
    if (!_active) { _hoverOn = false; return }
    var r = stage.getBoundingClientRect()
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      _hoverOn = true
      _tgtHX = (e.clientX - r.left) / Math.max(r.width, 1) - 0.5
      _tgtHY = (e.clientY - r.top) / Math.max(r.height, 1) - 0.5
    } else {
      _hoverOn = false
    }
  }
  window.addEventListener('pointermove', onPointerMove)
  document.addEventListener('mouseleave', function () { _hoverOn = false })
  window.addEventListener('blur', function () { _hoverOn = false })
})();
