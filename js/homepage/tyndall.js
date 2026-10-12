(function () {
  // ===== 1. 基础配置 =====
  var SHOW_DEBUG_PANEL = false;
  var MODEL_URL = '../asset/model/ui/title.glb';
  // 模型姿态校正(弧度): title.glb 默认躺倒, 绕 X 轴 -90° 立起; 可按需改成 +90°/180°
  var MODEL_ROT_X = Math.PI / 2;
  var MODEL_ROT_Z = Math.PI*0.9;   // 绕 Z 轴 180°

  var panel = document.querySelector('.debug-panel');
  // 面板默认由 CSS 隐藏(display:none); 仅在显式开启时才恢复显示
  if (panel && SHOW_DEBUG_PANEL) panel.style.display = 'block';

  var canvas = document.getElementById('tyndall3d');
  var stage = document.getElementById('cinematic-stage');
  var pCineCam = document.getElementById('p_cine_cam');
  var projVec = new THREE.Vector3(); // 用于 3D 坐标投影到屏幕 2D 坐标
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  var gl = renderer.getContext();
  var _homeScale = 1; // 首页渲染分辨率倍数: wiki 卡片拉远后由 HomeGate.setScale 调低(1 = 全质量)

  // ===== 2. 场景与相机设定（严格对齐原生体积空间） =====
  var FOV_DEG = 55.0; // 与之前 FOV_TAN = 0.52 对应的视场角
  var camera = new THREE.PerspectiveCamera(FOV_DEG, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 0);
  // 本项目体积空间以 +Z 为前方(rayDir.z = +1, 光源在 +Z=51);
  // 而 Three.js 相机默认朝 -Z, 必须转向 +Z 才能看到放在 +Z 的模型
  camera.lookAt(0, 0, 1);

  // 光源虚拟阴影相机（用于生成模型遮挡产生的真实 3D 丁达尔切光）
  var lightCam = new THREE.PerspectiveCamera(60, 1.0, 1.0, 80.0);

  var modelScene = new THREE.Scene();
  var chunks = []; // 存储所有碎块网格与初始位置

  // 离屏 FBO：烘焙模型在相机视角的颜色和深度
  var modelColorDepthTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    minFilter: THREE.NearestFilter, // 深度/G-Buffer 严禁双线性插值, 否则边缘混入黑背景形成描边
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.FloatType // 记录精确物理 Z 深度
  });

  // 离屏 FBO：烘焙模型在光源视角的阴影图
  var modelShadowTarget = new THREE.WebGLRenderTarget(1024, 1024, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat
  });
  var sceneTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat
  });

  // ===== 3. 加载 GLB 碎裂模型 =====
  var loader = new THREE.GLTFLoader();
  var textGroup = new THREE.Group();
  textGroup.rotation.x = MODEL_ROT_X;
  textGroup.rotation.z = MODEL_ROT_Z;
  modelScene.add(textGroup);

  loader.load(MODEL_URL, function (gltf) {
    var sceneBox = new THREE.Box3().setFromObject(gltf.scene);
    var center = sceneBox.getCenter(new THREE.Vector3());

    gltf.scene.traverse(function (child) {
      if (child.isMesh) {
        // child.geometry.computeVertexNormals(); // 保留模型原生硬表面法线, 强行平滑会让碎块边缘发黑
        // 记录碎块原始中心与相对偏移量，用于程序化物理散开
        var pieceBox = new THREE.Box3().setFromObject(child);
        var pieceCenter = pieceBox.getCenter(new THREE.Vector3());
        var dir = pieceCenter.clone().sub(center).normalize();

        chunks.push({
          mesh: child,
          originPos: child.position.clone(), // 最终文字上的槽位局部位置
          dir: dir,
          // 微弱时间差，产生层次错落感
          delay: Math.random() * 0.12,
          // 沿途飞行的螺旋半径
          swirlRadius: (Math.random() - 0.5) * 1.8,
          swirlFreq: 2.0 + Math.random() * 3.0,
          // 飞行中的自旋角速度
          spinSpeed: new THREE.Vector3(
            (Math.random() - 0.5) * 6.0,
            (Math.random() - 0.5) * 6.0,
            (Math.random() - 0.5) * 6.0
          ),
          // 鼠标交互: 弹簧位移与速度(局部空间, 装配后被鼠标推开/回弹)
          _ox: 0, _oy: 0, _oz: 0,
          _vx: 0, _vy: 0, _vz: 0,
          // 静止时的微微移动/转动: 每碎块独立相位与频率
          _ph: Math.random() * 6.2832,
          _fr: 0.6 + Math.random() * 0.9
        });
      }
    });

    // 居中并放入群组
    gltf.scene.position.sub(center);
    textGroup.add(gltf.scene);
  }, undefined, function (err) {
    console.warn('GLB 加载失败，请检查路径:', MODEL_URL, err);
  });

  // ===== 4. 模型专用渲染材质（同时输出真实着色与物理 Z 深度） =====
  var modelMat = new THREE.ShaderMaterial({
    vertexShader: [
      'varying vec3 vWorldPos;',
      'void main() {',
      '  vec4 wp = modelMatrix * vec4(position, 1.0);',
      '  vWorldPos = wp.xyz;',
      '  gl_Position = projectionMatrix * viewMatrix * wp;',
      '}'
    ].join('\n'),
    // 用 three 的 extensions 开关注入 #extension, 而不是在源码里手写:
    // GLSL 规定 #extension 必须出现在所有非预处理记号之前, 手写会被拼到
    // three 注入的 precision/#define 前缀之后, 属于非法位置
    extensions: { derivatives: true },
    uniforms: {
      // 模型打光强度: UI 出现前为 1/3, 出现后过渡到 1.0(与丁达尔光、压扁、暗角同曲线)
      u_lightStrength: { value: 1.0 / 3.0 }
    },
    fragmentShader: [
      'varying vec3 vWorldPos;',
      'uniform float u_lightStrength;',
      'void main() {',
      '  // 核心: 由屏幕空间导数还原【世界空间】面法线, 恢复硬石棱角质感',
      '  vec3 fNormal = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));',
      '',
      '  // 光照计算: 主光源 + 正面补光 + 基础环境光, 整体强度受 u_lightStrength 控制',
      '  vec3 lightDir = normalize(vec3(0.2, 1.0, -0.6));',
      '  float diff = max(dot(fNormal, lightDir), 0.0);',
      '  // fNormal 是世界空间法线, 相机看向 +Z, 故朝向相机的方向是 -Z',
      '  float front = max(dot(fNormal, vec3(0.0, 0.0, -1.0)), 0.0) * 0.4;',
      '  float ambient = 0.25;',
      '',
      '  // 坚硬花岗岩石冷灰色调; ambient 保留最小保底避免全黑, 其余光照项随强度过渡',
      '  vec3 stoneColor = vec3(0.82, 0.86, 0.92) * ((diff * 0.65 + front) * u_lightStrength + ambient);',
      '',
      '  // 输出颜色与真实相机物理 Z 深度',
      '  gl_FragColor = vec4(stoneColor, vWorldPos.z);',
      '}'
    ].join('\n')
  });

  // 光源视角阴影深度材质
  var shadowDepthMat = new THREE.ShaderMaterial({
    vertexShader: [
      'void main() {',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}'
    ].join('\n'),
    fragmentShader: [
      'void main() {',
      '  gl_FragColor = vec4(vec3(gl_FragCoord.z), 1.0);',
      '}'
    ].join('\n')
  });

  // ===== 5. 核心体积光全屏后处理管线 =====
  var postScene = new THREE.Scene();
  var postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  var tyndallMat = new THREE.ShaderMaterial({
    uniforms: {
      u_color: { value: null },
      u_d1: { value: null },
      u_d2: { value: null },
      u_d3: { value: null },
      u_d4: { value: null },
      // ===== 第二张壁纸(与第一张同结构, 供轮播交叉过渡) =====
      u_color2: { value: null },
      u_d1b: { value: null },
      u_d2b: { value: null },
      u_d3b: { value: null },
      u_d4b: { value: null },
      u_wallMix: { value: 0.0 }, // 0 = 第一张(t1_1), 1 = 第二张(t1_2); 轮播时渐变
      u_modelTex: { value: modelColorDepthTarget.texture },
      u_modelShadowMap: { value: modelShadowTarget.texture },
      u_lightMatrix: { value: new THREE.Matrix4() },
      u_lightPos: { value: new THREE.Vector3(1, 31, 51) },
      u_intensity: { value: 0.4 },
      u_rangeFalloff: { value: 0.001 },
      u_noiseIntens: { value: 2.0 },
      u_beamScale: { value: 10.0 },
      u_res: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      u_time: { value: 0 },
      u_debugMode: { value: 0 },
      // ===== 新增：广角拉箱畸变与边缘色散 =====
      u_lensDistortion: { value: 0.0 }, // 桶形畸变弯曲度 (0.0~0.5)
      u_lensChroma: { value: 0.0 },     // 边缘红蓝折射色散
      // 特写跟随: 畸变中心/强度跟随 CSS 特写(scale + focus), 否则特写放大的是畸变最弱的
      // 屏幕中心区域, 导致畸变"看不见"。u_cineCenter 为畸变中心(UV), u_cineScale 为强度倍率。
      u_cineCenter: { value: new THREE.Vector2(0.5, 0.5) },
      u_cineScale: { value: 1.0 },
      // 标题装配完成、2D UI 出现后置 1: 上方暗角减弱到 1/3
      u_uiShown: { value: 0.0 }
    },
    vertexShader: [
      'varying vec2 v_uv;',
      'void main() {',
      '  v_uv = uv;',
      '  gl_Position = vec4(position, 1.0);',
      '}'
    ].join('\n'),
    fragmentShader: [
      'precision highp float;',
      'varying vec2 v_uv;',
      '',
      'uniform sampler2D u_color;',
      'uniform sampler2D u_d1;',
      'uniform sampler2D u_d2;',
      'uniform sampler2D u_d3;',
      'uniform sampler2D u_d4;',
      'uniform sampler2D u_color2; // 第二张壁纸',
      'uniform sampler2D u_d1b;',
      'uniform sampler2D u_d2b;',
      'uniform sampler2D u_d3b;',
      'uniform sampler2D u_d4b;',
      'uniform float u_wallMix; // 0 = 第一张壁纸, 1 = 第二张',
      'uniform sampler2D u_modelTex;',
      'uniform sampler2D u_modelShadowMap;',
      '',
      'uniform mat4  u_lightMatrix;',
      'uniform vec3  u_lightPos;',
      'uniform float u_intensity;',
      'uniform float u_rangeFalloff;',
      'uniform float u_noiseIntens;',
      'uniform float u_beamScale;',
      'uniform vec2  u_res;',
      'uniform float u_time;',
      'uniform int   u_debugMode;',
      'uniform float u_lensDistortion;',
      'uniform float u_lensChroma;',
      'uniform vec2  u_cineCenter;',
      'uniform float u_cineScale;',
      'uniform float u_uiShown;',
      '',
      'const float Z_NEAR_MIN = 7.0;',
      'const float Z_D1  = 7.0;   // 前景',
      'const float Z_D2  = 10.0;  // 次近景',
      'const float Z_D3  = 14.0;  // 中景',
      'const float Z_D4  = 20.0;  // 远景',
      'const float Z_BG  = 64.0;  // 天空',
      'const float FOV_TAN = 0.52;',
      '',
      '// ===== 核心光学公式：超广角桶形拉伸弯曲 (Barrel Distortion) =====',
      '// 中心跟随特写焦点(u_cineCenter), 强度随特写缩放放大(u_cineScale):',
      '// 特写是用 CSS scale 放大局部, 若畸变仍以屏幕中心为原点, 被放大的恰是畸变最弱的中心区,',
      '// 于是"看不见"。把原点移到焦点并放大强度后, 特写局部也能看到清晰的球弧弯曲。',
      'vec2 barrelDistort(vec2 coord, float k) {',
      '  vec2 cc = coord - u_cineCenter;',
      '  float r2 = dot(cc, cc);',
      '  k *= u_cineScale;',
      '  // 径向非线性外膨胀：越靠近边缘弧度越大，使平直背景弯成超广角球弧面',
      '  return u_cineCenter + cc * (1.0 + k * r2 + k * 1.5 * r2 * r2);',
      '}',
      '',
      'float ditherNoise(vec2 coord) {',
      '  return fract(sin(dot(coord, vec2(12.9898, 78.233))) * 43758.5453);',
      '}',
      'float hash3D(vec3 p) {',
      '  return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);',
      '}',
      'float valueNoise3D(vec3 p) {',
      '  vec3 i = floor(p); vec3 f = fract(p);',
      '  f = f * f * (3.0 - 2.0 * f);',
      '  float n000 = hash3D(i);',
      '  float n100 = hash3D(i + vec3(1.0, 0.0, 0.0));',
      '  float n010 = hash3D(i + vec3(0.0, 1.0, 0.0));',
      '  float n110 = hash3D(i + vec3(1.0, 1.0, 0.0));',
      '  float n001 = hash3D(i + vec3(0.0, 0.0, 1.0));',
      '  float n101 = hash3D(i + vec3(1.0, 0.0, 1.0));',
      '  float n011 = hash3D(i + vec3(0.0, 1.0, 1.0));',
      '  float n111 = hash3D(i + vec3(1.0, 1.0, 1.0));',
      '  float x00 = mix(n000, n100, f.x);',
      '  float x10 = mix(n010, n110, f.x);',
      '  float x01 = mix(n001, n101, f.x);',
      '  float x11 = mix(n011, n111, f.x);',
      '  return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);',
      '}',
      'float getTriplanarBeams(vec3 dirL) {',
      '  vec3 sampleP = normalize(dirL) * u_beamScale;',
      '  // 干扰噪声随时间漂移: 给采样点叠加随时间变化的偏移, 让光束切碎纹理缓慢流动而非静止',
      '  vec3 tOffset = vec3(u_time * 0.66, u_time * -0.445, u_time * 0.13);',
      '  float n1 = valueNoise3D(sampleP + tOffset);',
      '  float n2 = valueNoise3D(sampleP * 2.2 + vec3(u_time * 0.05) + tOffset * 1.7);',
      '  float beam = pow(n1 * 0.6 + n2 * 0.4, 1.6) * 2.0;',
      '  return mix(1.0, beam, u_noiseIntens);',
      '}',
      '',
      'vec2 projectToUV(vec3 p) {',
      '  float aspect = u_res.x / u_res.y;',
      '  vec2 uv;',
      '  // 相机 lookAt(0,0,1) 朝 +Z 看(右手系), 屏幕右 = 世界 -X, 故 x 需取负;',
      '  // 否则投影与世界镜像, 与真实 u_lightPos 不一致 → 光束从反侧打来(水平翻转)。',
      '  uv.x = (-p.x / (p.z * FOV_TAN * aspect)) * 0.5 + 0.5;',
      '  uv.y = (p.y / (p.z * FOV_TAN)) * 0.5 + 0.5;',
      '  return uv;',
      '}',
      '// 单层遮挡强度 (0 = 透光, 1 = 全挡): 两份深度图按 u_wallMix 混合后经 smoothstep 连续化。',
      '// 静止时遮罩为 0/1 ⇒ 结果也是 0/1(与原硬遮挡一致); 交叉过渡时遮罩为中间值 ⇒ 连续变化, 不瞬变。',
      'float layerOcc(sampler2D texA, sampler2D texB, vec3 p) {',
      '  vec2 suv = projectToUV(p);',
      '  // 交点投影飞出屏幕 = 阴影射线越过山脊/山体轮廓射向高空, 此时无物可挡, 必须放行。',
      '  // 旧实现 clamp 到屏幕边缘再采样: 光源高挂(y=31)时, 山前空气点与深层平面(z=14/20)',
      '  // 的交点常在屏幕之外, 被钳到顶边后恰好命中贴边的远山遮罩 → 全部误判遮挡,',
      '  // 这正是"石头前面的空气一点光都没有"的根因。',
      '  if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) return 0.0;',
      '  // 窗口 (0.05, 0.33) 落在遮罩的空隙内(实测像素只有 0 或 ≥0.35, 中间无值):',
      '  // 静止时存在=1/不存在=0, 与原硬阈值一致; 过渡时混合值扫过空隙 ⇒ 连续, 不瞬变。',
      '  return smoothstep(0.05, 0.33, mix(texture2D(texA, suv).r, texture2D(texB, suv).r, u_wallMix));',
      '}',
      '',
      '// 3D 阴影射线计算（包含岩石 + 真实 3D 碎裂模型阴影）',
      'float shadowRay(vec3 p) {',
      '  vec3 toL = u_lightPos - p;',
      '  float dL = length(toL);',
      '  vec3 L = toL / dL;',
      '  if (L.z <= 0.0001) return 0.0;',
      '',
      '  // 1. 山石分层遮挡 (从最近前景 d1 起逐层累积; 静止时每层为 0/1 ⇒ 等效原硬遮挡)',
      '  float rockOcc = 0.0;',
      '  if (p.z < Z_D1 && u_lightPos.z > Z_D1) {',
      '    rockOcc = max(rockOcc, layerOcc(u_d1, u_d1b, p + L * ((Z_D1 - p.z) / L.z)));',
      '  }',
      '  if (p.z < Z_D2 && u_lightPos.z > Z_D2) {',
      '    rockOcc = max(rockOcc, layerOcc(u_d2, u_d2b, p + L * ((Z_D2 - p.z) / L.z)));',
      '  }',
      '  if (p.z < Z_D3 && u_lightPos.z > Z_D3) {',
      '    rockOcc = max(rockOcc, layerOcc(u_d3, u_d3b, p + L * ((Z_D3 - p.z) / L.z)));',
      '  }',
      '  if (p.z < Z_D4 && u_lightPos.z > Z_D4) {',
      '    rockOcc = max(rockOcc, layerOcc(u_d4, u_d4b, p + L * ((Z_D4 - p.z) / L.z)));',
      '  }',
      '',
      '  // 2. 【核心】：真实 3D 碎块阴影投射（碎缝切光）',
      '  float modelOcc = 0.0;',
      '  vec4 lClip = u_lightMatrix * vec4(p, 1.0);',
      '  // 点在光源相机背后时(lClip.w<=0)透视除法会翻转坐标, 误落进阴影图范围 → 必须排除',
      '  if (lClip.w > 0.0) {',
      '    vec3 lUV = (lClip.xyz / lClip.w) * 0.5 + 0.5;',
      '    if (lUV.x >= 0.0 && lUV.x <= 1.0 && lUV.y >= 0.0 && lUV.y <= 1.0) {',
      '      float shadowDepth = texture2D(u_modelShadowMap, lUV.xy).r;',
      '      if (lUV.z > shadowDepth + 0.002) modelOcc = 1.0; // 被碎石挡住，形成阴影缝隙',
      '    }',
      '  }',
      '  return (1.0 - rockOcc) * (1.0 - modelOcc);',
      '}',
      '',
      'void main() {',
      '  // 1. 光学畸变与广角拉箱 UV 重映射',
      '  vec2 uv = barrelDistort(v_uv, u_lensDistortion);',
      '',
      '  // 2. 超广角边缘色散（拉箱剧烈变焦时边缘红蓝分离）',
      '  vec2 uvR = barrelDistort(v_uv, u_lensDistortion + u_lensChroma);',
      '  vec2 uvB = barrelDistort(v_uv, u_lensDistortion - u_lensChroma);',
      '  // 两张壁纸各自的 RGB 色散采样, 再按轮播进度 u_wallMix 交叉混合',
      '  vec3 wallA = vec3(texture2D(u_color, uvR).r, texture2D(u_color, uv).g, texture2D(u_color, uvB).b);',
      '  vec3 wallB = vec3(texture2D(u_color2, uvR).r, texture2D(u_color2, uv).g, texture2D(u_color2, uvB).b);',
      '  vec4 bgCol = vec4(mix(wallA, wallB, u_wallMix), 1.0);',
      '',
      '  vec4 modelSample = texture2D(u_modelTex, uv);',
      '  float modelZ = modelSample.a; // 模型像素的绝对 3D 深度',
      '',
      '  // 深度遮罩同样按 u_wallMix 交叉混合(两张壁纸的山石分层各自独立)',
      '  float m1 = mix(texture2D(u_d1, uv).r, texture2D(u_d1b, uv).r, u_wallMix);',
      '  float m2 = mix(texture2D(u_d2, uv).r, texture2D(u_d2b, uv).r, u_wallMix);',
      '  float m3 = mix(texture2D(u_d3, uv).r, texture2D(u_d3b, uv).r, u_wallMix);',
      '  float m4 = mix(texture2D(u_d4, uv).r, texture2D(u_d4b, uv).r, u_wallMix);',
      '',
      '  // 判定初始山石深度 (d1 最近前景, 逐层取 min 得到最近的遮挡面)。',
      '  // 遮罩已按 u_wallMix 连续混合, 这里用 smoothstep 权重软化硬阈值(窗口落在遮罩空隙内, 见 layerOcc 注释):',
      '  // 静止时权重 0/1 与原逻辑一致; 交叉过渡时权重连续变化 ⇒ sceneDepth 平滑推移, 体积光不会整块闪现。',
      '  float sceneDepth = Z_BG;',
      '  sceneDepth = min(sceneDepth, mix(Z_BG, Z_D4, smoothstep(0.05, 0.33, m4)));',
      '  sceneDepth = min(sceneDepth, mix(Z_BG, Z_D3, smoothstep(0.05, 0.33, m3)));',
      '  sceneDepth = min(sceneDepth, mix(Z_BG, Z_D2, smoothstep(0.05, 0.33, m2)));',
      '  sceneDepth = min(sceneDepth, mix(Z_BG, Z_D1, smoothstep(0.05, 0.33, m1)));',
      '',
      '  // 【物理交汇】：判断当前像素是看到山石还是看到 3D 模型',
      '  vec3 surfaceColor = bgCol.rgb;',
      '  float modelMask = 0.0; // 1=该像素为 3D 文字模型, 上下暗角需跳过, 保证不压文字',
      '  if (modelZ > 0.1 && modelZ < sceneDepth) {',
      '    // 模型在山石前景，遮挡山石',
      '    surfaceColor = modelSample.rgb;',
      '    sceneDepth = modelZ;',
      '    modelMask = 0.1;',
      '  }',
      '',
      '  // 诊断模式',
      '  if (u_debugMode == 1) {',
      '    gl_FragColor = vec4(vec3((sceneDepth - Z_NEAR_MIN) / (Z_BG - Z_NEAR_MIN)), 1.0);',
      '    return;',
      '  }',
      '  if (u_debugMode == 5) {',
      '    gl_FragColor = vec4(modelSample.rgb, 1.0);',
      '    return;',
      '  }',
      '',
      '  // 视线步进',
      '  float aspect = u_res.x / u_res.y;',
      '  vec2 ndc = uv * 2.0 - 1.0;',
      '  // 与 projectToUV 同一约定: 屏幕右(ndc.x>0)对应世界 -X, 故 x 取负,',
      '  // 使 raymarch 在真实世界空间中积分(与 u_lightPos/相机一致), 修正光束左右镜像。',
      '  vec3 rayDir = normalize(vec3(-ndc.x * FOV_TAN * aspect, ndc.y * FOV_TAN, 1.0));',
      '',
      '  const int STEPS = 45;',
      '  float stepSize = sceneDepth / float(STEPS);',
      '  float jitter = ditherNoise(gl_FragCoord.xy);',
      '  vec3 inscatter = vec3(0.0);',
      '',
      '  for(int i = 0; i < STEPS; i++) {',
      '    float z = (float(i) + jitter) * stepSize;',
      '    if (z >= sceneDepth) break;',
      '    vec3 p = rayDir * (z / rayDir.z);',
      '    vec3 toL = u_lightPos - p;',
      '    float distL = length(toL);',
      '    vec3 dirL = toL / distL;',
      '',
      '    float atten = exp(-distL * u_rangeFalloff) * 1.2;',
      '    vec3 lightForward = normalize(u_lightPos);',
      '    float cosAngle = dot(rayDir, lightForward);',
      '    float circularSpot = smoothstep(0.12, 1.0, cosAngle);',
      '',
      '    float vis = shadowRay(p);',
      '    if (vis > 0.0) {',
      '      float beamShaft = getTriplanarBeams(dirL);',
      '      float scatterFactor = 0.038 * stepSize;',
      '      inscatter += vec3(0.92, 0.96, 1.05) * atten * circularSpot * beamShaft * scatterFactor * vis;',
      '    }',
      '  }',
      '',
      '  vec3 tyndallLight = inscatter * u_intensity;',
      '  if (u_debugMode == 2) {',
      '    gl_FragColor = vec4(tyndallLight, 1.0);',
      '    return;',
      '  }',
      '  if (u_debugMode == 6) tyndallLight = vec3(1.0); // 全亮诊断: 把散射光强制拉满, 继续走正常合成(含暗角)',
      '  if (u_debugMode == 7) {',
      '    // 光线可达遮罩: 白=该像素的光能到达(不被山石分层/模型阴影遮挡), 黑=被挡。',
      '    vec3 pSurf = rayDir * (sceneDepth / rayDir.z);',
      '    gl_FragColor = vec4(vec3(shadowRay(pSurf)), 1.0);',
      '    return;',
      '  }',
      '',
      '  // 滤色输出',
      '  vec3 finalRGB = 1.0 - (1.0 - surfaceColor) * (1.0 - clamp(tyndallLight, 0.0, 1.0));',
      '',
      '  // 广角镜头边缘物理暗角 (随拉箱畸变强度动态加深)',
      '  // 注意: 用 1.0 - smoothstep(0.45, 1.3, r) 等价替代 smoothstep(1.3, 0.45, r),',
      '  // 避免 edge0 > edge1 触发部分驱动上的未定义行为',
      '  float vigR = length((v_uv - 0.5) * vec2(u_res.x / u_res.y, 1.0));',
      '  float edgeVignette = 1.0 - smoothstep(0.45, 1.3, vigR);',
      '  finalRGB *= mix(1.0, edgeVignette, clamp(u_lensDistortion * 1.8, 0.0, 0.65));',
      '',
      '  // 上下固定暗角: 仅压暗背景(山石/天空/体积光), 跳过 3D 文字(modelMask);',
      '  // DOM 层的 2D 菜单/署名/唱片在 canvas 之上, 天然不受影响。',
      '  // 上下分开算: UI 出现(u_uiShown)后上方暗角减弱到 1/3, 下方保持不变。',
      '  float vigTop = smoothstep(0.0, 0.30, v_uv.y);       // 距上边: 边=0 → 0.30 高度处=1',
      '  float vigBot = smoothstep(0.0, 0.30, 1.0 - v_uv.y); // 距下边',
      '  float EDGE_DARKEN = 0.55;                            // 边缘最大压暗比例, 可调',
      '  float topDarken = EDGE_DARKEN * mix(1.0, 0.333, u_uiShown);',
      '  finalRGB *= mix(1.0, vigTop, topDarken * (1.0 - modelMask));',
      '  finalRGB *= mix(1.0, vigBot, EDGE_DARKEN * (1.0 - modelMask));',
      '',
      '  gl_FragColor = vec4(finalRGB, 1.0);',
      '}'
    ].join('\n')
  });

  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), tyndallMat));

  // ===== 6. 加载山石纹理 =====
  var texLoader = new THREE.TextureLoader();
  function loadTex(url, uniformKey) {
    texLoader.load(url, function (t) {
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      tyndallMat.uniforms[uniformKey].value = t;
    });
  }
  // 第一张壁纸 (t1_1, 深度图在 depth/w1/)
  loadTex('../asset/image/wallpaper/void/t1_1.jpg', 'u_color');
  loadTex('../asset/image/wallpaper/void/depth/w1/d1.jpg', 'u_d1');
  loadTex('../asset/image/wallpaper/void/depth/w1/d2.jpg', 'u_d2');
  loadTex('../asset/image/wallpaper/void/depth/w1/d3.jpg', 'u_d3');
  loadTex('../asset/image/wallpaper/void/depth/w1/d4.jpg', 'u_d4');
  // 第二张壁纸 (t1_2, 深度图在 depth/w2/)
  loadTex('../asset/image/wallpaper/void/t1_2.jpg', 'u_color2');
  loadTex('../asset/image/wallpaper/void/depth/w2/d1.jpg', 'u_d1b');
  loadTex('../asset/image/wallpaper/void/depth/w2/d2.jpg', 'u_d2b');
  loadTex('../asset/image/wallpaper/void/depth/w2/d3.jpg', 'u_d3b');
  loadTex('../asset/image/wallpaper/void/depth/w2/d4.jpg', 'u_d4b');

  // ===== 6.6 双壁纸轮播 =====
  // 每次进页面 t=0 必为第一张; 停留 WALL_DWELL_SEC 后交叉过渡到第二张, 再停留同样时长后切回, 循环往复。
  var WALL_DWELL_SEC = 10.0; // 每张壁纸停留时长(秒)
  var WALL_FADE_SEC = 1.5;   // 交叉过渡(渐变)时长(秒)
  function wallMixAt(t) {
    var d = WALL_DWELL_SEC, f = WALL_FADE_SEC;
    var period = 2.0 * (d + f); // 一 → 二 → 一的完整周期
    var ph = t % period;
    var m;
    if (ph < d) m = 0.0;                      // 第一张停留
    else if (ph < d + f) m = (ph - d) / f;    // 第一张 → 第二张
    else if (ph < 2.0 * d + f) m = 1.0;       // 第二张停留
    else m = 1.0 - (ph - (2.0 * d + f)) / f;  // 第二张 → 第一张
    return m * m * (3.0 - 2.0 * m);           // smoothstep: 两端斜率为 0, 过渡无顿挫
  }

  // ===== 6.5 路径曲线与可视化编辑器 =====
  // 注意: 编辑器对象必须放进独立 scene. 若放进 modelScene, 会被两次
  // overrideMaterial 烘焙进模型颜色/深度 FBO 与阴影贴图, 污染体积光效果.
  var editorScene = new THREE.Scene();
  var transformControl = null;
  var curveMesh = null;
  var controlHandles = [];
  // 飞出路径把手与曲线(左顺势 green / 右飞出 yellow)，颜色区别进入路径(粉)
  var flyLeftHandles = [];
  var flyRightHandles = [];
  var flyLeftCurveMesh = null;
  var flyRightCurveMesh = null;

  // 利用 Z 深度与山石发生遮挡穿梭:
  // Z=34(远石D4缝隙出) -> Z=24(中景D3与D4之间) -> Z=14(绕到近石D2前方) -> Z=18(再潜入D2背后) -> Z=20(落到文字平面)
  var defaultPoints = [
  new THREE.Vector3(-22.56, 5.69, 34.00),
  new THREE.Vector3(6.89, 2.95, 17.96),
  new THREE.Vector3(-7.52, -1.32, 9.71),
  new THREE.Vector3(-2.25, -1.64, 4.25),
  new THREE.Vector3(4.17, 1.50, 8.63)
]

  // 创建样条曲线
  var curve = new THREE.CatmullRomCurve3(defaultPoints);
  curve.curveType = 'catmullrom';
  curve.tension = 0.5;

  // 飞出路径：左顺势(+X) / 右飞出(-X)，起点均为 _textFinal
  var flyOutLeftPoints = [
    new THREE.Vector3(4.17, 1.50, 8.63),
    new THREE.Vector3(12.0, 1.8, 8.0),
    new THREE.Vector3(22.0, 2.2, 7.0),
    new THREE.Vector3(32.0, 2.5, 6.0)
  ];
  // 飞出路径：从字模起点出发，单调向相机近处(Z减小)与视口左外侧(X大幅偏左)呼啸掠过
  var flyOutRightPoints = [
    new THREE.Vector3(4.17, 1.50, 8.63),   // 起点：字模世界坐标
    new THREE.Vector3(-1.80, 2.00, 5.50),  // 冲出卡片相框边缘
    new THREE.Vector3(-8.50, 1.40, 2.80),  // 贴近视口前方
    new THREE.Vector3(-22.00, 0.20, 0.60)  // 彻底飞出屏幕左侧
  ]
  var flyOutCurveLeft = new THREE.CatmullRomCurve3(flyOutLeftPoints);
  flyOutCurveLeft.curveType = 'catmullrom';
  flyOutCurveLeft.tension = 0.5;
  var flyOutCurveRight = new THREE.CatmullRomCurve3(flyOutRightPoints);
  flyOutCurveRight.curveType = 'catmullrom';
  flyOutCurveRight.tension = 0.5;

  function initPathEditor() {
    // 1. 绘制进入曲线轨迹线 (cyan)
    var curveGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(100));
    var curveMat = new THREE.LineBasicMaterial({ color: 0x00ffff });
    curveMesh = new THREE.Line(curveGeo, curveMat);
    curveMesh.frustumCulled = false;
    editorScene.add(curveMesh);

    // 2. 进入路径控制球 (pink 0xff79c6)
    var handleGeo = new THREE.SphereGeometry(0.35, 16, 16);
    defaultPoints.forEach(function (pt) {
      var handle = new THREE.Mesh(handleGeo, new THREE.MeshBasicMaterial({ color: 0xff79c6 }));
      handle.position.copy(pt);
      editorScene.add(handle);
      controlHandles.push(handle);
    });

    // 3. 飞出路径把手: 左顺势 green(0x50fa7b) / 右飞出 yellow(0xf1fa8c)
    var flyHandleGeo = new THREE.SphereGeometry(0.32, 16, 16);
    flyOutLeftPoints.forEach(function (pt) {
      var h = new THREE.Mesh(flyHandleGeo, new THREE.MeshBasicMaterial({ color: 0x50fa7b }));
      h.position.copy(pt);
      editorScene.add(h);
      flyLeftHandles.push(h);
    });
    flyOutRightPoints.forEach(function (pt) {
      var h = new THREE.Mesh(flyHandleGeo, new THREE.MeshBasicMaterial({ color: 0xf1fa8c }));
      h.position.copy(pt);
      editorScene.add(h);
      flyRightHandles.push(h);
    });
    flyLeftCurveMesh = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(flyOutCurveLeft.getPoints(60)),
      new THREE.LineBasicMaterial({ color: 0x50fa7b })
    );
    flyLeftCurveMesh.frustumCulled = false;
    editorScene.add(flyLeftCurveMesh);
    flyRightCurveMesh = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(flyOutCurveRight.getPoints(60)),
      new THREE.LineBasicMaterial({ color: 0xf1fa8c })
    );
    flyRightCurveMesh.frustumCulled = false;
    editorScene.add(flyRightCurveMesh);

    // 4. TransformControls
    transformControl = new THREE.TransformControls(camera, renderer.domElement);
    editorScene.add(transformControl);

    transformControl.addEventListener('change', function () {
      // 进入路径
      curve.points = controlHandles.map(function (h) { return h.position; });
      curve.needsUpdate = true;
      curveMesh.geometry.setFromPoints(curve.getPoints(100));
      // 飞出左
      flyOutCurveLeft.points = flyLeftHandles.map(function (h) { return h.position; });
      flyOutCurveLeft.needsUpdate = true;
      flyLeftCurveMesh.geometry.setFromPoints(flyOutCurveLeft.getPoints(60));
      // 飞出右
      flyOutCurveRight.points = flyRightHandles.map(function (h) { return h.position; });
      flyOutCurveRight.needsUpdate = true;
      flyRightCurveMesh.geometry.setFromPoints(flyOutCurveRight.getPoints(60));
    });

    // 默认吸附选中第 1 个控制点
    transformControl.attach(controlHandles[0]);

    // 5. 点击切换(进入 + 飞出把手统一检测)
    var raycaster = new THREE.Raycaster();
    var mouse = new THREE.Vector2();
    var allHandles = function () { return controlHandles.concat(flyLeftHandles).concat(flyRightHandles); };
    window.addEventListener('pointerdown', function (e) {
      if (e.target !== canvas) return;
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      var hits = raycaster.intersectObjects(allHandles());
      if (hits.length > 0) transformControl.attach(hits[0].object);
    });

    // 6. 导出按钮: 打印进入+飞出路径坐标
    var btnExport = document.getElementById('btn_export_path');
    if (btnExport) {
      btnExport.onclick = function () {
        var fmt = function (arr) {
          return '[\n  ' + arr.map(function (h) {
            return 'new THREE.Vector3(' + h.position.x.toFixed(2) + ', ' + h.position.y.toFixed(2) + ', ' + h.position.z.toFixed(2) + ')';
          }).join(',\n  ') + '\n]';
        };
        console.log('进入路径:\n' + fmt(controlHandles));
        console.log('飞出左顺势:\n' + fmt(flyLeftHandles));
        console.log('飞出右飞出:\n' + fmt(flyRightHandles));
        alert('已在控制台打印进入+飞出路径坐标');
      };
    }
  }
  initPathEditor();

  // ===== 7. UI 事件监听绑定 =====
  var pMode    = document.getElementById('p_mode');
  var pLx      = document.getElementById('p_lx');
  var pLy      = document.getElementById('p_ly');
  var pLz      = document.getElementById('p_lz');
  var pInt     = document.getElementById('p_int');
  var pRange   = document.getElementById('p_range');
  var pNoise   = document.getElementById('p_noise');
  var pScale   = document.getElementById('p_scale');
  var pMz      = document.getElementById('p_mz');
  var pShatter = document.getElementById('p_shatter');
  var pProgress = document.getElementById('p_progress');
  var pAutoplay = document.getElementById('p_autoplay');

  var vLx      = document.getElementById('v_lx');
  var vLy      = document.getElementById('v_ly');
  var vLz      = document.getElementById('v_lz');
  var vInt     = document.getElementById('v_int');
  var vRange   = document.getElementById('v_range');
  var vNoise   = document.getElementById('v_noise');
  var vScale   = document.getElementById('v_scale');
  var vMz      = document.getElementById('v_mz');
  var vShatter = document.getElementById('v_shatter');
  var vProgress = document.getElementById('v_progress');

  function syncUI() {
    if (vLx) vLx.textContent = pLx.value;
    if (vLy) vLy.textContent = pLy.value;
    if (vLz) vLz.textContent = pLz.value;
    if (vInt) vInt.textContent = pInt.value;
    if (vRange) vRange.textContent = pRange.value;
    if (vNoise) vNoise.textContent = pNoise.value;
    if (vScale) vScale.textContent = pScale.value;
    if (vMz) vMz.textContent = pMz.value;
    if (vShatter) vShatter.textContent = pShatter.value;
    if (vProgress && pProgress) vProgress.textContent = parseFloat(pProgress.value).toFixed(2);
  }
  document.querySelector('.debug-panel').addEventListener('input', syncUI);

  // ===== Skip 按钮: 开场期间点击直接跳到 UI 出现态 =====
  var _skipToEnd = false;
  var skipBtn = document.createElement('div');
  skipBtn.textContent = 'Skip（跳过）';
  skipBtn.style.cssText = [
    'position:fixed', 'right:24px', 'bottom:24px',
    'font-family:Rondal,serif', 'font-size:2vw', 'letter-spacing:0.12em',
    'font-style:italic', 'color:rgba(208, 212, 235, 0.34)', 'cursor:pointer', 'z-index:99',
    'pointer-events:auto', 'opacity:0', 'transition:opacity 2.4s ease',
    'user-select:none', '-webkit-user-select:none'
  ].join(';');
  document.body.appendChild(skipBtn);
  skipBtn.addEventListener('click', function () {
    _skipToEnd = true;
  });

  // ===== 开场电影遮幅: 与 wikimodel.js 进场同款 2.35:1 黑条, 覆盖"飞来动画段"(UI 出现前) =====
  var INTRO_LB_ASPECT = 2.35; // 与 wikimodel.js LETTERBOX_ASPECT 同值
  var INTRO_LB_SEC = 0.7;     // 滑入/滑出时长(秒), 与 wikimodel.js LETTERBOX_SEC 同款缓动
  // 【滑出时机】装配进度到该值黑条开始滑出: 0.825 ≈ 滑完(0.7s)恰好 UI 出现; 改 1.0 = 与 UI 淡入同刻才开始滑出
  var INTRO_LB_OUT_AT = 0.825;
  // SKIP 按钮距下方黑条上沿的间距(px): 让按钮站在黑条"上方", 不压在黑边上
  var SKIP_BTN_GAP = 18;
  var _introLbGone = false;
  function mkIntroBar(offY) { // offY: -101 顶部条(藏于上沿外), 101 底部条
    var bar = document.createElement('div');
    bar.style.cssText = [
      'position:fixed', 'left:0', 'right:0', offY < 0 ? 'top:0' : 'bottom:0',
      'height:0', 'background:#000', 'z-index:40', 'pointer-events:none',
      'transform:translateY(' + offY + '%)',
      'transition:transform ' + INTRO_LB_SEC + 's cubic-bezier(0.65, 0, 0.35, 1)'
    ].join(';');
    document.body.appendChild(bar);
    return bar;
  }
  var introBarTop = mkIntroBar(-101), introBarBottom = mkIntroBar(101);
  function layoutIntroBars() {
    var h = Math.max(0, (window.innerHeight - window.innerWidth / INTRO_LB_ASPECT) / 2);
    introBarTop.style.height = h + 'px';
    introBarBottom.style.height = h + 'px';
    // SKIP 按钮抬到下方黑条上沿之上(与 wikimodel 字幕同款做法), 避免压在变比例黑边上
    skipBtn.style.bottom = (h + SKIP_BTN_GAP) + 'px';
  }
  layoutIntroBars();
  void introBarTop.offsetHeight; // 强制布局冲刷: 否则"出场位→0"与首帧合并, 滑入过渡被吞
  introBarTop.style.transform = 'translateY(0)';
  introBarBottom.style.transform = 'translateY(0)';
  function retractIntroBars() {
    if (_introLbGone) return;
    _introLbGone = true;
    introBarTop.style.transform = 'translateY(-101%)';
    introBarBottom.style.transform = 'translateY(101%)';
    setTimeout(function () { // 滑出结束即摘除, 避免残留元素参与后续合成
      introBarTop.style.display = 'none';
      introBarBottom.style.display = 'none';
    }, INTRO_LB_SEC * 1000 + 120);
  }

  // ===== 3D 标题下方的 2D 菜单: 屏幕位置由标题碎块的真实投影包围盒驱动 =====
  // 菜单本体(样式/DOM/交互)在独立的 rpgmenu.js 中, 通过 window.RpgMenu 接口锚定
  var _rpgMenuPlaced = false; // 防止每帧调 place; resize 时置 false 重定位
  // UI 出现时的光斑闪动(0→1→0)单次触发标志: resize 会让 _projReady 失效重跑装配块, 但不该重复闪
  var _glowFlashFired = false;
  // 【菜单位置微调】水平像素偏移: 负值左移、正值右移(改这里即可移动菜单)
  var MENU_X_OFFSET = -70;
  // UI 出现状态: target 由装配完成态切换, cur 逐帧平滑过渡, 驱动上方暗角减弱
  var _uiShownTarget = 0.0, _uiShownCur = 0.0, _uiShownPrevT = 0.0;
  // 【3D 文字压扁】UI 显示后文字沿 textGroup 局部 Y 轴的缩放比例: 1/12 = 压扁 12 倍
  var TITLE_SQUASH_RATIO = 1.0 / 24.0;
  // 飞出时"压扁还原"的渐入进度(0=保持压扁, 1=完全还原到 1.0)。
  // 压扁态 scale.y≈0.042, 若起飞瞬间直接还原会 24 倍竖直突跳, 故此处做同款平滑渐入。
  var FLY_UNSQUASH_DURATION = 0.8; // 压扁还原渐入时长(秒), 调大还原更慢更柔和
  var _flyUnSquash = 0.0, _flyUnSquashPrevT = -1.0;
  // 有碎块投影数据时按包围盒居中、贴标题下沿; 模型未加载时回退到路径终点投影
  function updateRpgMenuPos() {
    if (!window.RpgMenu) return;
    var W = window.innerWidth, H = window.innerHeight;
    var centerX, topY;
    if (_projReady && chunks.length) {
      var minX = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (var k = 0; k < chunks.length; k++) {
        var c = chunks[k];
        if (c._sx < minX) minX = c._sx;
        if (c._sx > maxX) maxX = c._sx;
        if (c._sy > maxY) maxY = c._sy;
      }
      centerX = (minX + maxX) * 0.5;
      // 碎块存的是几何中心, 下沿再补约 3% 屏高作为半个字高+间距
      topY = maxY + H * 0.09;
    } else {
      projVec.copy(_textFinal).project(camera);
      centerX = (projVec.x * 0.5 + 0.5) * W;
      topY = (-projVec.y * 0.5 + 0.5) * H + H * 0.09;
    }
    window.RpgMenu.place(centerX + MENU_X_OFFSET, topY);
  }

  function resize() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    var _baseDpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(_baseDpr * _homeScale); // 降分辨率: 顶层后处理(色散/光斑)开销随之平方下降
    renderer.setSize(w, h);
    var _tw = Math.max(1, Math.round(w * _homeScale));
    var _th = Math.max(1, Math.round(h * _homeScale));
    modelColorDepthTarget.setSize(_tw, _th); // 体积光主体渲染目标按倍数缩小(片元数 ≈ s²)
    sceneTarget.setSize(_tw, _th);
    if (window.CursorFilter) window.CursorFilter.resize(w, h);
    if (window.GlowFilter) window.GlowFilter.resize(w, h); // 光斑滤镜后备纹理随视口
    tyndallMat.uniforms.u_res.value.set(w, h); // 着色器只用 u_res 的比例(aspect), 视口同比即可
    layoutIntroBars(); // 遮幅高度按新视口重算(不在开场期也无害: display:none 上写高度)
    _projReady = false; // 尺寸变化后碎块屏幕坐标失效, 下次装配完成时重算
    _rpgMenuPlaced = false; // 菜单屏幕锚点同步失效, 下一帧重定位
  }
  function homeScaleSet(s) { // 供 HomeGate.setScale: 改倍数并立即重建所有渲染目标
    if (s === _homeScale) return;
    _homeScale = s;
    resize();
  }
  window.addEventListener('resize', resize);
  resize();

  // ===== 7.5 升级版：加入透视倾角、镜头呼吸与机身侧倾 =====
  var CINE_BLUR = (function () { var m = /[?&]blur=([\d.]+)/.exec(location.search); return m ? parseFloat(m[1]) : 1.0 })(); // ?blur=0 可关闭CSS模糊做性能对照
  var BLUR_MAX = 12.0; // 模糊半径上限(px): 25px 全屏模糊合成代价过高, 封顶后几乎无视觉差异但省很多
  var _lastStageTf = '';      // 样式写入缓存: 值未变则不写, 避免无谓的样式重算与图层重合成
  var _lastStageOrigin = '';
  var _lastStageFilter = '';
  function updateCinematicEffect(globalT, targetWorldPos, time) {
    if (!stage || window._isPhotoMode) return; // 照片模式下冻结运镜，保护相纸角度
    if (pCineCam && !pCineCam.checked) {
      stage.style.transform = 'none';
      stage.style.filter = 'none';
      _lastStageTf = 'none'; _lastStageOrigin = ''; _lastStageFilter = 'none';
      // 关闭运镜时畸变回到全屏居中、原强度
      _cineCenterU = 0.5; _cineCenterV = 0.5; _cineScale = 1.0;
      if (window.GlowFilter) window.GlowFilter.setIntensity(0); // 无模糊则无散光
      return;
    }

    // 1. 获取目标屏幕 2D 像素坐标与归一化偏移量 [-1, 1]
    projVec.copy(targetWorldPos).project(camera);
    var screenX = (projVec.x * 0.5 + 0.5) * window.innerWidth;
    var screenY = (-projVec.y * 0.5 + 0.5) * window.innerHeight;

    var centerX = window.innerWidth * 0.5;
    var centerY = window.innerHeight * 0.5;

    // 偏离画面中心的比例（用于计算镜头仰俯和透视形变）
    var ndcX = projVec.x; // -1(左) 到 +1(右)
    var ndcY = projVec.y; // -1(下) 到 +1(上)

    var scale = 1.0;
    var blur = 0.0;
    var focusX = centerX;
    var focusY = centerY;
    var breath = 0.0; // 镜头呼吸缩放脉冲
    var roll = 0.0;   // 机身侧倾角 (度)

    if (globalT < 0.40) {
      // 阶段 ①：大虚化入场 + 高速伴飞（带机身倾斜，破除平移感）
      var t1 = globalT / 0.40;
      var ease1 = t1 * t1;
      scale = 1.0 + ease1 * 0.75;
      blur = 10.0 * (1.0 - ease1 * 0.4);
      focusX = THREE.MathUtils.lerp(centerX, screenX, ease1);
      focusY = THREE.MathUtils.lerp(centerY, screenY, ease1);

      // 高速伴飞时机身带有 1.8 度的向心侧倾
      roll = Math.sin(t1 * Math.PI) * -1.8;
      _camK = 0; _camKv = 0; _camPrevTime = time; // 回正弹簧复位
    } else if (globalT < 0.56) {
      // 阶段 ②：【拉风箱寻焦】+【镜头呼吸效应】（镜片伸缩脉冲）
      var t2 = (globalT - 0.40) / 0.16;
      scale = 1.75;
      focusX = screenX;
      focusY = screenY;

      var decay = Math.exp(-t2 * 4.2);
      var wave = Math.sin(t2 * Math.PI * 3.5);
      blur = Math.abs(wave) * decay * 25.0; // 拉风箱模糊强度(px), 调大更糊

      // 【核心】：镜头光学呼吸！模糊变大时，画面同步产生 ±2.5% 的尺寸脉冲
      breath = wave * decay * 0.04;
      // 寻焦微晃
      roll = Math.cos(t2 * Math.PI * 2.0) * decay * 0.8;
      _camK = 0; _camKv = 0; _camPrevTime = time; // 回正弹簧复位
    } else if (globalT < 0.62) {
      // 阶段 ③：咬死焦点，极近特写观察拼合
      scale = 1.75;
      blur = 0.0;
      focusX = screenX;
      focusY = screenY;
      roll = 0.0;
      _camK = 0; _camKv = 0; _camPrevTime = time; // 回正弹簧复位(阶段④从0、初速0起步)
    } else if (globalT < TIME_SPLIT) {
      // 阶段 ④：回正——加宽回正窗口(0.62→TIME_SPLIT, 比原先长很多)使回正不再是"一闪而过";
      // 并改用【欠阻尼弹簧】跟踪回正进度, 到 1.0 时过冲/回弹, 形成带弹性的收尾(与碎块入槽同质感)。
      // 安全约束: 缩放用【二次映射】scale=1+0.75*(1-_camK)² —— 过冲(_camK>1)只会让 scale 略>1
      // (绝不 <1 露黑边, 无需 clamp); 且 _camK=1 处导数=0, 回正收尾速度自然过渡到 0, 不会急停。
      var t4 = (globalT - 0.62) / (TIME_SPLIT - 0.62);
      var kTarget = THREE.MathUtils.smoothstep(t4, 0.0, 1.0);
      var _dt = Math.min(Math.max(time - _camPrevTime, 0), 0.05); _camPrevTime = time;
      var _acc = (kTarget - _camK) * CAM_SPRING_K - _camKv * CAM_SPRING_DAMP;
      _camKv += _acc * _dt;
      _camK += _camKv * _dt;

      // 用【二次映射】替代线性 lerp+clamp: 过冲(_camK>1)只会让 scale 略>1(不露黑边), 无需钳制;
      // 且 _camK=1 处导数=0 → 回正收尾速度自然过渡到 0, 不再被 clamp 截出"停-走"的急停。
      var _r = 1.0 - _camK;
      scale = 1.0 + 0.75 * _r * _r;
      blur = 0.0;
      // 焦点用【未钳制】进度: 允许镜头轻微越过中心再荡回, 弹性更自然且无露馅风险
      focusX = THREE.MathUtils.lerp(screenX, centerX, _camK);
      focusY = THREE.MathUtils.lerp(screenY, centerY, _camK);
      // 轻微侧倾: 用 sin² 脉冲, 起止处"值=0 且斜率=0", 与前/后阶段的 roll=0 平滑衔接
      var _s4 = Math.sin(t4 * Math.PI);
      roll = 0.4 * _s4 * _s4;
    } else {
      // 阶段 ⑤：回正后镜头继续用弹簧收敛到静止(弹性尾摆在此收尾), 之后完全静止
      var _dt2 = Math.min(Math.max(time - _camPrevTime, 0), 0.05); _camPrevTime = time;
      var _acc2 = (1.0 - _camK) * CAM_SPRING_K - _camKv * CAM_SPRING_DAMP;
      _camKv += _acc2 * _dt2;
      _camK += _camKv * _dt2;
      // 收敛阈值吸附: 二次映射下残余弹簧对 scale 影响已是高阶小量, 阈值放宽即可, 避免无限趋近
      if (Math.abs(1.0 - _camK) < 1e-3 && Math.abs(_camKv) < 1e-3) { _camK = 1.0; _camKv = 0.0; }
      var _r2 = 1.0 - _camK;
      scale = 1.0 + 0.75 * _r2 * _r2;
      blur = 0.0;
      focusX = THREE.MathUtils.lerp(screenX, centerX, _camK);
      focusY = THREE.MathUtils.lerp(screenY, centerY, _camK);
      roll = 0.0;
    }

    // 2. 计算 3D 机身角度（消除平移感的绝杀）：
    // 根据特写焦点偏离屏幕中心的距离，动态产生透视倾角（前大后小梯形形变）
    var rotX = -ndcY * 3.2 * (scale - 1.0); // 俯仰角 (Pitch)
    var rotY = ndcX * 4.0 * (scale - 1.0);  // 偏航角 (Yaw)
    var finalScale = scale + breath;

    // 3. 加入轻微的手持摄影机高频微颤（让画面有人的体温，不死板）
    var jitterX = Math.sin(time * 12.0) * 0.8 * (scale - 1.0);
    var jitterY = Math.cos(time * 10.0) * 0.8 * (scale - 1.0);

    // 4. 应用组合矩阵变换
    // 模糊半径量化到 0.5px 并封顶: 每帧变化的大模糊核会让合成器无法复用模糊结果,
    // 造成周期性停顿; 量化后相邻帧多为同一核, 可复用, 尖刺基本消失。
    var qBlur = Math.min(blur * CINE_BLUR, BLUR_MAX);
    qBlur = Math.round(qBlur * 2) / 2;
    var filterStr = qBlur > 0.05 ? 'blur(' + qBlur + 'px)' : 'none';
    var originStr = (focusX + jitterX).toFixed(1) + 'px ' + (focusY + jitterY).toFixed(1) + 'px';
    var tfStr = 'scale(' + finalScale.toFixed(4) + ') ' +
      'rotateX(' + rotX.toFixed(2) + 'deg) ' +
      'rotateY(' + rotY.toFixed(2) + 'deg) ' +
      'rotateZ(' + roll.toFixed(2) + 'deg)';

    // 仅在与上一帧不同时才写样式(空闲/静止阶段可完全跳过重写, 彻底消除图层重合成)
    if (originStr !== _lastStageOrigin) { stage.style.transformOrigin = originStr; _lastStageOrigin = originStr; }
    if (tfStr !== _lastStageTf) { stage.style.transform = tfStr; _lastStageTf = tfStr; }
    if (filterStr !== _lastStageFilter) { stage.style.filter = filterStr; _lastStageFilter = filterStr; }

    // 全局散光滤镜强度: 与本次"实际应用"的模糊量同源(用未量化值; ?blur=0 时连带为 0)
    // —— 模糊消失 → 强度归零, 归零即从渲染链摘除(零开销); UI 出现时的闪动由 flash() 单独触发
    if (window.GlowFilter) window.GlowFilter.setIntensity(Math.min(blur * CINE_BLUR, BLUR_MAX));

    // 5. 把"畸变跟随特写"所需的中心与强度写回缓存(供下一帧 Pass2 使用):
    //    - 中心取 CSS transform-origin 的焦点(含手持微颤), 让球弧圆心与放大圆心重合;
    //    - 强度按 finalScale² 放大: CSS 放大 S 倍后, 画面内可见的畸变会按 ~1/S 变弱,
    //      正视镜头的真实桶形畸变曲率在放大后应依然清晰, 故按 S² 补偿使其"跟着特写"可见。
    //    非特写阶段(finalScale=1)时 _cineScale=1、中心=屏心, 与原全局畸变完全一致, 无回归。
    _cineCenterU = (focusX + jitterX) / window.innerWidth;
    _cineCenterV = 1.0 - (focusY + jitterY) / window.innerHeight; // UV 原点在左下, 屏幕 Y 向下
    _cineScale = Math.pow(finalScale, 1.2);
  }

  // ===== 7.9 控制台性能检测(定位卡顿来源) =====
  // 每 PROFILE_EVERY 毫秒输出一次, 把一帧拆成三段分别计时:
  //   Pass1A 阴影贴图 | Pass1B 模型颜色+深度 | Pass2 全屏体积光(45步 raymarch)
  // 帧间隔 avg/p95/max 反映实际流畅度与尖刺; 主线程列为主线程提交命令耗时(不含 GPU)
  // 本机无 EXT_disjoint_timer_query, 故每隔若干帧用 gl.finish() 做一次真同步探针拿 GPU 真耗时
  var PROFILE = false // 首页体积光性能检测: 已关闭(改 true 可重新开启)
  var PROFILE_EVERY = 2000
  var STEPS_INFO = parseInt((/const int STEPS = (\d+)/.exec(tyndallMat.fragmentShader) || [0, 0])[1], 10)
  var profFrames = []
  var profA = [], profB = [], profC = []       // 主线程各段耗时
  var profGpuA = [], profGpuB = [], profGpuC = [] // gl.finish 探针 GPU 耗时
  var profLast = 0
  var profLastFlush = 0
  var profProbe = true // 本帧是否执行 gl.finish 探针

  function tAvg(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0 }
  function tPct(a, p) { if (!a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y }); return s[Math.min(s.length - 1, Math.floor(s.length * p))] }

  function tyndallFlush() {
    if (!profFrames.length) return
    var frame = tAvg(profFrames)
    var a = tAvg(profA), b = tAvg(profB), c = tAvg(profC)
    var hasGpu = profGpuC.length > 0
    var ga = tAvg(profGpuA), gb = tAvg(profGpuB), gc = tAvg(profGpuC)
    var w = renderer.domElement.width, h = renderer.domElement.height
    console.log(
      '%c[体积光性能] ' + frame.toFixed(2) + 'ms/帧 (' + (1000 / frame).toFixed(1) + ' FPS)',
      'color:#fc6;font-weight:bold',
      '\n  帧间隔   avg ' + frame.toFixed(2) + '  p95 ' + tPct(profFrames, 0.95).toFixed(2) + '  max ' + tPct(profFrames, 1).toFixed(2) + ' ms',
      '\n  主线程   Pass1A阴影 ' + a.toFixed(3) + ' | Pass1B模型 ' + b.toFixed(3) + ' | Pass2体积光 ' + c.toFixed(3) + ' ms',
      '\n  GPU      ' + (hasGpu
        ? 'Pass1A ' + ga.toFixed(2) + ' | Pass1B ' + gb.toFixed(2) + ' | Pass2 ' + gc.toFixed(2) + ' = 合计 ' + (ga + gb + gc).toFixed(2) + ' ms'
        : '采样中…'),
      '\n  负载     ' + w + '×' + h + ' = ' + (w * h / 1e6).toFixed(2) + 'M 片元 × ' + STEPS_INFO + ' 步 = ' + (w * h * STEPS_INFO / 1e6).toFixed(1) + 'M 步/帧',
      '\n  参数     dpr=' + (window.devicePixelRatio || 1).toFixed(2) + '  STEPS=' + STEPS_INFO
    )
    var p95v = tPct(profFrames, 0.95), maxv = tPct(profFrames, 1)
    profFrames = []; profA = []; profB = []; profC = []
    profGpuA = []; profGpuB = []; profGpuC = []
    profProbe = true
    // 暴露给浏览器控制台/自动化读取, 避免仅靠 console 文本
    var _hist = window.__TYNDALL_PERF__ = window.__TYNDALL_PERF__ || []
    _hist.push({ t: Math.round(performance.now()), frame: +frame.toFixed(2), p95: +p95v.toFixed(2), max: +maxv.toFixed(2), pass: { a: +a.toFixed(3), b: +b.toFixed(3), c: +c.toFixed(3) }, gpu: { a: +ga.toFixed(2), b: +gb.toFixed(2), c: +gc.toFixed(2) } })
    if (_hist.length > 60) _hist.shift()
  }

  // ===== 8. 主渲染循环 =====
  var clock = new THREE.Clock();

  // ===== 8.1 每帧复用与预计算(消除 GC 抖动) =====
  // 曲线与文字终点在未编辑锚点时是常量, 之前每帧 getLengths(400) 会分配一个 400 长数组,
  // 再加上每帧 new Vector3/Matrix4/getPointAt 分配, 在 240fps 下造成持续 GC 停顿(尖刺)。
  // 这里预计算一次 + 复用临时对象, 把每帧的堆分配降到 0。
  var _DIV = 400
  var _tSplitUniform = (defaultPoints.length - 2) / (defaultPoints.length - 1)
  var _lensTable = curve.getLengths(_DIV)
  var SPLIT_T = _lensTable[Math.round(_tSplitUniform * _DIV)] / _lensTable[_DIV]
  var TIME_SPLIT = 0.78
  // ===== 弹簧手感可调参数(碎块撞击入槽的弹性) =====
  // SPRING_DECAY: 阻尼衰减系数。越大越快停住(越硬), 越小振荡拖得越久(越弹)。
  // SPRING_FREQ : 振荡周期数(×π)。越大弹跳次数越多、越"回弹"。
  // SETTLE_POW  : 自旋/螺旋扰动衰减指数。越小拖尾越长, 与弹簧同步更"活"。
  var SPRING_DECAY = 2.5
  var SPRING_FREQ = 0.01
  var SETTLE_POW = 1.6
  var _textFinal = curve.getPointAt(1.0)
  var _tmpLight = new THREE.Vector3()
  var _tmpLightMatrix = new THREE.Matrix4()
  var _tmpSwirl = new THREE.Vector3()
  var _tmpCurve = new THREE.Vector3()
  var _tmpCamPoint = new THREE.Vector3()
  // 特写跟随的畸变中心/强度: updateCinematicEffect 在 Pass2 之后才调用,
  // 这里缓存供下一帧 Pass2 使用(1 帧延迟, 视觉无感), 避免每帧重排调用顺序。
  var _cineCenterU = 0.5
  var _cineCenterV = 0.5
  var _cineScale = 1.0

  // 镜头回正弹簧(与碎块入槽同一质感): 欠阻尼振子跟踪回正进度 0→1, 到点后过冲/回弹形成弹性收尾
  var CAM_SPRING_K = 60      // 刚度: 越大回正越快越"硬"
  var CAM_SPRING_DAMP = 10   // 阻尼: 临界阻尼≈2√K(≈15.5), 取<临界则过冲回弹, 调小弹性更明显
  var _camK = 0              // 回正进度(弹簧状态, 可过冲>1)
  var _camKv = 0             // 回正进度速度
  var _camPrevTime = 0       // 上一帧时间, 用于求弹簧积分 dt

  // ===== 8.1b 鼠标散开交互: 装配完成后, 鼠标周围的碎块实时向外推开 =====
  // 思路: 每个碎块槽位的屏幕像素坐标在装配完成时算一次(相机与文字均静止, 恒定不变),
  // 之后每帧只比较"鼠标像素位置 vs 碎块槽位像素位置", 距离越近外推力越大, 逐帧实时。
  var _pointer = new THREE.Vector2(0, 0);  // 鼠标 NDC (-1..1)
  var _hasPointer = false;                 // 鼠标是否在页面内(移出时碎块自动收回)
  var _projReady = false;                  // 槽位屏幕坐标是否已预计算
  var _pushR = 240;                        // 影响半径(像素)
  var _pushR2 = _pushR * _pushR;
  var _pushMax = 0.4;                      // 最大外推距离(局部单位, 调手感)
  // ===== 弹簧手感(推开/回弹的弹性) =====
  var SPRING_K = 170;                      // 刚度: 越大回位越快越"硬"
  var SPRING_DAMP = 9;                     // 阻尼: 越小越弹(<临界阻尼则过冲回弹)
  var ROT_COUPLE = 1.15;                   // 位移->转动耦合: 散开时碎块自然翻转
  // ===== 静止时的"微微移动、转动" =====
  var IDLE_AMP = 0.01;                      // 微动幅度(局部单位)
  var IDLE_ROT = 0.9;                       // 微动->微转耦合
  var IDLE_FADE = 0.9;                      // 装配完成 -> 微颤 的淡入时长(秒), 避免瞬变
  var _settleStartTime = -1;                // 进入"装配完成"态的时间(用于淡入), 未进入为 -1
  var _dtPrev = 0;                          // 上一帧时间, 用于求 dt
  var _flyMinX = NaN, _flyMaxX = NaN;        // 碎块局部 X 范围(用于从左到右依次延迟飞出)
  // 世界方向 -> 碎块父节点(gltf.scene)局部方向: 在预计算时由父节点世界矩阵求得,
  // 严格对应 mesh.position 所在的空间(不受 gltf 根变换/父级旋转影响)
  var _invQuat = new THREE.Quaternion();
  var _camRight = new THREE.Vector3();
  var _camUp = new THREE.Vector3();
  var _tmpCR = new THREE.Vector3();
  var _tmpCU = new THREE.Vector3();
  var _tmpDir = new THREE.Vector3();
  var _tmpWorld = new THREE.Vector3();
  var _tmpBox = new THREE.Box3();
  var _tmpPr = new THREE.Vector3();
  var _tmpSc = new THREE.Vector3();

  // ===== 独立全屏破框渲染层 (Overlay Canvas) =====
  // 卡片内主画布被 CSS 内缩进相框, 且 #cinematic-stage 有 overflow:hidden, 碎块飞出相框
  // 边界会被主画布视口直接裁剪。这里用一块覆盖全屏且置于最顶层的透明画布渲染飞出碎块,
  // 拥有整个视口的可视范围, 彻底打破相框尺寸与 overflow 的物理封锁。
  // 注意: 必须声明在 render() 外层(模块作用域), 否则每帧被重置为 null 会丢失已建画布。
  var flyCanvas = null;
  var flyRenderer = null;
  var flyScene = null;

  // 飞出专属实体石材材质 (alpha=1.0 实心遮挡, 具备立体光影)
  var flyMat = new THREE.ShaderMaterial({
    extensions: { derivatives: true },
    vertexShader: [
      'varying vec3 vWorldPos;',
      'void main() {',
      '  vec4 wp = modelMatrix * vec4(position, 1.0);',
      '  vWorldPos = wp.xyz;',
      '  gl_Position = projectionMatrix * viewMatrix * wp;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'varying vec3 vWorldPos;',
      'void main() {',
      '  vec3 fNormal = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));',
      '  vec3 lightDir = normalize(vec3(0.3, 1.0, -0.6));',
      '  float diff = max(dot(fNormal, lightDir), 0.0);',
      '  float front = max(dot(fNormal, vec3(0.0, 0.0, -1.0)), 0.0) * 0.45;',
      '  vec3 stoneColor = vec3(0.85, 0.88, 0.94) * (diff * 0.7 + front + 0.3);',
      '  gl_FragColor = vec4(stoneColor, 1.0);', // 纯实体输出
      '}'
    ].join('\n')
  });

  window.triggerTitleFlyOut = function () {
    if (window._isFlyingOut) return;
    window._isFlyingOut = true;
    window._isFlyingBack = false;
    window._isPhotoMode = true;
    window._flyProgress = 0.0;
    _flyUnSquash = 0.0; _flyUnSquashPrevT = -1.0;

    // 1. 全屏透明顶层画布: 脱离 #cinematic-stage, 置于屏幕最顶层(可反复进出, 只构建一次)
    if (!flyCanvas) {
      flyCanvas = document.createElement('canvas');
      flyCanvas.id = 'flyout-overlay';
      flyCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:999;';
      document.body.appendChild(flyCanvas);

      flyRenderer = new THREE.WebGLRenderer({ canvas: flyCanvas, alpha: true, antialias: true });
      flyRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      flyRenderer.setSize(window.innerWidth, window.innerHeight);

      // 窗口尺寸自适应(只挂一次)
      window.addEventListener('resize', function () {
        if (flyRenderer) flyRenderer.setSize(window.innerWidth, window.innerHeight);
      });
    } else {
      flyCanvas.style.display = 'block';
      flyRenderer.setSize(window.innerWidth, window.innerHeight);
    }

    // 2. 把 textGroup 移入全屏破框场景
    flyScene = flyScene || new THREE.Scene();
    flyScene.add(textGroup);
    textGroup.visible = true;
  };

  // 倒放: 碎块沿同一飞出路径反向归位。支持中途点击反向(与正放互为严格倒放),
  // 归零后由 render 内的收尾块归还主场景并淡回 2D UI。
  // 注: window._isPhotoMode(冻结运镜)不在此解冻 —— 卡片的反向展开由 photocard.js 逐帧驱动,
  // 展开走完时它才把舞台交还运镜循环, 避免运镜恢复后抢占舞台 transform
  window.triggerTitleFlyBack = function () {
    if (!window._isFlyingOut || window._isFlyingBack) return;
    window._isFlyingBack = true;
    if (flyCanvas) flyCanvas.style.display = 'block';
    textGroup.visible = true;
  };

  function _onPointerMove(e) {
    _pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    _pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    _hasPointer = true;
  }
  window.addEventListener('pointermove', _onPointerMove);
  window.addEventListener('pointerdown', _onPointerMove);
  document.addEventListener('mouseleave', function () { _hasPointer = false; });
  window.addEventListener('blur', function () { _hasPointer = false; });

  // ===== 首页循环统一闸门 =====
  // wiki 运镜跑完、卡片与地面都已撤退后, 由 wikimodel.js 调 pause() 把首页这套每帧循环
  // (tyndall 体积光/雪、snow、turntable)整体停机 —— 不再调度下一帧, 不占 CPU/GPU。
  // 卡片拉远(屏幕占比变小)时还可以先调 setScale() 降各画布的渲染分辨率, 进一步省开销;
  // 重播/拖进度条/调起始帧把世界恢复时, resetFocusClear 调 setScale(1)+resume() 重新起跑。
  window.HomeGate = (function () {
    var paused = false
    var scale = 1    // 渲染分辨率倍数(1 = 全质量)
    var starters = [] // 各循环"重新挂上 rAF"的启动函数
    var scalers = []  // 各模块"按倍数重建画布/渲染目标"的函数
    return {
      isPaused: function () { return paused },
      getScale: function () { return scale },
      add: function (start, applyScale) {
        if (start) starters.push(start)
        if (applyScale) { scalers.push(applyScale); if (scale !== 1) applyScale(scale) } // 注册即对齐当前倍数
      },
      pause: function () { paused = true },
      resume: function () {
        if (!paused) return
        paused = false
        for (var i = 0; i < starters.length; i++) starters[i]()
      },
      setScale: function (s) {
        if (s === scale) return
        scale = s
        for (var i = 0; i < scalers.length; i++) scalers[i](scale)
      }
    }
  })()

  function render() {
    if (window.HomeGate.isPaused()) return // 已停机: 直接返回, 不再调度下一帧
    var time = clock.getElapsedTime();

    var _now = PROFILE ? performance.now() : 0
    if (PROFILE) { if (profLast) profFrames.push(_now - profLast); profLast = _now }

    // 更新光源位置(复用临时向量)
    var lx = parseFloat(pLx.value);
    var ly = parseFloat(pLy.value);
    var lz = parseFloat(pLz.value);
    _tmpLight.set(lx, ly, lz);
    var lightPos = _tmpLight;

    // 获取装配进度（自动播放时单向推进到 1.0 后停住，否则跟随滑块）
    var globalT = 0;
    if (pAutoplay && pAutoplay.checked) {
      globalT = Math.min(time * 0.25, 1.0);
      if (pProgress) pProgress.value = globalT;
    } else if (pProgress) {
      globalT = parseFloat(pProgress.value);
    }
    if (vProgress) vProgress.textContent = globalT.toFixed(2);

    // Skip: 点击后直接拉满进度, 下一帧进入 UI 出现态
    if (_skipToEnd) { globalT = 1.0; if (pProgress) pProgress.value = '1.00'; }

    // Skip 按钮淡入/淡出: 仅开场期间(globalT<1 且 UI 未显示)出现, 点击后直接跳进度
    if (skipBtn) {
      var shouldShow = globalT < 1.0 && _uiShownTarget < 1.0;
      skipBtn.style.opacity = shouldShow ? '1' : '0';
      skipBtn.style.pointerEvents = shouldShow ? 'auto' : 'none';
    }

    // 开场遮幅滑出: 装配进度到阈值后黑条撤出(点 Skip 会拉满 globalT, 自动同帧生效)
    if (!_introLbGone && globalT >= INTRO_LB_OUT_AT) retractIntroBars();

    // UI 出现状态指数平滑(~0.5s): 同时驱动上方暗角减弱与 3D 文字压扁(必须在 Pass1 渲染前算好)
    var _uiDt = Math.min(Math.max(time - _uiShownPrevT, 0.0), 0.05);
    _uiShownPrevT = time;
    _uiShownCur += (_uiShownTarget - _uiShownCur) * Math.min(1.0, _uiDt * 4.0);

    textGroup.position.copy(_textFinal);
    // UI 显示后沿 group 局部 Y 轴压扁(先试 Y 轴), 与 UI 淡入同一条平滑曲线
    textGroup.scale.y = 1.0 + (TITLE_SQUASH_RATIO - 1.0) * _uiShownCur;
    textGroup.updateMatrixWorld();

    // 动画完全结束后碎块收敛到槽位(settleFade=0, blend=1)。
    // 装配完成后进入"弹簧 + 微动"分支: 碎块基座留在槽位, 鼠标附近的碎块被弹簧力推开并弹性回弹,
    // 同时所有碎块带极轻微的移动/转动(每碎块独立相位), 让静止的文字有呼吸感。
    var settled = globalT >= 1.0;
    var scatterActive = settled && _projReady && _hasPointer;
    // 【飞向镜头状态】阶段: 碎块沿飞出路径从左到右依次开飞, 破框飞出相纸
    if (window._isFlyingOut) {
      var _dt = Math.min(Math.max(time - _dtPrev, 0.0), 0.033);
      _dtPrev = time;
      // 飞出总进程: 正放 0→1, 倒放 1→0(同一速率推进, 与正放严格互为倒放)
      var _flyDir = window._isFlyingBack ? -1.0 : 1.0;
      window._flyProgress = THREE.MathUtils.clamp((window._flyProgress || 0.0) + _dt * 0.75 * _flyDir, 0.0, 1.0);
      var p = window._flyProgress;

      // 压扁还原: 正放用计时器渐入(避免起飞瞬间 24 倍竖直硬弹); 倒放直接由 p 镜像回压扁,
      // 两条曲线在任意 p 处取值相同 → 途中反向也不跳变
      var _sqEase;
      if (window._isFlyingBack) {
        _sqEase = THREE.MathUtils.smoothstep(p, 0.0, 0.6);
      } else {
        if (_flyUnSquashPrevT < 0.0) _flyUnSquashPrevT = time;
        var _sqDt = Math.min(Math.max(time - _flyUnSquashPrevT, 0.0), 0.05);
        _flyUnSquashPrevT = time;
        _flyUnSquash = Math.min(1.0, _flyUnSquash + _sqDt / FLY_UNSQUASH_DURATION);
        // smoothstep 两端斜率为 0: 渐入(静止起步) + 渐出(平滑收尾), 无突跳
        _sqEase = THREE.MathUtils.smoothstep(_flyUnSquash, 0.0, 1.0);
      }

      textGroup.position.copy(_textFinal);
      // 起点保留 _uiShownCur(与起飞前的压扁比例无缝衔接), 再按渐入进度还原到 1.0
      textGroup.scale.set(1.0, 1.0 + (TITLE_SQUASH_RATIO - 1.0) * _uiShownCur * (1.0 - _sqEase), 1.0);
      textGroup.updateMatrixWorld();

      // 预计算视觉从左到右投影范围
      if (isNaN(_flyMinX) && chunks.length) {
        var mn = Infinity, mx = -Infinity;
        for (var k = 0; k < chunks.length; k++) {
          var cx = (chunks[k]._sx !== undefined) ? chunks[k]._sx : chunks[k].originPos.x;
          if (cx < mn) mn = cx;
          if (cx > mx) mx = cx;
        }
        _flyMinX = mn; _flyMaxX = mx;
      }
      var rangeX = (_flyMaxX - _flyMinX) || 1.0;

      flyOutCurveRight.getPointAt(0.0, _tmpCamPoint);

      for (var i = 0; i < chunks.length; i++) {
        var item = chunks[i];

        // 严格从视觉最左到最右依次起飞
        var curX = (item._sx !== undefined) ? item._sx : item.originPos.x;
        var normX = THREE.MathUtils.clamp((curX - _flyMinX) / rangeX, 0.0, 1.0);

        // 前 38% 的时间分配为多米诺波浪起飞
        var delay = normX * 0.38;
        var lp = Math.max(0.0, Math.min((p - delay) / (1.0 - 0.38), 1.0));

        if (lp <= 0.0) {
          // 未起飞时：固定在初始槽位不动
          item.mesh.position.copy(item.originPos);
          item.mesh.rotation.set(0, 0, 0);
        } else {
          // 缓动加速飞行
          var easeLp = Math.pow(lp, 1.6);

          // 计算曲线位移增量
          flyOutCurveRight.getPointAt(easeLp, _tmpCurve);
          _tmpCurve.sub(_tmpCamPoint);

          // 各碎块随速度向自身法向散开
          _tmpCurve.addScaledVector(item.dir, easeLp * 2.8);

          // 世界位移转局部坐标 (复用 _invQuat, 不受父级旋转干扰)
          _tmpCurve.applyQuaternion(_invQuat);
          item.mesh.position.copy(item.originPos).add(_tmpCurve);

          // ★ 核心：剧烈多轴翻滚自旋动力学 ★
          // 随速度提升角速度剧增, 每片碎石按独立相位与随机 spinSpeed 极速旋转翻飞
          var spinPower = easeLp * 7.0 + lp * lp * 10.0;
          item.mesh.rotation.x = item.spinSpeed.x * spinPower;
          item.mesh.rotation.y = item.spinSpeed.y * spinPower;
          item.mesh.rotation.z = item.spinSpeed.z * spinPower;
        }
      }

      // 独立全屏 Overlay 画布执行渲染
      if (flyRenderer && flyScene) {
        flyScene.overrideMaterial = flyMat;
        flyRenderer.render(flyScene, camera);
        flyScene.overrideMaterial = null;
      }

      if (window._isFlyingBack) {
        if (p <= 0.0) {
          // 倒放完毕: 碎块已精确归位 → 把 textGroup 归还主场景(否则着色/阴影 Pass 看不到标题),
          // overlay 只隐藏不销毁(下次进入可复用), 并淡回 2D UI
          flyScene.remove(textGroup);
          modelScene.add(textGroup);
          textGroup.visible = true;
          textGroup.scale.set(1.0, 1.0 + (TITLE_SQUASH_RATIO - 1.0) * _uiShownCur, 1.0);
          if (flyCanvas) flyCanvas.style.display = 'none';

          window._isFlyingOut = false;
          window._isFlyingBack = false;
          window._flyProgress = 0.0;
          _flyUnSquash = 0.0; _flyUnSquashPrevT = -1.0;
          _settleStartTime = -1; // 微颤淡入重新起效: 落地从静止平滑过渡, 而非从半幅微动跳入

          for (var ri = 0; ri < chunks.length; ri++) {
            var rc = chunks[ri];
            rc._ox = rc._oy = rc._oz = 0;
            rc._vx = rc._vy = rc._vz = 0;
            rc.mesh.rotation.set(0, 0, 0);
          }

          if (window.RpgMenu) window.RpgMenu.show();
          if (window.RpgFooter) window.RpgFooter.show();
          if (window.TurntableUI) window.TurntableUI.show();
        }
      } else if (p >= 1.0 && flyCanvas) {
        // 飞出完成后彻底隐藏
        flyCanvas.style.display = 'none';
        textGroup.visible = false;
      }
    } else if (settled) {
      var _W = window.innerWidth, _H = window.innerHeight;
      var _pPx = (_pointer.x * 0.5 + 0.5) * _W;
      var _pPy = (0.5 - _pointer.y * 0.5) * _H;
      var _dt = Math.min(Math.max(time - _dtPrev, 0.0), 0.033); // 帧步长(封顶防大跳)
      _dtPrev = time;
      // 装配完成瞬间碎块是静止的(blend=1, settleFade=0), 微颤若立刻全幅出现会"瞬变";
      // 这里让微颤幅度在 IDLE_FADE 秒内 0->1 平滑淡入, 从静止无缝丝滑过渡到微微颤动。
      if (_settleStartTime < 0) _settleStartTime = time;
      var idleRamp = THREE.MathUtils.smoothstep(time - _settleStartTime, 0.0, IDLE_FADE);
      if (scatterActive) {
        // 相机右轴/上轴转到 textGroup 局部空间(相机与文字静止, 每帧算一次即可)
        _camRight.setFromMatrixColumn(camera.matrixWorld, 0);
        _camUp.setFromMatrixColumn(camera.matrixWorld, 1);
        _tmpCR.copy(_camRight).applyQuaternion(_invQuat);
        _tmpCU.copy(_camUp).applyQuaternion(_invQuat);
      }
      for (var i = 0; i < chunks.length; i++) {
        var item = chunks[i];

        // 1. 目标偏移(局部空间): 鼠标附近的碎块向外推开, 其余目标为 0
        var tx = 0.0, ty = 0.0, tz = 0.0;
        if (scatterActive) {
          var dxp = item._sx - _pPx;
          var dyp = item._sy - _pPy;
          var d2 = dxp * dxp + dyp * dyp;
          if (d2 < _pushR2) {
            var dist = Math.sqrt(d2);
            var inf = 1.0 - dist / _pushR;          // 0..1, 越靠近鼠标越强
            inf = inf * inf * (3.0 - 2.0 * inf);    // smoothstep 平滑边缘
            var inv = 1.0 / (dist + 1e-4);
            // 屏幕方向(右=+x, 上=-像素y) -> 局部方向, 再乘以强度外推
            _tmpDir.set(0, 0, 0)
              .addScaledVector(_tmpCR, dxp * inv)
              .addScaledVector(_tmpCU, -dyp * inv)
              .multiplyScalar(inf * _pushMax);
            tx = _tmpDir.x; ty = _tmpDir.y; tz = _tmpDir.z;
          }
        }

        // 2. 弹簧积分(半隐式欧拉): 目标突变/回零都会过冲并弹性回弹
        var ax = (tx - item._ox) * SPRING_K - item._vx * SPRING_DAMP;
        var ay = (ty - item._oy) * SPRING_K - item._vy * SPRING_DAMP;
        var az = (tz - item._oz) * SPRING_K - item._vz * SPRING_DAMP;
        item._vx += ax * _dt; item._vy += ay * _dt; item._vz += az * _dt;
        item._ox += item._vx * _dt; item._oy += item._vy * _dt; item._oz += item._vz * _dt;

        // 3. 静止微动: 每碎块独立相位/频率的极小位移(乘以淡入系数, 装配完成时从 0 平滑升起)
        var wob = IDLE_AMP * idleRamp * Math.sin(time * item._fr + item._ph);
        var wob2 = IDLE_AMP * idleRamp * Math.cos(time * item._fr * 0.9 + item._ph);

        item.mesh.position.set(
          item.originPos.x + item._ox + wob,
          item.originPos.y + item._oy + wob2,
          item.originPos.z + item._oz
        );
        // 4. 转动: 位移耦合(散开自然翻转, 随弹簧回正) + 微动微转
        item.mesh.rotation.set(
          item._oy * ROT_COUPLE + wob2 * IDLE_ROT,
          item._ox * ROT_COUPLE,
          item._oz * ROT_COUPLE + wob * IDLE_ROT
        );
      }

      // 首次装配完成后, 预计算每个碎块的"视觉中心"屏幕像素坐标(只算一次, 交互时零投影开销)
      if (!_projReady && chunks.length) {
        textGroup.updateMatrixWorld(true);
        camera.updateMatrixWorld(); // 保证 project() 用的 matrixWorldInverse 最新
        // 世界方向 -> 父节点局部方向的逆旋转(碎块父节点相同, 取第一个即可)
        var _parent = chunks[0].mesh.parent;
        _parent.matrixWorld.decompose(_tmpPr, _invQuat, _tmpSc);
        _invQuat.invert();
        for (var pi = 0; pi < chunks.length; pi++) {
          var pc = chunks[pi];
          // 用世界包围盒中心而非 mesh 原点: 避免碎块几何不以原点为中心时中心偏移
          _tmpBox.setFromObject(pc.mesh);
          _tmpBox.getCenter(_tmpWorld);
          _tmpWorld.project(camera);
          pc._sx = (_tmpWorld.x * 0.5 + 0.5) * _W;
          pc._sy = (0.5 - _tmpWorld.y * 0.5) * _H;
        }
        _projReady = true;
        // 标题碎块就位后, 把 2D 菜单锚到标题真实屏幕包围盒下方并淡入
        if (!_rpgMenuPlaced) {
          updateRpgMenuPos();
          _rpgMenuPlaced = true;
        }
        if (window.RpgMenu) window.RpgMenu.show();
        if (window.RpgFooter) window.RpgFooter.show();
        if (window.TurntableUI) window.TurntableUI.show();
      } else if (!chunks.length && !_rpgMenuPlaced) {
        // 模型加载失败时的回退: 用路径终点投影定位, 菜单仍可显示
        updateRpgMenuPos();
        _rpgMenuPlaced = true;
        if (window.RpgMenu) window.RpgMenu.show();
        if (window.RpgFooter) window.RpgFooter.show();
        if (window.TurntableUI) window.TurntableUI.show();
      }
      // UI 出现瞬间: 光斑滤镜来一次 0→1→0 的闪动(只动滤镜强度, 不加模糊; 单次, 见 _glowFlashFired)
      if (!_glowFlashFired && window.GlowFilter) { _glowFlashFired = true; window.GlowFilter.flash(); }
      _uiShownTarget = 1.0;
    } else {
      _settleStartTime = -1; // 未在装配完成态: 重置淡入计时, 下次装配完成时重新平滑淡入微颤
      if (window.RpgMenu) window.RpgMenu.hide(); // 回退进度时菜单随之隐藏
      if (window.RpgFooter) window.RpgFooter.hide();
      if (window.TurntableUI) window.TurntableUI.hide();
      _uiShownTarget = 0.0;
      for (var i = 0; i < chunks.length; i++) {
        var item = chunks[i];

        var pT = (globalT - item.delay) / (1.0 - 0.12);
        pT = THREE.MathUtils.clamp(pT, 0.0, 1.0);

        // 【修改 2】：主干前进量改用线性贯穿（不要 smoothstep）！
        // 飞到 P3 时保持全速呼啸穿过，绝不在倒数第二点刹车发呆
        var travel = Math.min(1.0, pT / TIME_SPLIT);
        curve.getPointAt(travel * SPLIT_T, _tmpCurve); // 复用目标对象, 不分配

        // ==============================================================
        // 核心升级：物理弹簧渐进振子（Damped Spring Elastic Overshoot）
        // ==============================================================
        var assembleFactor = Math.max(0.0, (pT - TIME_SPLIT) / (1.0 - TIME_SPLIT));

        // 1. 弹簧动力学计算：
        // - decay (衰减): SPRING_DECAY 控制石块碰撞后能量吸收速度(越小越弹/拖尾越长)
        // - spring (简谐振荡): SPRING_FREQ*PI 控制弹跳次数(越大回弹越多次)
        var decay = Math.exp(-assembleFactor * SPRING_DECAY);
        var spring = Math.cos(assembleFactor * Math.PI * SPRING_FREQ);

        // (1.0 - assembleFactor) 保证在 assembleFactor = 1.0 时精确收敛归零，绝不漂移
        // 该形状在 a=0 时刻恰好 blend=0(与飞入段无缝衔接), 全程自动收敛到 1
        var blend = 1.0 - spring * decay * (1.0 - assembleFactor);

        // 2. 扰动与自旋在入槽时顺滑衰减
        var settleFade = Math.pow(Math.max(0.0, 1.0 - assembleFactor), SETTLE_POW);
        var angle = time * item.swirlFreq + i;
        var swirlScale = item.swirlRadius * settleFade;
        _tmpSwirl.set(Math.cos(angle) * swirlScale, Math.sin(angle) * swirlScale, 0);

        // 3. 碎块位置：利用 blend > 1.0 的超调量，自然沿飞入动量方向冲过头并回弹
        _tmpCurve.add(_tmpSwirl);
        textGroup.worldToLocal(_tmpCurve);
        _tmpCurve.lerp(item.originPos, blend);
        item.mesh.position.copy(_tmpCurve);

        // 4. 旋转角随撞击归零：撞入字模后自旋立即被锁死吸收
        item.mesh.rotation.x = time * item.spinSpeed.x * settleFade;
        item.mesh.rotation.y = (time * time * 0.1 + item.spinSpeed.y) * settleFade;
        item.mesh.rotation.z = time * item.spinSpeed.z * settleFade;
      }
    }

    // 设置光源相机，并计算透视矩阵
    lightCam.position.copy(lightPos);
    lightCam.lookAt(textGroup.position);
    lightCam.updateMatrixWorld();
    lightCam.updateProjectionMatrix();

    _tmpLightMatrix.multiplyMatrices(lightCam.projectionMatrix, lightCam.matrixWorldInverse);
    var lightMatrix = _tmpLightMatrix;

    var _mark = PROFILE ? performance.now() : 0

    // Pass 1-A: 渲染光源阴影贴图
    modelScene.overrideMaterial = shadowDepthMat;
    renderer.setRenderTarget(modelShadowTarget);
    // 阴影图空白纹素必须清成 1.0(远平面=无遮挡)。Three 默认清黑(0), 而 shader 判定为
    // lUV.z > shadowDepth+0.002 即被挡 → 空白=0 会把光锥内所有空气/山石点误判成"被挡住",
    // 这正是 debug7"除字全黑"、山前丁达尔光全灭的根因(字的表面点与自身深度相等才幸免)。
    renderer.setClearColor(0xffffff, 1);
    renderer.clear();
    renderer.render(modelScene, lightCam);
    var _a = PROFILE ? performance.now() : 0
    if (PROFILE && profProbe) { gl.finish(); profGpuA.push(performance.now() - _a) }

    // Pass 1-B: 渲染相机视角模型深度与外观
    modelScene.overrideMaterial = modelMat;
    // 模型打光强度: UI 出现前 1/3, 出现后随 _uiShownCur 过渡到 1.0
    modelMat.uniforms.u_lightStrength.value = (1.0 / 3.0) + (1.0 - 1.0 / 3.0) * _uiShownCur;
    renderer.setRenderTarget(modelColorDepthTarget);
    // 模型 G-Buffer 空白处须 alpha=0(表示该像素无模型, shader 用 modelZ>0.1 判空)
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(modelScene, camera);
    var _b = PROFILE ? performance.now() : 0
    if (PROFILE && profProbe) { gl.finish(); profGpuB.push(performance.now() - _b) }

    modelScene.overrideMaterial = null;

    // Pass 2: 全屏体积光混合运算
    renderer.setRenderTarget(null);
    // _uiShownCur 已在动画段提前平滑计算(供文字压扁使用), 这里仅写入 uniform
    tyndallMat.uniforms.u_uiShown.value = _uiShownCur;
    tyndallMat.uniforms.u_time.value = time;
    // 双壁纸轮播: 由页面累计时间直接求混合系数(每次刷新 t 从 0 起 ⇒ 必从第一张开始)
    tyndallMat.uniforms.u_wallMix.value = wallMixAt(time);
    tyndallMat.uniforms.u_debugMode.value = parseInt(pMode.value, 10);
    tyndallMat.uniforms.u_lightPos.value.copy(lightPos);
    // 丁达尔光强: UI 出现前为 0, UI 出现后随 _uiShownCur 平滑过渡到面板设定值
    tyndallMat.uniforms.u_intensity.value = parseFloat(pInt.value) * _uiShownCur;
    tyndallMat.uniforms.u_rangeFalloff.value = parseFloat(pRange.value);
    tyndallMat.uniforms.u_noiseIntens.value = parseFloat(pNoise.value);
    tyndallMat.uniforms.u_beamScale.value = parseFloat(pScale.value);
    tyndallMat.uniforms.u_lightMatrix.value.copy(lightMatrix);

    // ===== 广角拉箱动态计算 (与寻焦抽搐同频脉冲) =====
    var lensDistort = 0.0;
    var lensChroma = 0.0;

    if (globalT < 0.40) {
      // 阶段 1：起飞入场，广角镜头迅速展开 (0.0 -> 0.28)
      var t1 = globalT / 0.40;
      lensDistort = t1 * 0.28;
    } else if (globalT < 0.62) {
      // 阶段 2：【广角拉箱狂抽】边缘随抽焦剧烈弧形膨胀收缩 (闪两下)
      var t2 = (globalT - 0.40) / 0.22;
      var decay = Math.exp(-t2 * 3.8);
      var wave = Math.sin(t2 * Math.PI * 3.5);

      // 基础广角 0.22 + 剧烈抽动峰值达到 0.55（边缘直接拉成鱼眼弧面）
      lensDistort = 0.22 + Math.abs(wave) * decay * 0.32;
      // 变焦抽动瞬间爆发边缘色散
      lensChroma = Math.abs(wave) * decay * 0.022;
    } else if (globalT < TIME_SPLIT) {
      // 阶段 3：与【镜头回正同步】把桶形畸变收回 0——提前一个节点(在 TIME_SPLIT 前)就归零,
      // 避免镜头已经拉到宽景、边缘却还带着弧形/色散, 一眼就"露馅"看出是后期变形。
      var t3 = (globalT - 0.62) / (TIME_SPLIT - 0.62);
      var ease3 = THREE.MathUtils.smoothstep(t3, 0.0, 1.0);
      lensDistort = THREE.MathUtils.lerp(0.22, 0.0, ease3);
      lensChroma = 0.0;
    } else {
      // 阶段 4：全景平直大景深, 畸变完全归零
      lensDistort = 0.0;
      lensChroma = 0.0;
    }

    // 赋值给 Shader
    tyndallMat.uniforms.u_lensDistortion.value = lensDistort;
    tyndallMat.uniforms.u_lensChroma.value = lensChroma;
    // 畸变跟随特写: 使用上一帧 updateCinematicEffect 缓存的中心/强度,
    // 使球弧圆心与 CSS 特写放大圆心重合, 特写局部即可看到清晰的桶形弯曲。
    tyndallMat.uniforms.u_cineCenter.value.set(_cineCenterU, _cineCenterV);
    tyndallMat.uniforms.u_cineScale.value = _cineScale;

    renderer.setRenderTarget(sceneTarget);
    renderer.render(postScene, postCam);
    renderer.setRenderTarget(null);
    // 光斑滤镜(glowfilter): 开场期链在色散通道之后 —— 色散输出落 GlowFilter 后备纹理,
    // 光斑滤镜读它做 Log-Exp 散景并混出到屏幕; 停用后整条 pass 摘除, 恢复 色散->屏幕 直出
    var _glowOn = !!(window.GlowFilter && window.GlowFilter.active());
    if (window.CursorFilter) {
      var _glowRT = _glowOn ? window.GlowFilter.target() : null;
      window.CursorFilter.render(renderer, sceneTarget.texture, _glowRT);
      if (_glowOn) window.GlowFilter.render(renderer, _glowRT.texture);
    }
    var _c = PROFILE ? performance.now() : 0
    if (PROFILE) {
      if (profProbe) {
        gl.finish(); profGpuC.push(performance.now() - _c); profProbe = false
      } else {
        profA.push(_a - _mark); profB.push(_b - _a); profC.push(_c - _b)
      }
      if (_now - profLastFlush >= PROFILE_EVERY) { tyndallFlush(); profLastFlush = _now }
    }

    // Pass 3: 编辑器叠加层（曲线/锚点/拖拽手柄），仅调试模式显示。
    // 必须 autoClear=false + clearDepth：否则会被全屏 quad 写入的深度剔除。
    if (SHOW_DEBUG_PANEL) {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(editorScene, camera);
      renderer.autoClear = true;
    }

    // 电影运镜：追踪点复用碎块【同一套映射】(travel * SPLIT_T),
    // 否则镜头用 curve.getPointAt(globalT) 的均匀进度会永远追不上碎块。
    // 分界点也改用 TIME_SPLIT, 与碎块动力学同步。
    var camTravel = THREE.MathUtils.smoothstep(globalT, 0.0, TIME_SPLIT);
    curve.getPointAt(camTravel * SPLIT_T, _tmpCamPoint); // 复用目标对象, 不分配
    // 回正时不能硬切到 textGroup: 曲线点(P3)与文字目标(P4)不是同一位置,
    // 直接切换会让焦点投影瞬移. 用 smoothstep 把追踪点从 P3 平滑过渡到 P4。
    // 过渡在【倒数第二个点】(globalT=TIME_SPLIT)前就完成(0.62→TIME_SPLIT), 与镜头回正窗口对齐。
    var pullbackBlend = THREE.MathUtils.smoothstep(globalT, 0.62, TIME_SPLIT);
    _tmpCamPoint.lerp(textGroup.position, pullbackBlend);
    // 传入 time 驱动高频呼吸与手持微颤
    updateCinematicEffect(globalT, _tmpCamPoint, time);

    requestAnimationFrame(render);
  }
  window.HomeGate.add(function () { requestAnimationFrame(render) }, homeScaleSet) // 供 resume() 起跑 / setScale() 降分辨率
  requestAnimationFrame(render);
})();