// glowfilter.js - 全局光斑滤镜(六边形电影散景 + ACES): 取自 glow.html(新版示例),
// 作为后处理直接作用于整帧渲染画面(不是独立叠加层), 链在鼠标色散通道(CursorFilter)之后:
//   色散输出 -> 后备纹理 -> [Pass1 反 ACES 线性化(-0.5 去偏置) -> Pass2 水平前缀和 SAT(跳跃倍增) ->
//   Pass3 六边形积分散景 + ACES 调色(半分辨率, 循环代价÷4) -> Pass4 全分辨率与原始画面按强度混合] -> 屏幕。
// 开场飞来段默认满强度(整帧散景化), 强度由 tyndall.js 逐帧按"实际应用模糊量"写入;
// 模糊消失 -> 强度归零 -> 整条 pass 从渲染链摘除(零开销, 色散恢复直出屏幕)。
// 另有 flash(): UI 出现时由 tyndall.js 触发一次 0→1→0 的独立闪动(只动光斑强度, 不加模糊)。
// 依赖 WebGL2 + EXT_color_buffer_float(浮点渲染目标) + OES_texture_float_linear(SAT 线性插值),
// 缺任一则整体禁用(active() 恒 false, 链路保持原样)。
//
// ---- 工厂(createGlowFilter): 同一份算法跑在两条渲染链上 ----
//   window.GlowFilter = createGlowFilter(THREE, canvas)            主页(全局 r128; 强度由模糊量驱动)
//   wikimodel.js: createGlowFilter(THREE165, flyCanvas, {alphaOut:1})  wiki 覆盖层(模块 r165; 强度由 K 键驱动)
// 两条链各自独立(材质/渲染目标按传入的 THREE 建, 与各自渲染器同源), 互不干扰。
// opts.linearIO: 0 = 输入为显示空间(sRGB)画面(与原行为逐像素一致, 默认);
//                1 = 输入本就是线性(渲染目标不做 sRGB 编码), 跳过 pow(2.2) 反线性, 链末再手动编码回 sRGB。
//                ※ 输入必须是显示空间(0~1): Pass1 的反 ACES 拟合只在 <=1 时有定义, 喂 >1.24 的 HDR 会 NaN 变黑。
// opts.alphaOut: 1 = 把原始画面的 alpha 透传到链末(透明覆盖层画布用: 空处要露出底下的页面卡); 默认 0 写满 alpha。
(function () {
  var GLSL3V = (typeof THREE !== 'undefined' && typeof THREE.GLSL3 !== 'undefined') ? THREE.GLSL3 : '300 es';

  var vsQuad = [
    'in vec3 position;',
    'void main() { gl_Position = vec4(position, 1.0); }'
  ].join('\n');

  // Pass 1: 图像转 ACES 线性空间并消除偏置(取自示例; linearIO=1 时输入已是线性, 跳过 pow)
  var fsInit = [
    'precision highp float;',
    'uniform sampler2D u_image;',
    'uniform vec2 u_resolution;',
    'uniform vec2 u_imgResolution;',
    'uniform float u_linearIO;',
    'out vec4 fragColor;',
    '',
    'const mat3 ACESInputMat = mat3(',
    '    0.59719, 0.35458, 0.04823,',
    '    0.07600, 0.90834, 0.01566,',
    '    0.02840, 0.13383, 0.83777',
    ');',
    'const mat3 ACESOutputMat = mat3(',
    '     1.60475, -0.53108, -0.07367,',
    '    -0.10208,  1.10813, -0.00605,',
    '    -0.00327, -0.07276,  1.07602',
    ');',
    '',
    'vec3 InvRRTAndODTFit(vec3 x) {',
    '    // sqrt 内层 max(0): 输入本应 <= 1(显示空间), 一旦混进 >1.24 的 HDR 值开方即 NaN, 会顺着 SAT 扩散把整片区域写黑',
    '    return -1.0/100.0*(21647550.0*x + sqrt(max(vec3(0.0), -1873455419487500.0*x*x + 2326712714032270.0*x + 2415638944900.0)) - 1228930.0)/(983729.0*x - 1000000.0);',
    '}',
    '',
    'vec3 InvACESFitted(vec3 color) {    ',
    '    color = color * inverse(ACESOutputMat);',
    '    color = InvRRTAndODTFit(color);',
    '    color = color * inverse(ACESInputMat);',
    '    return color;',
    '}',
    '',
    'void main() {',
    '    vec2 uv = gl_FragCoord.xy / u_resolution;',
    '    float sRatio = u_resolution.x / u_resolution.y;',
    '    float iRatio = u_imgResolution.x / u_imgResolution.y;',
    '    vec2 imgUV = uv;',
    '    if (sRatio > iRatio) {',
    '        float s = sRatio / iRatio;',
    '        imgUV.y = (imgUV.y - 0.5) * s + 0.5;',
    '    } else {',
    '        float s = iRatio / sRatio;',
    '        imgUV.x = (imgUV.x - 0.5) * s + 0.5;',
    '    }',
    '',
    '    vec4 col = texture(u_image, imgUV);',
    '    // ★ 必须钳到 [0,1]: 这是"显示空间画面"的定义域。直出画布是 8 位缓冲, 写进去的超白值天然被钳到 1;',
    '    //   中继纹理是半浮点不钳位, tonemapped:false 的材质 / 自写 ShaderMaterial 会把 >1 的 HDR 漏进来,',
    '    //   而 InvACESFitted 的分母 (983729x - 1000000) 在 x≈1.0165 处过零 → ±Inf → 前缀和 Inf-Inf=NaN →',
    '    //   NaN 写进 8 位缓冲的转换是未定义的, 表现为亮处逐帧 RGB 乱闪。',
    '    vec3 cIn = clamp(col.rgb, 0.0, 1.0);',
    '    vec3 inLin = (u_linearIO > 0.5) ? cIn : pow(cIn, vec3(2.2));',
    '    vec3 linCol = InvACESFitted(inLin);',
    '    fragColor = vec4(linCol - 0.5, 1.0);',
    '}'
  ].join('\n');

  // Pass 2: GPU 水平前缀积分(跳跃倍增, 逐字取自示例)
  var fsSat = [
    'precision highp float;',
    'uniform sampler2D u_src;',
    'uniform int u_step;',
    'out vec4 fragColor;',
    '',
    'void main() {',
    '    ivec2 fc = ivec2(gl_FragCoord.xy);',
    '    vec4 val = texelFetch(u_src, fc, 0);',
    '    int prevX = fc.x - u_step;',
    '    if (prevX >= 0) {',
    '        val += texelFetch(u_src, ivec2(prevX, fc.y), 0);',
    '    }',
    '    fragColor = val;',
    '}'
  ].join('\n');

  // Pass 3: 纯六边形积分散景 + ACES 调色(取自示例, 内部半分辨率运行)
  var fsBokeh = [
    'precision highp float;',
    'uniform sampler2D u_sat;',
    'uniform vec2 u_resolution;',
    'uniform float u_time;',
    'uniform float u_manualRadius;',
    'uniform float u_exposure;',
    'uniform float u_linearIO;',
    'out vec4 fragColor;',
    '',
    'const float tau = 6.2831853;',
    '',
    'const mat3 ACESInputMat = mat3(',
    '    0.59719, 0.35458, 0.04823,',
    '    0.07600, 0.90834, 0.01566,',
    '    0.02840, 0.13383, 0.83777',
    ');',
    'const mat3 ACESOutputMat = mat3(',
    '     1.60475, -0.53108, -0.07367,',
    '    -0.10208,  1.10813, -0.00605,',
    '    -0.00327, -0.07276,  1.07602',
    ');',
    '',
    'vec3 RRTAndODTFit(vec3 v) {',
    '    vec3 a = v * (v + 0.0245786) - 0.000090537;',
    '    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;',
    '    return a / b;',
    '}',
    '',
    'vec3 ACESFitted(vec3 color) {',
    '    color = color * ACESInputMat;',
    '    color = RRTAndODTFit(color);',
    '    color = color * ACESOutputMat;',
    '    return clamp(color, 0.0, 1.0);',
    '}',
    '',
    'void main() {',
    '    vec2 pw = 1.0 / u_resolution;',
    '    vec2 uv = gl_FragCoord.xy * pw;',
    '    vec2 rb = (uv * 2.0 - 1.0) * vec2(u_resolution.x / u_resolution.y, 1.0);',
    '',
    '    // 六边形垂直半径 R.y',
    '    float Ry;',
    '    if (u_manualRadius <= 0.01) {',
    '        Ry = exp(mix(log(3.0), log(55.0), cos(-rb.y * 0.15 * tau - 0.8 + u_time) * 0.5 + 0.5));',
    '    } else {',
    '        Ry = u_manualRadius;',
    '    }',
    '',
    '    vec4 c = vec4(0.0);',
    '    int IRy = int(Ry);',
    '    float cw = 0.0;',
    '',
    '    // 纯六边形积分遍历 (利用前缀和 O(1) 求每行水平切片光通量)',
    '    for (int i = -IRy; i <= IRy; ++i) {',
    '        float fi = float(i);',
    '',
    '        // 六边形在纵坐标 fi 处的水平半宽',
    '        float w = 0.866025 * min(1.0, (1.0 - abs(fi / Ry)) / 0.5) * Ry;',
    '',
    '        float owl = max(0.0, w - gl_FragCoord.x);',
    '        float owr = max(0.0, gl_FragCoord.x - u_resolution.x + w);',
    '        cw += 2.0 * w - owl - owr;',
    '',
    '        w *= pw.x;',
    '        float y = uv.y + pw.y * fi;',
    '',
    '        vec4 p0 = texture(u_sat, vec2(uv.x - w, y));',
    '        vec4 p1 = texture(u_sat, vec2(uv.x + w, y));',
    '        c += (p1 - p0);',
    '    }',
    '',
    '    // ACES 胶片色调映射',
    '    vec3 finalColor = (c.rgb / max(cw, 0.001) + 0.5) * u_exposure;',
    '    vec3 aces = ACESFitted(finalColor);',
    '    vec3 outp = (u_linearIO > 0.5) ? aces : pow(aces, vec3(1.0 / 2.2));',
    '    fragColor = vec4(outp, 1.0);',
    '}'
  ].join('\n');

  // Pass 4: 全分辨率混合(散景半分辨率输出 与 原始画面按强度混合; 强度 0/1 两端不损失原始画面细节)
  // linearIO=1: 两侧都是线性, 混完手动做与 three 一致的 sRGB 传输曲线编码
  // alphaOut=1: 把原始 alpha 透传(覆盖层画布是透明的, 空处要露出底下的页面卡)
  var fsMix = [
    'precision highp float;',
    'uniform sampler2D u_srcColor;',
    'uniform sampler2D u_bokeh;',
    'uniform vec2 u_resolution;',
    'uniform float u_blend;',
    'uniform float u_linearIO;',
    'uniform float u_alphaOut;',
    'out vec4 fragColor;',
    '',
    'vec3 lin2srgb(vec3 c) {',
    '    vec3 s = pow(max(c, vec3(0.0)), vec3(0.41666)) * 1.055 - vec3(0.055);',
    '    return mix(s, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));',
    '}',
    '',
    'void main() {',
    '    vec2 uv = gl_FragCoord.xy / u_resolution;',
    '    vec4 src = texture(u_srcColor, uv);',
    '    vec3 bl = texture(u_bokeh, uv).rgb;',
    '    vec3 mixed = mix(src.rgb, bl, u_blend);',
    '    float a = (u_alphaOut > 0.5) ? src.a : 1.0;',
    '    fragColor = (u_linearIO > 0.5) ? vec4(lin2srgb(mixed), a) : vec4(mixed, a);',
    '}'
  ].join('\n');

  function noop() {}

  // 工厂: 用传入的 THREE 建材质/渲染目标(必须与该实例的渲染器同源), canvasEl 仅用于支持探测
  function createGlow(THREE, canvasEl, opts) {
    opts = opts || {};
    // ===== 可调参数 =====
    var GLOW_BLUR_MAX = 10.0;     // 【强度映射】模糊量达到该像素值(px)视为满强度 1.0 (开场第①段起始模糊恰为 10px)
    var FLASH_SEC = 1.0;          // 【闪动】flash() 的 0→1→0 总时长(秒); UI 出现时由 tyndall.js 触发一次
    var FLASH_ATTACK = 0.18;      // 闪动起闪时长(秒, 必须 < FLASH_SEC): 其余时间为衰减
    var GLOW_MANUAL_RADIUS = (opts.manualRadius != null) ? opts.manualRadius : 0.0; // 散焦半径(px, 内部工作分辨率像素): 0 = 示例同款"自动呼吸"(逐行渐变+随时间脉动, 峰值 Ry≈55)
    var GLOW_EXPOSURE = (opts.exposure != null) ? opts.exposure : 0.75;             // 曝光(示例默认 0.75)
    var GLOW_RES_SCALE = (opts.resScale != null) ? opts.resScale : 0.5;             // 散景内部工作分辨率(反ACES+SAT+六边形积分)相对帧缓冲的倍率
    var LINEAR_IO = opts.linearIO ? 1.0 : 0.0; // 0 = 输入为显示空间(主页) / 1 = 输入本就是线性
    var ALPHA_OUT = opts.alphaOut ? 1.0 : 0.0; // 1 = 透传原始 alpha(wiki 覆盖层: 空处要透明露出底下的页面卡)

    // ===== 支持探测: 直接取目标画布上已存在的上下文(不新建) =====
    var _supported = (function () {
      try {
        var g = canvasEl ? canvasEl.getContext('webgl2') : null;
        if (!g) return false;
        if (!g.getExtension('EXT_color_buffer_float')) return false;
        if (!g.getExtension('OES_texture_float_linear')) return false;
        return true;
      } catch (e) { return false; }
    })();
    if (!_supported) {
      console.warn('[glowfilter] 需要 WebGL2 + EXT_color_buffer_float + OES_texture_float_linear, 光斑滤镜已禁用');
      return {
        supported: false, resize: noop, setIntensity: noop, setKeyed: noop, flash: noop,
        active: function () { return false; }, target: function () { return null; }, render: noop
      };
    }

    function rawMat(fragSrc, uniforms) {
      return new THREE.RawShaderMaterial({
        glslVersion: GLSL3V,
        uniforms: uniforms,
        vertexShader: vsQuad,
        fragmentShader: fragSrc,
        depthTest: false, depthWrite: false, blending: THREE.NoBlending
      });
    }

    var matInit = rawMat(fsInit, {
      u_image: { value: null },
      u_resolution: { value: new THREE.Vector2(1, 1) },
      u_imgResolution: { value: new THREE.Vector2(1, 1) },
      u_linearIO: { value: LINEAR_IO }
    });
    var matSat = rawMat(fsSat, {
      u_src: { value: null },
      u_step: { value: 1 }
    });
    var matBokeh = rawMat(fsBokeh, {
      u_sat: { value: null },
      u_resolution: { value: new THREE.Vector2(1, 1) },
      u_time: { value: 0 },
      u_manualRadius: { value: GLOW_MANUAL_RADIUS },
      u_exposure: { value: GLOW_EXPOSURE },
      u_linearIO: { value: LINEAR_IO }
    });
    var matMix = rawMat(fsMix, {
      u_srcColor: { value: null },
      u_bokeh: { value: null },
      u_resolution: { value: new THREE.Vector2(1, 1) },
      u_blend: { value: 1.0 },
      u_linearIO: { value: LINEAR_IO },
      u_alphaOut: { value: ALPHA_OUT }
    });

    var cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    var _mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), matInit);
    var _scene = new THREE.Scene();
    _scene.add(_mesh);

    // 后备纹理: 色散通道的输出落点(仅本滤镜启用时使用; 停用后色散直出屏幕, 不经过它)
    // 先在 resize() 里按 CSS 像素建一张占位(保证 target() 从第一帧起非空), 首次 render 时
    // ensureSAT 再按真实帧缓冲(设备像素)重建 —— 保证闪动淡出末帧与直出画面无分辨率跳变
    var readTarget = null;
    function resize(w, h) {
      if (readTarget) readTarget.dispose();
      readTarget = new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat
      });
    }
    resize(window.innerWidth, window.innerHeight); // tyndall.js 先于本脚本加载, 自初始化兜底

    // SAT 双缓冲(32F) + 散景输出缓冲(也存线性值: 半浮点, 8 位线性会压暗部, 强度归零摘链时暗部跳变)
    var _satA = null, _satB = null, _bokehRT = null, _satW = 0, _satH = 0, _satSteps = 0;
    var _oldRT = null; // 重建后备纹理时, 旧纹理本帧仍在被采样(色散通道已写入), 延迟到下一帧释放
    var _db = new THREE.Vector2();
    function ensureSAT(renderer) {
      if (_oldRT) { _oldRT.dispose(); _oldRT = null; }
      renderer.getDrawingBufferSize(_db);
      var bw = Math.max(1, Math.round(_db.x));
      var bh = Math.max(1, Math.round(_db.y));
      var sw = Math.max(1, Math.round(_db.x * GLOW_RES_SCALE));
      var sh = Math.max(1, Math.round(_db.y * GLOW_RES_SCALE));
      if (readTarget.width !== bw || readTarget.height !== bh) {
        _oldRT = readTarget;
        readTarget = new THREE.WebGLRenderTarget(bw, bh, {
          minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat
        });
      }
      if (_satA && _satW === sw && _satH === sh) return;
      if (_satA) _satA.dispose();
      if (_satB) _satB.dispose();
      var opts2 = {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat, type: THREE.FloatType,
        depthBuffer: false, stencilBuffer: false
      };
      _satA = new THREE.WebGLRenderTarget(sw, sh, opts2);
      _satB = new THREE.WebGLRenderTarget(sw, sh, opts2);
      if (_bokehRT) _bokehRT.dispose();
      _bokehRT = new THREE.WebGLRenderTarget(sw, sh, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat, type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false
      });
      _satW = sw; _satH = sh;
      _satSteps = Math.ceil(Math.log2(sw)); // 2^steps 覆盖整行宽, 前缀和精确
    }

    var _t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
    var _dead = false; // 实际渲染器不是 WebGL2 时的兜底(探测理论上已挡住, 双保险)
    // outTarget: 缺省/传 null = 混合结果直接上屏; 传渲染目标 = 落该目标(供后面还要再挂一层后处理时用, 例如 wiki 的色散层)
    function render(renderer, srcTexture, outTarget) {
      if (_dead) return;
      if (renderer.capabilities.isWebGL2 === false) { _dead = true; return; } // 明确是 WebGL1 才摘链(该标志在新版 three 可能不存在, 不能当未定义=坏)
      ensureSAT(renderer);

      // Pass 1: 反 ACES 线性化 -> SAT 起点
      matInit.uniforms.u_image.value = srcTexture;
      matInit.uniforms.u_resolution.value.set(_satW, _satH);
      matInit.uniforms.u_imgResolution.value.set(readTarget.width, readTarget.height);
      _mesh.material = matInit;
      renderer.setRenderTarget(_satA);
      renderer.render(_scene, cam);

      // Pass 2: 水平前缀和(跳跃倍增), 交替双缓冲
      _mesh.material = matSat;
      var read = _satA, write = _satB;
      for (var i = 0; i < _satSteps; i++) {
        matSat.uniforms.u_src.value = read.texture;
        matSat.uniforms.u_step.value = 1 << i;
        renderer.setRenderTarget(write);
        renderer.render(_scene, cam);
        var tmp = read; read = write; write = tmp;
      }

      // Pass 3: 六边形积分散景 + ACES -> 内部半分辨率缓冲
      matBokeh.uniforms.u_sat.value = read.texture;
      matBokeh.uniforms.u_resolution.value.set(_satW, _satH);
      matBokeh.uniforms.u_time.value = (performance.now() - _t0) * 0.001;
      _mesh.material = matBokeh;
      renderer.setRenderTarget(_bokehRT);
      renderer.render(_scene, cam);

      // Pass 4: 全分辨率与原始画面按强度混合 -> 屏幕(或 outTarget)
      matMix.uniforms.u_srcColor.value = srcTexture;
      matMix.uniforms.u_bokeh.value = _bokehRT.texture;
      matMix.uniforms.u_resolution.value.set(_db.x, _db.y);
      matMix.uniforms.u_blend.value = _blend;
      _mesh.material = matMix;
      renderer.setRenderTarget(outTarget || null);
      renderer.render(_scene, cam);
    }

    // ===== 强度控制 =====
    // 基础通道: tyndall.js 每帧写入"当前实际模糊量(px)", 强度 = 模糊/GLOW_BLUR_MAX, 逐帧直跟(不插值)。
    // 闪动通道: flash() 触发一次独立的 0→1→0 包络(只动光斑强度, 不加模糊), 与基础通道取大者。
    // 两通道均归零时 active()=false, 整条 pass 从渲染链摘除(零开销), 之后 flash() 仍可再次点亮。
    var _blurV = 1.0;   // 基础强度(开局满强度, 首帧 setIntensity 写入前即生效)
    var _blend = 1.0;   // 本帧最终强度 = max(基础, 闪动包络)
    var _flashT = -1.0; // 闪动计时(秒); <0 = 未触发
    var _prevNow = 0.0;
    function setIntensity(blurPx) {
      var now = performance.now();
      var dt = _prevNow ? Math.min(Math.max((now - _prevNow) * 0.001, 0.0), 0.1) : 0.0;
      _prevNow = now;

      _blurV = Math.max(0.0, Math.min(1.0, blurPx / GLOW_BLUR_MAX));

      var env = 0.0;
      if (_flashT >= 0.0) {
        _flashT += dt;
        var t = _flashT;
        if (t >= FLASH_SEC) {
          _flashT = -1.0;
        } else if (t < FLASH_ATTACK) {
          var a = t / FLASH_ATTACK;
          env = a * a * (3.0 - 2.0 * a); // smoothstep 起闪(0→1, 两端零斜率)
        } else {
          var b = 1.0 - (t - FLASH_ATTACK) / (FLASH_SEC - FLASH_ATTACK);
          env = b * b * (3.0 - 2.0 * b); // smoothstep 衰减(1→0)
        }
      }

      _blend = Math.max(_blurV, env);
    }
    function flash() { _flashT = 0.0; }

    // 键驱动(供 wiki K 面板逐帧调用): 半径直接写 Pass3 的固定 Ry, 曝光写 Pass3 的 u_exposure。
    // 混合强度 = clamp(半径 / GLOW_BLUR_MAX, 0, 1) —— 半径 0 ⇒ 强度 0 ⇒ 整条链摘除(不触发示例的自动呼吸)。
    function setKeyed(radiusPx, exposure) {
      var r = Math.max(0.0, Number(radiusPx) || 0.0);
      // 半径 > 0 时钳到 0.02: 不给示例的"自动呼吸"留窗口(u_manualRadius<=0.01 会触发它)
      matBokeh.uniforms.u_manualRadius.value = (r > 0.0) ? Math.max(r, 0.02) : 0.0;
      if (exposure != null) matBokeh.uniforms.u_exposure.value = Math.max(0.0, Number(exposure) || 0.0);
      _blend = Math.max(0.0, Math.min(1.0, r / GLOW_BLUR_MAX));
    }

    function active() { return !_dead && _blend > 0.001; }
    function target() { return readTarget; }

    return {
      supported: true, resize: resize, setIntensity: setIntensity, setKeyed: setKeyed, flash: flash,
      active: active, target: target, render: render
    };
  }

  window.createGlowFilter = createGlow;
  // 主页实例: 走全局 r128 的 THREE, 显示空间输入, 强度由 tyndall.js 的模糊量驱动(与原行为一致)
  window.GlowFilter = createGlow(THREE, document.getElementById('tyndall3d'), {});
})();
