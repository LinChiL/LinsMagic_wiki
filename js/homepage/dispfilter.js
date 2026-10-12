// dispfilter.js - 纯 RGB 色散(摄影镜头横向色差): 一层全屏后处理, 只错位 RGB 通道, 不加模糊、不加亮。
// 以画面中心为原点沿半径向外错位, 越靠边界越强(画面角上最强, 正中心为 0):
//   R 通道往外扩、B 通道往里收(左右对称), G 通道不动 —— 就是镜头横向色差的空间分布。
// 位置: wiki 渲染链的最后一环(光斑滤镜之后)。强度 0 ⇒ active() false ⇒ 整层从链上摘除(场景直出, 零开销)。
// 效果自包含: 参数(DISP_*)、渐进包络、状态全在本文件; wikimodel.js 只接线(enter 归零 / update(dt) / render)。
// 用法(与 glowfilter 同款工厂: 材质/相机必须用调用方的 THREE 建, 与各自渲染器同源):
//   var wikiDisp = createDispFilter(THREE, renderer.domElement) // 不传 opts 用文件内默认
//   wikiDisp.enter()                       // 进入场景: 强度归零, 从 0 重新渐进
//   wikiDisp.update(dt)                    // 每帧调用(秒): 按 DISP_RAMP_SEC 渐进到满强度并保持
//   wikiDisp.render(renderer, srcTexture)  // 链末一层: 直接上屏
// resize 不需要: 每帧按 renderer.getDrawingBufferSize 现算(半径归一与错位量都跟真实帧尺寸走)。
(function () {
  // ===== 效果参数(都在这里调; 也可由 createDispFilter 的 opts 覆盖) =====
  var DISP_AMOUNT = 0.0645;  // 满强度时画面角上(r=1)的径向缩放量: 1920×1080 下角上 R/B 各错开≈5px(R 与 B 相距≈10px); 0 = 关
  var DISP_FALLOFF = 2.0;    // 径向幂次: 2 = 中心干净、强度集中在四周(1 = 从中心线性变强)
  var DISP_RAMP_SEC = 1.6;   // 进 wiki 后的渐进时长(墙钟秒), 到头保持满强度

  var GLSL3V = (typeof THREE !== 'undefined' && typeof THREE.GLSL3 !== 'undefined') ? THREE.GLSL3 : '300 es';

  var vsQuad = [
    'in vec3 position;',
    'void main() { gl_Position = vec4(position, 1.0); }'
  ].join('\n');

  // u_amount: 画面角上(r=1)的径向缩放量(0 = 无色散, 直接透传), 由强度缩放后逐帧下发
  // u_falloff: 径向幂次(1 = 线性增长, 2 = 中心极干净、强度压在四周)
  var fsDisp = [
    'precision highp float;',
    'uniform sampler2D u_src;',
    'uniform vec2 u_resolution;',
    'uniform float u_amount;',
    'uniform float u_falloff;',
    'out vec4 fragColor;',
    '',
    'void main() {',
    '    vec2 uv = gl_FragCoord.xy / u_resolution;',
    '    vec2 c = vec2(0.5);',
    '    float aspect = u_resolution.x / u_resolution.y;',
    '    // 半径在"等比空间"(x 乘 aspect)里量和缩放, 色散才是正圆而不是被拉成椭圆; 角上恰为 r=1',
    '    vec2 offA = (uv - c) * vec2(aspect, 1.0);',
    '    float r = clamp(length(offA) / (0.5 * sqrt(aspect * aspect + 1.0)), 0.0, 1.0);',
    '    float k = u_amount * pow(r, u_falloff);',
    '    vec2 uvr = c + offA * (1.0 + k) / vec2(aspect, 1.0);',
    '    vec2 uvb = c + offA * (1.0 - k) / vec2(aspect, 1.0);',
    '    vec4 s = texture(u_src, uv);',
    '    // 只换 R/B 的采样位置; G 与 alpha 取自原位(alpha 跟着错位会把覆盖层的透明边界糊出去)',
    '    fragColor = vec4(texture(u_src, uvr).r, s.g, texture(u_src, uvb).b, s.a);',
    '}'
  ].join('\n');

  function noop() {}

  function createDisp(THREE, canvasEl, opts) {
    opts = opts || {};
    var AMOUNT = (opts.amount != null) ? Math.max(0, Number(opts.amount) || 0) : DISP_AMOUNT; // 角上径向缩放量(比例, 不是像素)
    var FALLOFF = (opts.falloff != null) ? Math.max(0.001, Number(opts.falloff) || 1) : DISP_FALLOFF;
    var RAMP_SEC = (opts.rampSec != null) ? Math.max(0, Number(opts.rampSec) || 0) : DISP_RAMP_SEC;

    // 支持探测: 只需目标画布已是 WebGL2(源纹理是半浮点, WebGL2 下线性过滤是核心功能, 不额外要扩展)
    var supported = (function () {
      try {
        var g = canvasEl ? canvasEl.getContext('webgl2') : null;
        return !!g;
      } catch (e) { return false; }
    })();
    if (!supported) {
      console.warn('[dispfilter] 需要 WebGL2, RGB 色散层已禁用');
      return { supported: false, enter: noop, update: noop, setStrength: noop, getStrength: function () { return 0; }, active: function () { return false; }, render: noop };
    }

    var mat = new THREE.RawShaderMaterial({
      glslVersion: GLSL3V,
      uniforms: {
        u_src: { value: null },
        u_resolution: { value: new THREE.Vector2(1, 1) },
        u_amount: { value: 0 },
        u_falloff: { value: FALLOFF }
      },
      vertexShader: vsQuad,
      fragmentShader: fsDisp,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending
    });

    var cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    var scene = new THREE.Scene();
    scene.add(mesh);

    var _strength = 0;
    var _t = 0; // enter 后累计的墙钟秒(驱动渐进)
    var _db = new THREE.Vector2();

    function apply() { mat.uniforms.u_amount.value = AMOUNT * _strength; }
    function enter() { _t = 0; _strength = 0; apply(); } // 进入场景: 强度归零, 从 0 重新渐进
    function update(dt) { // 每帧(秒): smoothstep 渐进(两端零斜率, 看不出"打点"), 到头保持满强度
      _t += (dt > 0 ? dt : 0);
      var u = RAMP_SEC > 0 ? Math.min(1, _t / RAMP_SEC) : 1;
      _strength = u * u * (3 - 2 * u);
      apply();
    }
    function setStrength(s) { // 手动直设强度 0..1(跳过程进包络), 外部驱动/调试时用
      _strength = Math.max(0, Math.min(1, Number(s) || 0));
      apply();
    }
    function active() { return AMOUNT > 0 && _strength > 0.001; }
    function getStrength() { return _strength; }

    function render(renderer, srcTexture) {
      renderer.getDrawingBufferSize(_db);
      mat.uniforms.u_src.value = srcTexture;
      mat.uniforms.u_resolution.value.set(_db.x, _db.y);
      renderer.setRenderTarget(null); // 始终是链末: 直接上屏
      renderer.render(scene, cam);
    }

    return { supported: true, enter: enter, update: update, setStrength: setStrength, getStrength: getStrength, active: active, render: render };
  }

  window.createDispFilter = createDisp;
})();
