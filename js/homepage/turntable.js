//turntable.js
(function () {
      // 右下角黑胶唱片: DOM 与样式全部由本模块注入, index.html 不再含相关代码
      var CSS = [
        '@font-face {',
        "  font-family: 'Rondal';",
        "  src: url('../asset/font/Rondal-Regular.otf') format('opentype');",
        '  font-display: swap;',
        '}',
        '.turntable {',
        '  position: fixed;',
        '  right: 36px;',
        '  bottom: 28px;',
        '  width: clamp(140px, 18vw, 260px);',
        '  aspect-ratio: 1 / 1;',
        '  z-index: 20;',
        '  pointer-events: none;',
        // 整组(唱片/封面/标题/编号/波形)缩小到 1/2: 以右下角为原点等比缩放,
        // 视觉锚点仍贴在 right/bottom 处, 子元素百分比定位与 vw 字号一并精确减半
        '  transform: scale(0.7);',
        '  transform-origin: 100% 100%;',
        '  opacity: 0; /* 与其余 2D UI 同序: 标题装配完成后由 tyndall.js 调 show() 淡入 */',
        '  transition: opacity 0.6s ease;',
        '}',
        '.turntable.show {',
        '  opacity: 1;',
        '}',
        '.turntable__base, .turntable__light {',
        '  position: absolute; top: 0; right: 50%; width: 100%; height: 100%; object-fit: contain;',
        '}',
        '.turntable__base {',
        '  animation: turntable-spin 18s linear infinite;',
        '}',
        '.turntable__light {',
        '  mix-blend-mode: color-dodge; opacity: 0.8;',
        '}',
        '.turntable__sleeve {',
        '  position: absolute;',
        '  top: 0;',
        '  right: 0;',
        '  width: 100%;',
        '  aspect-ratio: 1 / 1;',
        '  object-fit: cover;',
        '  border-radius: 2px;',
        '  box-shadow: -10px 10px 26px rgba(0, 0, 0, 0.55);',
        '  z-index: 2;',
        '}',
        // 唱片标题: 位于唱片袋外侧左边下方, 右下角与袋子左下角对角贴住
        '.turntable__title {',
        '  position: absolute;',
        '  right: 110%;',
        '  bottom: 0;',
        "  font-family: 'Rondal', serif;",
        '  font-size: clamp(13px, 2.5vw, 60px);',
        '  line-height: 1;',
        '  letter-spacing: 0.02em;',
        '  color: #fff;',
        '  white-space: nowrap;',
        '  text-align: right;',
        '  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);',
        '  z-index: 3;',
        '}',
        // 中文副标题「（深渊跬步）」字号为主标题的 1/3, 底部与主标题基线对齐
        '.turntable__title-sub {',
        '  font-size: 0.333em;',
        '  letter-spacing: 0.08em;',
        '  margin-left: 0.35em;',
        '}',
        // 实时音频波形: 与标题同一锚点(唱片袋左侧、底部对齐), 处于文字下层, 无背景
        '.turntable__wave {',
        '  position: absolute;',
        '  right: 110%;',
        '  bottom: 0;',
        '  width: 250%;',
        '  height: clamp(30px, 4.2vw, 52px);',
        '  display: block;',
        '  z-index: 1;',
        '}',
        // 曲目编号小字: 位于整个唱片元素【上方外侧】, 与元素左缘对齐
        '.turntable__index {',
        '  position: absolute;',
        '  left: 0;',
        '  bottom: calc(100% + 8px);',
        "  font-family: 'Rondal', serif;",
        '  font-size: clamp(9px, 0.85vw, 14px);',
        '  letter-spacing: 0.22em;',
        '  color: rgba(255, 255, 255, 0.72);',
        '  white-space: nowrap;',
        '  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);',
        '  z-index: 21;',
        '}',
        '@keyframes turntable-spin {',
        '  from { transform: rotate(0deg); } to { transform: rotate(360deg); }',
        '}'
      ].join('\n')

      var style = document.createElement('style')
      style.textContent = CSS
      document.head.appendChild(style)

      // img 的 src 相对文档(index.html)解析, 与之前写在 HTML 里的路径一致
      var root = document.querySelector('.page') || document.body

      var box = document.createElement('div')
      box.className = 'turntable'

      var base = document.createElement('img')
      base.className = 'turntable__base'
      base.src = '../asset/image/turntable/film-basecolor.png'
      base.alt = ''

      var light = document.createElement('img')
      light.className = 'turntable__light'
      light.src = '../asset/image/turntable/film-light.png'
      light.alt = ''

      var sleeve = document.createElement('img')
      sleeve.className = 'turntable__sleeve'
      sleeve.src = '../asset/image/turntable/void/void-cover.jpg'
      sleeve.alt = ''

      var title = document.createElement('div')
      title.className = 'turntable__title'
      title.innerHTML = 'Void Stride<span class="turntable__title-sub">（深渊跬步）</span>'

      var index = document.createElement('div')
      index.className = 'turntable__index'
      index.textContent = '#06 The Void'

      box.appendChild(base)
      box.appendChild(light)
      box.appendChild(sleeve)
      box.appendChild(title)
      box.appendChild(index)
      root.appendChild(box)

      // ===== 对外接口: 唱片整组(唱片/唱片袋/标题/编号)与其余 UI 共用淡入时序 =====
      window.TurntableUI = {
        show: function () { box.classList.add('show') },
        hide: function () { box.classList.remove('show') }
      }

      // ===== 实时音频波形(canvas, 与标题同锚点、文字下层) =====
      // 波形可视化总开关: false 时只保留音乐播放, 不挂载 canvas、不建 AudioContext 分析图、不跑渲染循环
      var WAVE_ENABLED = false
      var TRACKS_URL = '../asset/music/tracks.json'
      var TRACK_TITLE = 'Void Stride（深渊跬步）'
      var FALLBACK_TRACKS = [
        { title: TRACK_TITLE, src: '../asset/music/lmgc.mp3', volume: 0.8, loop: true }
      ]

      var waveCanvas = document.createElement('canvas')
      waveCanvas.className = 'turntable__wave'
      if (WAVE_ENABLED) box.appendChild(waveCanvas)

      function initWaveform(track) {
        var audio = new Audio(track.src)
        audio.loop = track.loop !== false
        audio.volume = typeof track.volume === 'number' ? track.volume : 0.8
        audio.preload = 'auto'

        var actx = null, analyser = null, waveData = null
        var SHADOW_LAYERS = 5 // 5 层时间滞后影子波
        var SHADOW_STRIDE = 3 // 每隔 N 帧滚动一次历史, 拉开影子时间差(~250ms 总拖影)
        var frameCount = 0
        var waveHistory = []

        // 立即建立 AudioContext -> Analyser 图(context 可先处于 suspended)
        function ensureGraph() {
          if (actx) return
          var AC = window.AudioContext || window.webkitAudioContext
          if (!AC) return
          actx = new AC()
          var srcNode = actx.createMediaElementSource(audio)
          analyser = actx.createAnalyser()
          analyser.fftSize = 2048
          analyser.smoothingTimeConstant = 0.72
          srcNode.connect(analyser)
          analyser.connect(actx.destination)
          waveData = new Uint8Array(analyser.fftSize)
          // 时域静音基准值为 128, 历史缓冲必须预填 128, 否则 abs(0-128) 会被误判成满振幅
          for (var k = 0; k < SHADOW_LAYERS; k++) {
            var snap = new Uint8Array(analyser.fftSize)
            snap.fill(128)
            waveHistory.push(snap)
          }
        }
        if (WAVE_ENABLED) ensureGraph()

        // 默认直接尝试播放; 浏览器拦截时, 在首次手势再试一次兜底
        function tryStart() {
          if (actx && actx.state === 'suspended') actx.resume()
          var p = audio.play()
          if (p && p.catch) p.catch(function () {})
        }
        function onGesture() {
          tryStart()
          if (!audio.paused) {
            document.removeEventListener('pointerdown', onGesture)
            document.removeEventListener('keydown', onGesture)
          }
        }
        audio.addEventListener('playing', function () {
          document.removeEventListener('pointerdown', onGesture)
          document.removeEventListener('keydown', onGesture)
        })
        tryStart()
        document.addEventListener('pointerdown', onGesture)
        document.addEventListener('keydown', onGesture)

        // 按 CSS 尺寸 * DPR 维护 canvas 内部分辨率
        function resizeCanvas() {
          var dpr = Math.min(window.devicePixelRatio || 1, 2)
          var w = Math.max(1, Math.round(waveCanvas.clientWidth * dpr))
          var h = Math.max(1, Math.round(waveCanvas.clientHeight * dpr))
          if (waveCanvas.width !== w || waveCanvas.height !== h) {
            waveCanvas.width = w
            waveCanvas.height = h
            if (fadeCanvas) { fadeCanvas.width = w; fadeCanvas.height = h; fadeGradW = 0 }
          }
        }
        if (WAVE_ENABLED) {
          window.addEventListener('resize', resizeCanvas)
          resizeCanvas()
        }

        var N = 128 // 线状波横向采样点数
        // 由时域数据计算每列峰值包络(0~1), 取中段跳过静音 padding, 小窗口取峰
        function computePeaks(data) {
          var out = computePeaks._buf
          if (!out || out.length !== N + 1) { out = new Float32Array(N + 1); computePeaks._buf = out }
          var dLen = data ? data.length : 1
          var dLo = dLen * 0.1, dSpan = dLen * 0.8
          for (var i = 0; i <= N; i++) {
            var v = 0
            if (data) {
              var s0 = Math.floor(dLo + (i / N) * dSpan)
              var s1 = Math.max(s0 + 1, Math.floor(dLo + ((i + 1) / N) * dSpan))
              var peak = 0
              for (var q = s0; q < s1; q++) {
                var a = Math.abs(data[q] - 128)
                if (a > peak) peak = a
              }
              v = peak / 128
            }
            out[i] = v
          }
          return out
        }

        // heights: 长度 N+1 的 0~1 高度数组; 底部对齐、出声向上抬
        function drawHeights(ctx2, heights, alpha, lineW, glow) {
          var w = waveCanvas.width, h = waveCanvas.height
          ctx2.lineJoin = 'round'
          ctx2.lineCap = 'round'
          ctx2.globalAlpha = alpha
          ctx2.shadowColor = 'rgba(138, 202, 255, 0.85)'
          ctx2.shadowBlur = glow
          ctx2.strokeStyle = '#cfe6ff'
          ctx2.lineWidth = lineW
          ctx2.beginPath()
          for (var i = 0; i <= N; i++) {
            var x = (i / N) * w
            var y = h - heights[i] * h * 0.96
            if (i === 0) ctx2.moveTo(x, y)
            else ctx2.lineTo(x, y)
          }
          ctx2.stroke()
          ctx2.globalAlpha = 1
          ctx2.shadowBlur = 0
        }

        // 离屏层: 所有波先画在这里, 再整体用水平透明度蒙版合成, 实现从左 100% 到右 25% 渐变
        var fadeCanvas = document.createElement('canvas')
        var fadeCtx = fadeCanvas.getContext('2d')
        var fadeGrad = null
        var fadeGradW = 0

        // 主波包络: 峰值保持 + 缓降。新峰值立刻顶上去(attack), 无新高时按指数缓慢回落
        var mainEnv = new Float32Array(N + 1)
        var ENV_DECAY = 0.99 // 每帧残留比例, 越小回落越快(60fps 下 ~0.4s 衰减到 10%)

        function renderLoop() {
          requestAnimationFrame(renderLoop)
          resizeCanvas()
          var ctx2 = waveCanvas.getContext('2d')
          var w = waveCanvas.width, h = waveCanvas.height
          // 首次/尺寸变化时同步离屏层
          if (fadeCanvas.width !== w || fadeCanvas.height !== h) { fadeCanvas.width = w; fadeCanvas.height = h; fadeGradW = 0 }
          fadeCtx.clearRect(0, 0, w, h)

          var instant = null
          if (analyser && waveData) {
            analyser.getByteTimeDomainData(waveData)
            // 历史快照按固定帧间隔滚动: waveHistory[0] 最旧, [SHADOW_LAYERS-1] 次新
            frameCount++
            if (frameCount % SHADOW_STRIDE === 0) {
              for (var s = 0; s < SHADOW_LAYERS - 1; s++) waveHistory[s].set(waveHistory[s + 1])
              waveHistory[SHADOW_LAYERS - 1].set(waveData)
            }
            instant = computePeaks(waveData)
            // 峰值保持缓降: 新高瞬间跟上, 否则每帧乘衰减系数慢慢回落
            for (var e = 0; e <= N; e++) {
              var held = mainEnv[e] * ENV_DECAY
              mainEnv[e] = instant[e] > held ? instant[e] : held
            }
          }

          // 5 层时间滞后影子波: 仍为即时波, 越旧越淡、越细、辉光越弱(先画旧的在底层); 线宽为原来 1/4
          for (var j = 0; j < SHADOW_LAYERS; j++) {
            var age01 = (j + 1) / SHADOW_LAYERS // 0.2(次新) ~ 1.0(最旧)
            var alpha = 0.22 * (1.0 - age01) + 0.03
            var lineW = Math.max(1, h * 0.07) * (1.0 - age01 * 0.45) * 0.25
            var glow = h * 0.18 * (1.0 - age01)
            drawHeights(fadeCtx, computePeaks(waveHistory[j]), alpha, lineW, glow)
          }

          // 当前主波: 峰值保持+缓降包络, 最亮最粗在最上层; 线宽为原来 1/4
          drawHeights(fadeCtx, mainEnv, 1.0, Math.max(1, h * 0.09) * 0.25, h * 0.35)

          // 合成到显示层, 再用水平渐变蒙版把整个波形(含辉光)从左 100% 衰减到右 25%
          ctx2.clearRect(0, 0, w, h)
          ctx2.drawImage(fadeCanvas, 0, 0)
          if (fadeGradW !== w) {
            fadeGrad = ctx2.createLinearGradient(0, 0, w, 0)
            fadeGrad.addColorStop(0.0, 'rgba(0, 0, 0, 1.0)')
            fadeGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0.25)')
            fadeGradW = w
          }
          ctx2.globalCompositeOperation = 'destination-in'
          ctx2.fillStyle = fadeGrad
          ctx2.fillRect(0, 0, w, h)
          ctx2.globalCompositeOperation = 'source-over'
        }
        if (WAVE_ENABLED) renderLoop()
      }

      // 读曲目清单 JSON; 失败时用内置兜底, 保证离线/路径异常时仍有歌
      fetch(TRACKS_URL)
        .then(function (r) { return r.json() })
        .catch(function () { return FALLBACK_TRACKS })
        .then(function (tracks) {
          var track = null
          if (Array.isArray(tracks)) {
            for (var i = 0; i < tracks.length; i++) {
              if (tracks[i] && tracks[i].title === TRACK_TITLE) { track = tracks[i]; break }
            }
            if (!track && tracks.length) track = tracks[0]
          }
          if (track && track.src) initWaveform(track)
        })
    })()
