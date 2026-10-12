// cursorfilter.js - 真正的 Three.js 顶层水波与光学色散通道
(function () {
  var BASE_SIM_H = 512;
  var simW = 512, simH = 512;

  // 1. 摄像机与全屏四边形
  var cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  var quad = new THREE.PlaneGeometry(2, 2);

  // 2. 波动方程物理材质
  var simMat = new THREE.ShaderMaterial({
    uniforms: {
      u_current:   { value: null },
      u_texel:     { value: new THREE.Vector2() },
      u_damping:   { value: 0.985 },
      u_mouse:     { value: new THREE.Vector2(0.5, 0.5) },
      u_lastMouse: { value: new THREE.Vector2(0.5, 0.5) },
      u_strength:  { value: 0.0 },
      u_radius:    { value: 0.018 },
      u_aspect:    { value: 1.0 }
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }',
    fragmentShader: [
      'precision highp float;',
      'varying vec2 vUv;',
      'uniform sampler2D u_current;',
      'uniform vec2 u_texel;',
      'uniform float u_damping, u_strength, u_radius, u_aspect;',
      'uniform vec2 u_mouse, u_lastMouse;',
      'float distToSegment(vec2 p, vec2 a, vec2 b, float aspect) {',
      '  vec2 pa = p - a; pa.x *= aspect;',
      '  vec2 ba = b - a; ba.x *= aspect;',
      '  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.00001), 0.0, 1.0);',
      '  return length(pa - ba * h);',
      '}',
      'void main() {',
      '  float left  = texture2D(u_current, vUv - vec2(u_texel.x, 0.0)).r;',
      '  float right = texture2D(u_current, vUv + vec2(u_texel.x, 0.0)).r;',
      '  float up    = texture2D(u_current, vUv + vec2(0.0, u_texel.y)).r;',
      '  float down  = texture2D(u_current, vUv - vec2(0.0, u_texel.y)).r;',
      '  float cur   = texture2D(u_current, vUv).r;',
      '  float prev  = texture2D(u_current, vUv).g;',
      '  float next = (left + right + up + down) * 0.5 - prev;',
      '  next *= u_damping;',
      '  if (u_strength > 0.0) {',
      '    float dist = distToSegment(vUv, u_lastMouse, u_mouse, u_aspect);',
      '    if (dist < u_radius) next += smoothstep(u_radius, 0.0, dist) * u_strength;',
      '  }',
      '  gl_FragColor = vec4(next, cur, 0.0, 1.0);',
      '}'
    ].join('\n')
  });

  // 3. 斯涅尔定律 + 8 频段真物理光学色散材质 (色散强度 0.2)
  var dispMat = new THREE.ShaderMaterial({
    uniforms: {
      u_sim:        { value: null },
      u_bg:         { value: null },
      u_texel:      { value: new THREE.Vector2() },
      u_dispersion: { value: 0.3 },   // ★ 物理色散强度 0.2
      u_waterDepth: { value: 0.055 }, // 水体折射深度
      u_aspect:     { value: 1.0 }
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }',
    fragmentShader: [
      'precision highp float;',
      'varying vec2 vUv;',
      'uniform sampler2D u_sim, u_bg;',
      'uniform vec2 u_texel;',
      'uniform float u_dispersion, u_waterDepth, u_aspect;',
      'vec3 spectralWeight(float t) {',
      '  return vec3(',
      '    smoothstep(0.45, 0.15, t) + smoothstep(0.75, 1.0, t) * 0.35,',
      '    smoothstep(0.05, 0.5, t) * smoothstep(0.95, 0.5, t) * 1.35,',
      '    smoothstep(0.35, 0.75, t)',
      '  );',
      '}',
      'void main() {',
      '  float left  = texture2D(u_sim, vUv - vec2(u_texel.x, 0.0)).r;',
      '  float right = texture2D(u_sim, vUv + vec2(u_texel.x, 0.0)).r;',
      '  float up    = texture2D(u_sim, vUv + vec2(0.0, u_texel.y)).r;',
      '  float down  = texture2D(u_sim, vUv - vec2(0.0, u_texel.y)).r;',
      '  vec3 normal = normalize(vec3((left - right) * 2.8, (down - up) * 2.8, 1.0));',
      '  vec3 eyeRay = vec3(0.0, 0.0, -1.0);',
      '  vec3 accCol = vec3(0.0); vec3 totalW = vec3(0.0);',
      '  const int SAMPLES = 8;',
      '  for (int i = 0; i < SAMPLES; i++) {',
      '    float t = float(i) / float(SAMPLES - 1);',
      '    float ior = 1.333 + (t - 0.5) * u_dispersion;',
      '    vec3 refr = refract(eyeRay, normal, 1.0 / ior);',
      '    vec2 offset = (refr.xy / max(-refr.z, 0.001)) * u_waterDepth;',
      '    offset.x /= u_aspect;',
      '    accCol += texture2D(u_bg, vUv + offset).rgb * spectralWeight(t);',
      '    totalW += spectralWeight(t);',
      '  }',
      '  gl_FragColor = vec4(accCol / totalW, 1.0);',
      '}'
    ].join('\n')
  });

  var simScene = new THREE.Scene(); simScene.add(new THREE.Mesh(quad, simMat));
  var dispScene = new THREE.Scene(); dispScene.add(new THREE.Mesh(quad, dispMat));

  var fboA = null, fboB = null;
  function createFBO(w, h) {
    return new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: THREE.HalfFloatType
    });
  }

  // 纯速度跟踪（已修复瞬连切线 bug）
  var mouse = { x: 0.5, y: 0.5, lastX: 0.5, lastY: 0.5, strength: 0 };
  var prevX = null, prevY = null;
  var wasActive = false; // 记录上一帧是否处于高速激活状态

  window.addEventListener('mousemove', function (e) {
    var currX = e.clientX / window.innerWidth;
    var currY = 1.0 - e.clientY / window.innerHeight;

    if (prevX !== null) {
      var speed = Math.hypot(e.clientX - prevX, e.clientY - prevY);

      if (speed > 32.0) {
        // 关键修复：如果上一帧是慢速/静止，这一笔的起点必须是当前位置，绝不能连到旧坐标
        mouse.lastX = wasActive ? mouse.x : currX;
        mouse.lastY = wasActive ? mouse.y : currY;
        mouse.x = currX;
        mouse.y = currY;
        mouse.strength = Math.min(speed * 0.015, 0.42);
        wasActive = true;
      } else {
        // 慢速移动时，把坐标同步更新，防止旧坐标滞留在原处拉线
        mouse.x = mouse.lastX = currX;
        mouse.y = mouse.lastY = currY;
        wasActive = false;
      }
    } else {
      mouse.x = mouse.lastX = currX;
      mouse.y = mouse.lastY = currY;
      wasActive = false;
    }

    prevX = e.clientX;
    prevY = e.clientY;
  });

  window.addEventListener('mouseleave', function () {
    prevX = null;
    prevY = null;
    wasActive = false;
    mouse.strength = 0;
  });

  // 暴露 API
  window.CursorFilter = {
    resize: function (w, h) {
      var aspect = w / h;
      simH = BASE_SIM_H;
      simW = Math.round(BASE_SIM_H * aspect);
      if (fboA) { fboA.dispose(); fboB.dispose(); }
      fboA = createFBO(simW, simH);
      fboB = createFBO(simW, simH);
      simMat.uniforms.u_texel.value.set(1.0 / simW, 1.0 / simH);
      simMat.uniforms.u_aspect.value = aspect;
      dispMat.uniforms.u_texel.value.set(1.0 / simW, 1.0 / simH);
      dispMat.uniforms.u_aspect.value = aspect;
    },
    render: function (renderer, bgTexture, outTarget) {
      // 惰性初始化: tyndall.js 先于本脚本加载, 其初始化 resize 时 window.CursorFilter
      // 尚不存在, FBO 从未创建 → 若直接 return 则首屏全黑, 直到用户手动 resize。
      if (!fboA) this.resize(window.innerWidth, window.innerHeight);
      // Pass 1: 物理波动更新
      simMat.uniforms.u_current.value = fboA.texture;
      simMat.uniforms.u_mouse.value.set(mouse.x, mouse.y);
      simMat.uniforms.u_lastMouse.value.set(mouse.lastX, mouse.lastY);
      simMat.uniforms.u_strength.value = mouse.strength;
      renderer.setRenderTarget(fboB);
      renderer.render(simScene, cam);

      mouse.strength *= 0.75;
      mouse.lastX = mouse.x; mouse.lastY = mouse.y;

      // Pass 2: 斯涅尔色散后处理输出(默认屏幕; 传入 outTarget 时落该 FBO, 供光斑滤镜再链一层)
      dispMat.uniforms.u_sim.value = fboB.texture;
      dispMat.uniforms.u_bg.value = bgTexture;
      renderer.setRenderTarget(outTarget || null);
      renderer.render(dispScene, cam);

      // FBO 交换
      var t = fboA; fboA = fboB; fboB = t;
    }
  };
})();