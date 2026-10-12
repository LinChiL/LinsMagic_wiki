//snow.js
(function () {
      // 雪花覆盖层: 用 WebGL 片元着色器绘制伪 3D 仰视雪景, 白色半透明雪花盖在页面上
      // 背景透明 (用亮度作 alpha), 这样只显示雪点, 不遮挡页面内容
      var canvas = document.getElementById('snow')
      if (!canvas) return

      var gl = canvas.getContext('webgl', {
        alpha: true,
        premultipliedAlpha: false,
        antialias: false
      })
      if (!gl) return

      var VERT = [
        'attribute vec2 a_pos;',
        'void main() {',
        '  gl_Position = vec4(a_pos, 0.0, 1.0);',
        '}'
      ].join('\n')

      // 伪 3D 仰视雪景:
      // 1) 相机位于世界原点并抬头仰视, 每个像素求出世界空间射线方向
      // 2) 雪被组织成若干"世界水平雪层", 射线与每层平面求交得到真实 3D 交点
      // 3) 交点在水平网格里查一片雪花的随机 3D 位置, 再做透视投影 + 1/深度 缩放
      //    越靠近相机的雪花更大更亮, 并且从前方天顶向四周发散 -> 仰视纵深感
      // 4) 屏幕半径小于 1px 的远雪按能量守恒放大成柔和光点, 避免闪烁
      var FRAG = [
        'precision highp float;',
        '',
        'uniform vec2  iResolution;',
        'uniform float iTime;',
        '',
        '/* ---------- 相机 ---------- */',
        'const float PITCH = 1.12;   // 仰角(弧度) 约 64 度',
        'const float FOCAL = 0.62;   // 焦距, 越大视野越窄',
        '',
        '/* ---------- 雪场 ---------- */',
        'const int   LAYERS = 72;    // 雪层数量',
        'const float CELL   = 14.5;   // 水平网格间距(世界单位)',
        'const float FL_R   = 0.075; // 雪花世界半径',
        'const float SPAN   = 90.0;  // 雪层垂直跨度',
        'const float GAP    = 10.5556;// 层间距 = SPAN / LAYERS',
        'const float Y0     = 0.001;  // 最低雪层高度(越小雪花能贴得越近、越大)',
        'const float FALL   = 1.15;  // 下落速度',
        'const float FAR    = 130.0; // 裁剪距离',
        'const float WINDX  = 1.1;  // 风: 水平漂移速度',
        'const float WINDY  = 0.00;',
        'const float SWAY   = 0.5;   // 每片雪随机摆动强度倍率, 0 = 不摆动(只随风漂移)',
        'const float SWAY_Y = 0.35;  // 纵向摆动相对水平方向的比例',
        '',
        '// Dave Hoskins hash. 刻意用标量 out 参数实现, 避免个别驱动对',
        '// dot()/swizzle 组合的误编译(实测会把投影算错)',
        'void hash22(float px, float py, out float ox, out float oy) {',
        '  float a = fract(px * 0.1031);',
        '  float b = fract(py * 0.1030);',
        '  float c = fract(px * 0.0973);',
        '  float d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);',
        '  a += d; b += d; c += d;',
        '  ox = fract((a + b) * c);',
        '  oy = fract((a + c) * b);',
        '}',
        '',
        'void main() {',
        '  // 以屏幕高度为单位的屏幕坐标(中心为原点)',
        '  vec2 ndc = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;',
        '',
        '  float cp = cos(PITCH), sp = sin(PITCH);',
        '',
        '  // 本像素对应的世界空间射线(单位向量): 世界 y 轴朝上, 相机抬头',
        '  float rdx = ndc.x;',
        '  float rdy = cp * ndc.y + sp * FOCAL;',
        '  float rdz = -sp * ndc.y + cp * FOCAL;',
        '  float rl = inversesqrt(rdx * rdx + rdy * rdy + rdz * rdz);',
        '  rdx *= rl; rdy *= rl; rdz *= rl;',
        '',
        '  float acc  = 0.0;',
        '  float rMin = 1.0 / iResolution.y;  // 最小屏幕半径(抗闪烁)',
        '  float wx = WINDX * iTime;',
        '  float wz = WINDY * iTime;',
        '',
        '  for (int i = 0; i < LAYERS; i++) {',
        '    float fi = float(i);',
        '',
        '    // 该雪层当前的世界高度: 所有层整体下落并循环, 层集合不变故不会跳变',
        '    float ph = mod(fi * GAP - iTime * FALL, SPAN);',
        '    float yS = Y0 + ph;',
        '',
        '    // 射线与水平面 y = yS 求交(相机在原点)',
        '    float t = yS / rdy;',
        '    if (t <= 0.0 || t > FAR) continue;',
        '',
        '    // 近处渐隐: 只让雪层贴到相机跟前(也是屏幕上最大的那一刻)才平滑淡出为 0,',
        '    // 既保住"糊在脸上"的冲击力, 又不会在循环到底端时硬跳变',
        '    float nfP = clamp(ph / 0.4, 0.0, 1.0);',
        '    nfP = nfP * nfP * (3.0 - 2.0 * nfP);',
        '    float nearFade = nfP;',
        '',
        '    // 交点落在世界网格的哪个单元(整体随风水平漂移)',
        '    float cellx = floor((rdx * t - wx) / CELL);',
        '    float cellz = floor((rdz * t - wz) / CELL);',
        '',
        '    // 单元内随机偏移, 保证雪花完整落在单元内不被裁切',
        '    float ox, oz;',
        '    hash22(cellx + fi * 17.13, cellz + fi * 71.9, ox, oz);',
        '    ox = (ox - 0.5) * 0.84;',
        '    oz = (oz - 0.5) * 0.84;',
        '',
        '    // 每片雪花独立的摆动参数(另一组 hash): 相位/频率/幅度都不同,',
        '    // 于是每片雪各飘各的, 轨迹是摇曳曲线而不是整齐的直线',
        '    float r1, r2;',
        '    hash22(cellx * 3.17 + fi * 5.23, cellz * 2.71 + fi * 9.11, r1, r2);',
        '    float ph1 = r1 * 6.2832;',
        '    float ph2 = r2 * 6.2832;',
        '    float fr1 = 0.5 + r1 * 0.9;',
        '    float fr2 = 0.4 + r2 * 0.8;',
        '    float amp = SWAY * (0.8 + r2 * 1.4);',
        '',
        '    // 雪花的世界坐标: 整体随风漂移 + 各自的正弦摆动, 纵向再加一点上下浮动',
        '    float Py = yS + sin(iTime * fr2 + ph1) * amp * SWAY_Y;',
        '    float Px = (cellx + 0.5 + ox) * CELL + wx + sin(iTime * fr1 + ph1) * amp;',
        '    float Pz = (cellz + 0.5 + oz) * CELL + wz + cos(iTime * fr2 + ph2) * amp;',
        '',
        '    // 透视投影: 相机空间深度、屏幕位置、屏幕半径(全部用标量, 见上注释)',
        '    float zc = Py * sp + Pz * cp;',
        '',
        '    if (nearFade <= 0.0) continue;',
        '    float sx = Px * FOCAL / zc;',
        '    float sy = (Py * cp - Pz * sp) * FOCAL / zc;',
        '    float r0 = FL_R * FOCAL / zc;',
        '',
        '    // 远雪小于 1px 时放大成柔光(保持总能量), 避免采样闪烁',
        '    float r = max(r0, rMin);',
        '    float dx = ndc.x - sx;',
        '    float dy = ndc.y - sy;',
        '    float d2 = dx * dx + dy * dy;',
        '',
        '    // 性能: 绝大多数 (像素 × 雪层) 组合并不落在雪花覆盖范围内.',
        '    // 先用半径上限 r*1.45 (轮廓最大外扩 1.36 倍) 做一次廉价剔除,',
        '    // 直接跳过下面昂贵的 atan + 三角函数轮廓与 sqrt',
        '    float rMax = r * 1.45;',
        '    if (d2 > rMax * rMax) continue;',
        '    float d = sqrt(d2);',
        '',
        '    // 噪声轮廓: 多频正弦叠加把半径打乱, 每片雪花的相位不同,',
        '    // 于是形状各不相同、边缘不规则, 而不是规整的几何形',
        '    // 半径不足几像素的远雪自动退回圆形, 避免小尺寸下随时间闪烁',
        '    float ang  = atan(dy, dx + 1.0e-5);',
        '    float p1 = r1 * 6.2832;',
        '    float p2 = r2 * 6.2832;',
        '    float p3 = fract(r1 * 3.7 + r2 * 1.3) * 6.2832;',
        '    float nz = 0.5',
        '             + 0.18 * sin(2.0 * ang + p1)',
        '             + 0.13 * sin(3.0 * ang + p2)',
        '             + 0.09 * sin(5.0 * ang + p3);',
        '    float star = clamp((r0 - rMin * 2.0) / (rMin * 3.0), 0.0, 1.0);',
        '    float rr   = r * (1.0 + star * (nz - 0.5) * 0.9);',
        '',
        '    // 柔边衰减; 用显式公式避免 smoothstep(edge0>edge1) 的未定义行为',
        '    float q = clamp(d / rr, 0.0, 1.0);',
        '    q = 1.0 - q;',
        '    acc += nearFade * q * q * (r0 * r0) / (r * r);',
        '  }',
        '',
        '  // 白色雪花, 用亮度作 alpha',
        '  gl_FragColor = vec4(1.0, 1.0, 1.0, clamp(acc, 0.0, 1.0));',
        '}'
      ].join('\n')

      function compile(type, src) {
        var sh = gl.createShader(type)
        if (!sh) return null
        gl.shaderSource(sh, src)
        gl.compileShader(sh)
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          console.warn('snow shader compile error:', gl.getShaderInfoLog(sh))
          gl.deleteShader(sh)
          return null
        }
        return sh
      }

      var vs = compile(gl.VERTEX_SHADER, VERT)
      var fs = compile(gl.FRAGMENT_SHADER, FRAG)
      if (!vs || !fs) return
      var program = gl.createProgram()
      if (!program) return
      gl.attachShader(program, vs)
      gl.attachShader(program, fs)
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.warn('snow program link error:', gl.getProgramInfoLog(program))
        return
      }
      gl.useProgram(program)

      var buf = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
      var locPos = gl.getAttribLocation(program, 'a_pos')
      gl.enableVertexAttribArray(locPos)
      gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0)

      var locTime = gl.getUniformLocation(program, 'iTime')
      var locRes = gl.getUniformLocation(program, 'iResolution')

      // 渲染缩放: 雪花是柔和光点, 不需要按屏幕物理分辨率逐像素渲染.
      // 像素数按平方减少, 0.6 约省 2/3 的片元开销; 太小远处雪点会发糊.
      var SNOW_SCALE = 0.6

      function resize() {
        var dpr = Math.min(window.devicePixelRatio || 1, 2)
        var w = Math.max(1, Math.floor(canvas.clientWidth * dpr * SNOW_SCALE))
        var h = Math.max(1, Math.floor(canvas.clientHeight * dpr * SNOW_SCALE))
        canvas.width = w
        canvas.height = h
        gl.viewport(0, 0, w, h)
      }

      // =========================
      // 控制台性能检测
      // =========================
      // 每 PROFILE_EVERY 毫秒往控制台输出一次, 用来定位性能瓶颈:
      //   帧间隔    实际流畅度, 含浏览器合成 / CSS 动画 / 页面其它开销
      //   draw提交  主线程执行 WebGL 提交命令的耗时(不含 GPU 实际执行)
      //   雪景GPU   雪景着色器的真实 GPU 耗时(需 EXT_disjoint_timer_query)
      //   其余      帧间隔 - 雪景GPU ≈ 合成 / CSS 动画 / 浏览器自身
      var PROFILE = true
      var PROFILE_EVERY = 2000

      var extTimer = gl.getExtension('EXT_disjoint_timer_query')
      // 部分驱动会返回"空壳"扩展(有 createQueryEXT 却缺 getQueryParameterEXT):
      // 功能探测, 方法不全就当扩展不可用, 避免 pollGpu 抛异常拖垮渲染循环
      if (extTimer && typeof extTimer.getQueryParameterEXT !== 'function') extTimer = null
      var queryNow = null
      var queryPending = null
      var profFrames = []
      var profDraw = []
      var profGpu = []
      var profLast = 0
      var profLastFlush = 0
      var profProbe = true // 无计时扩展时, 是否用 gl.finish() 做一次 GPU 真同步探针

      // 从着色器源码里取层数, 避免两处手写不同步
      var mLay = /LAYERS\s*=\s*(\d+)/.exec(FRAG)
      var LAYERS_INFO = mLay ? parseInt(mLay[1], 10) : 0

      function profAvg(a) {
        var s = 0
        for (var i = 0; i < a.length; i++) s += a[i]
        return a.length ? s / a.length : 0
      }

      function profPct(a, p) {
        if (!a.length) return 0
        var s = a.slice().sort(function (x, y) { return x - y })
        return s[Math.min(s.length - 1, Math.floor(s.length * p))]
      }

      function pollGpu() {
        if (!extTimer || !queryPending) return
        var ready = extTimer.getQueryParameterEXT(queryPending, extTimer.QUERY_RESULT_AVAILABLE_EXT)
        if (!ready) return
        if (!gl.getParameter(extTimer.GPU_DISJOINT_EXT)) {
          profGpu.push(extTimer.getQueryParameterEXT(queryPending, extTimer.QUERY_RESULT_EXT) / 1e6)
        }
        extTimer.deleteQueryEXT(queryPending)
        queryPending = null
      }

      function profileFlush() {
        if (!profFrames.length) return
        var frame = profAvg(profFrames)
        var px = canvas.width * canvas.height
        var hasGpu = profGpu.length > 0
        console.log(
          '%c[雪景性能] ' + frame.toFixed(2) + 'ms/帧 (' + (1000 / frame).toFixed(1) + ' FPS)',
          'color:#6cf;font-weight:bold',
          '\n  帧间隔   avg ' + frame.toFixed(2) + '  p95 ' + profPct(profFrames, 0.95).toFixed(2) + '  max ' + profPct(profFrames, 1).toFixed(2) + ' ms',
          '\n  draw提交 avg ' + profAvg(profDraw).toFixed(3) + ' ms (主线程, 不含 GPU)',
          '\n  雪景GPU  ' + (hasGpu
            ? profAvg(profGpu).toFixed(2) + ' ms  max ' + profPct(profGpu, 1).toFixed(2) + ' ms' + (extTimer ? '' : ' [finish探针]')
            : '采样中…'),
          '\n  其余     ' + (hasGpu ? '≈ ' + (frame - profAvg(profGpu)).toFixed(2) + ' ms (合成/CSS动画/浏览器)' : '未知'),
          '\n  负载     ' + canvas.width + '×' + canvas.height + ' = ' + (px / 1e6).toFixed(2) + 'M 片元 × ' + LAYERS_INFO + ' 层 = ' + (px * LAYERS_INFO / 1e6).toFixed(1) + 'M 次/帧',
          '\n  参数     SNOW_SCALE=' + SNOW_SCALE + '  dpr=' + (window.devicePixelRatio || 1).toFixed(2)
        )
        var p95v = profPct(profFrames, 0.95), maxv = profPct(profFrames, 1)
        profFrames = []
        profDraw = []
        profGpu = []
        profProbe = true
        var _hist = window.__SNOW_PERF__ = window.__SNOW_PERF__ || []
        _hist.push({ t: Math.round(performance.now()), frame: +frame.toFixed(2), p95: +p95v.toFixed(2), max: +maxv.toFixed(2), draw: +profAvg(profDraw).toFixed(3) })
        if (_hist.length > 60) _hist.shift()
      }

      function draw(now) {
        var ts = performance.now()
        if (PROFILE && extTimer) {
          queryNow = extTimer.createQueryEXT()
          extTimer.beginQueryEXT(extTimer.TIME_ELAPSED_EXT, queryNow)
        }

        var t = (now - t0) / 1000
        gl.useProgram(program)
        gl.uniform1f(locTime, t)
        gl.uniform2f(locRes, canvas.width, canvas.height)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

        if (PROFILE && extTimer) {
          extTimer.endQueryEXT(extTimer.TIME_ELAPSED_EXT)
          queryPending = queryNow
          queryNow = null
        }
        if (PROFILE) profDraw.push(performance.now() - ts)
        // 无计时扩展时改用 gl.finish() 真同步探针: 会阻塞至 GPU 完成, 故每次刷新只做一帧
        if (PROFILE && !extTimer && profProbe) {
          gl.finish()
          profGpu.push(performance.now() - ts)
          profProbe = false
        }
      }

      var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      var raf = 0
      var t0 = performance.now()

      function loop(now) {
        if (PROFILE) {
          if (profLast) profFrames.push(now - profLast)
          profLast = now
          pollGpu()
        }
        draw(now)
        if (PROFILE && now - profLastFlush >= PROFILE_EVERY) {
          profileFlush()
          profLastFlush = now
        }
        raf = requestAnimationFrame(loop)
      }

      function onVis() {
        cancelAnimationFrame(raf)
        profLast = 0 // 切回前台后别把后台停留的时间算成一帧
        if (!document.hidden && !reduce) raf = requestAnimationFrame(loop)
      }

      resize()
      new ResizeObserver(resize).observe(canvas)
      document.addEventListener('visibilitychange', onVis)
      if (reduce) draw(t0)
      else raf = requestAnimationFrame(loop)
    })()
