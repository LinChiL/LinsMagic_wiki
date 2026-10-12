// _hexbokeh_check.js - glowfilter.js(六边形电影散景版)纯 Node 数学校验(无浏览器, 无 GPU)
// 目的: shader 三个 pass 是示例逐字移植, 风险在"数学结构是否忠实" —— 用 fp64 理想化仿真验证:
//   ① Pass2 跳跃倍增前缀和(完整模拟示例: ceil(log2(W)) 步, prevX>=0 才加) == 直接前缀和
//      宽度覆盖 2 的幂 / 非 2 的幂(960, 1081, 1920 等实际用到的)
//   ② ACES 往返: ACESFitted(InvACESFitted(x)) ≈ x (涵盖 mat3 inverse 与巨大常数的有理逆拟合)
//   ③ 六边形权重公式: 顶点/平边/面积(正六边形 2.598 Ry²)/连续性
//   ④ 全管线(反ACES -> SAT -> 六边形解调)仿真: 均匀图内部恒定、冲激图对称(镜像轴=纹素边界!)
//      支撑外=纯背景常数、全程无 NaN
//   ⑤ 自动呼吸半径 Ry ∈ [3, 55]
'use strict';

var fails = 0, checks = 0;
function ok(name, cond, info) {
  checks++;
  if (cond) console.log('  [PASS] ' + name + (info !== undefined ? '  (' + info + ')' : ''));
  else { fails++; console.log('  [FAIL] ' + name + (info !== undefined ? '  (' + info + ')' : '')); }
}
function relDiff(a, b) { return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-12); }

// ============================================================
console.log('① Pass2 跳跃倍增前缀和 == 直接前缀和');
// ============================================================
function scanGPU(row) { // 逐字模拟 fs-sat: 每步 val = src[i] + (i-step>=0 ? src[i-step] : 0), 双缓冲
  var W = row.length;
  var steps = Math.ceil(Math.log2(Math.max(W, 1)));
  var y = row.slice();
  for (var k = 0; k < steps; k++) {
    var s = 1 << k, out = new Array(W);
    for (var i = 0; i < W; i++) {
      out[i] = y[i] + (i - s >= 0 ? y[i - s] : 0);
    }
    y = out;
  }
  return y;
}
function scanDirect(row) {
  var acc = 0;
  return row.map(function (v) { return acc += v; });
}
[1, 2, 3, 127, 960, 961, 1081, 1920, 2048].forEach(function (W) {
  var row = [];
  for (var i = 0; i < W; i++) row.push(Math.random() * 6.0 - 0.5);
  var a = scanGPU(row), b = scanDirect(row);
  var maxErr = 0;
  for (var i = 0; i < W; i++) maxErr = Math.max(maxErr, Math.abs(a[i] - b[i]));
  ok('W=' + W + ' (steps=' + Math.ceil(Math.log2(W)) + ')', maxErr < 1e-9, 'maxErr=' + maxErr.toExponential(2));
});

// ============================================================
console.log('② ACES 往返 (InvACESFitted -> ACESFitted)');
// ============================================================
var ACESInputMat = [ // GLSL 字面量顺序 = 列主序
  0.59719, 0.35458, 0.04823,
  0.07600, 0.90834, 0.01566,
  0.02840, 0.13383, 0.83777
];
var ACESOutputMat = [
   1.60475, -0.53108, -0.07367,
  -0.10208,  1.10813, -0.00605,
  -0.00327, -0.07276,  1.07602
];
function vmul(v, m) { // GLSL: out[j] = dot(v, 第j列)
  return [
    v[0] * m[0] + v[1] * m[1] + v[2] * m[2],
    v[0] * m[3] + v[1] * m[4] + v[2] * m[5],
    v[0] * m[6] + v[1] * m[7] + v[2] * m[8]
  ];
}
function inv3(m) { // GLSL inverse() 等价: 输入/输出均为列主序(伴随矩阵转置 / det)
  function el(r, c) { return m[c * 3 + r]; }
  function subDet(r, c) { // 删去第 r 行第 c 列后 2x2 子阵行列式(子阵保持原有行/列相对顺序)
    var ri = [0, 1, 2].filter(function (i) { return i !== r; });
    var ci = [0, 1, 2].filter(function (i) { return i !== c; });
    return el(ri[0], ci[0]) * el(ri[1], ci[1]) - el(ri[0], ci[1]) * el(ri[1], ci[0]);
  }
  function cof(r, c) { return ((r + c) % 2 === 0 ? 1 : -1) * subDet(r, c); }
  var det = el(0, 0) * cof(0, 0) + el(0, 1) * cof(0, 1) + el(0, 2) * cof(0, 2);
  var out = new Array(9);
  for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) out[c * 3 + r] = cof(c, r) / det; // adj = cofᵀ
  return out;
}
var invIn = inv3(ACESInputMat), invOut = inv3(ACESOutputMat);
function RRT(v) {
  var a = v * (v + 0.0245786) - 0.000090537;
  var b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
function invRRT(x) {
  return -1.0 / 100.0 * (21647550.0 * x + Math.sqrt(-1873455419487500.0 * x * x + 2326712714032270.0 * x + 2415638944900.0) - 1228930.0) / (983729.0 * x - 1000000.0);
}
function InvACESFitted(c) {
  var t = vmul(c, invOut); t = [invRRT(t[0]), invRRT(t[1]), invRRT(t[2])];
  return vmul(t, invIn);
}
function ACESFitted(c) {
  var t = vmul(c, ACESInputMat); t = [RRT(t[0]), RRT(t[1]), RRT(t[2])];
  t = vmul(t, ACESOutputMat);
  return [Math.min(Math.max(t[0], 0), 1), Math.min(Math.max(t[1], 0), 1), Math.min(Math.max(t[2], 0), 1)];
}
(function () {
  // 矩阵逆自检: A * A⁻¹ = I (用 vmul 的转置语义: 逐列验证)
  function mulMat(m, n) { // 列主序矩阵乘: out[c*3+r] = Σk m[k*3+r]*n[c*3+k]
    var out = new Array(9);
    for (var c = 0; c < 3; c++) for (var r = 0; r < 3; r++) {
      var s = 0;
      for (var k = 0; k < 3; k++) s += m[k * 3 + r] * n[c * 3 + k];
      out[c * 3 + r] = s;
    }
    return out;
  }
  var I = mulMat(ACESInputMat, invIn);
  var err = 0;
  for (var i = 0; i < 9; i++) err = Math.max(err, Math.abs(I[i] - (i % 4 === 0 ? 1 : 0)));
  ok('mat3 inverse 正确 (A*A⁻¹=I)', err < 1e-9, 'maxErr=' + err.toExponential(2));
})();
(function () {
  var maxErr = 0, argmax = 0;
  for (var v = 0.001; v <= 1.0001; v += 0.001) {
    var rt = ACESFitted(InvACESFitted([v, v, v]));
    var e = Math.abs(rt[0] - v);
    if (e > maxErr) { maxErr = e; argmax = v; }
  }
  ok('ACES 往返 [0,1]', maxErr < 0.02, 'maxErr=' + maxErr.toFixed(5) + ' @ ' + argmax.toFixed(3));
})();
(function () {
  // 全管线显示空间往返(曝光=1): pow(ACESFitted(InvACESFitted(pow(v,2.2))), 1/2.2) ≈ v
  var maxErr = 0;
  for (var v = 0.001; v <= 1.0001; v += 0.001) {
    var x = Math.pow(v, 2.2);
    var rt = ACESFitted(InvACESFitted([x, x, x]));
    var back = Math.pow(rt[0], 1.0 / 2.2);
    maxErr = Math.max(maxErr, Math.abs(back - v));
  }
  ok('显示空间全往返(曝光 1)', maxErr < 0.05, 'maxErr=' + maxErr.toFixed(5));
})();
(function () {
  // 巨大常数有理式在输入域 [0,1] 全程无 NaN (sqrt 参数 / 分母)
  var bad = 0, denomMin = 1e9;
  for (var v = 0; v <= 1.00001; v += 0.0001) {
    var x = Math.min(v, 1.0);
    var disc = -1873455419487500.0 * x * x + 2326712714032270.0 * x + 2415638944900.0;
    if (disc < 0) bad++;
    denomMin = Math.min(denomMin, Math.abs(983729.0 * x - 1000000.0));
    var r = invRRT(x);
    if (!isFinite(r)) bad++;
  }
  ok('InvRRT 域检查 [0,1]', bad === 0, 'min|denom|=' + denomMin.toFixed(0));
})();

// ============================================================
console.log('③ 六边形权重公式');
// ============================================================
function hexW(fi, Ry) { return 0.866025 * Math.min(1.0, (1.0 - Math.abs(fi / Ry)) / 0.5) * Ry; }
(function () {
  var Ry = 16.0;
  ok('中心行半宽 = 0.866*Ry', Math.abs(hexW(0, Ry) - 0.866025 * Ry) < 1e-9);
  ok('平边端点 |fi|=Ry/2 与中心等宽(连续)', Math.abs(hexW(Ry / 2, Ry) - hexW(0, Ry)) < 1e-9);
  ok('顶点 |fi|=Ry 宽度归零', Math.abs(hexW(Ry, Ry)) < 1e-9);
  // 平边段恒定 / 斜面段线性递减
  var flat = true, lin = true;
  for (var fi = 0; fi <= Ry / 2 + 0.001; fi += 0.25) if (Math.abs(hexW(fi, Ry) - 0.866025 * Ry) > 1e-9) flat = false;
  for (var k = 1; k <= 7; k++) {
    var a = Ry / 2 + k * (Ry / 2) / 8, b = a + (Ry / 2) / 8;
    var slope = (hexW(a, Ry) - hexW(b, Ry)) / (b - a);
    if (Math.abs(slope - 0.866025 / 0.5) > 1e-6) lin = false;
  }
  ok('|fi|≤Ry/2 平边恒定', flat);
  ok('Ry/2→Ry 斜面斜率 = 1.732', lin);
  [12.0, 16.0, 55.0].forEach(function (Ry) {
    var IRy = Math.floor(Ry), s = 0;
    for (var i = -IRy; i <= IRy; i++) s += 2 * hexW(i, Ry);
    var area = 2.598076211 * Ry * Ry;
    ok('Ry=' + Ry + ' 离散面积≈正六边形面积', relDiff(s, area) < 0.01, 'sum=' + s.toFixed(1) + ' area=' + area.toFixed(1));
  });
  // 支撑范围: |fi|>Ry 时循环不覆盖(IRy=floor(Ry) ≤ Ry)
  ok('IRy=floor(Ry) 不越出支撑', Math.floor(12.7) <= 12.7 && hexW(Math.floor(12.7), 12.7) >= 0);
})();

// ============================================================
console.log('④ 全管线仿真 (反ACES -> SAT -> 六边形解调)');
// ============================================================
var EXPOSURE = 0.75;
function sampleBilinear(T, W, H, tx, ty) { // GL 线性过滤 + CLAMP_TO_EDGE (纹素中心 i+0.5)
  var cx = tx - 0.5, cy = ty - 0.5;
  var i0 = Math.floor(cx), j0 = Math.floor(cy);
  var fx = cx - i0, fy = cy - j0;
  var i0c = Math.min(Math.max(i0, 0), W - 1), i1c = Math.min(Math.max(i0 + 1, 0), W - 1);
  var j0c = Math.min(Math.max(j0, 0), H - 1), j1c = Math.min(Math.max(j0 + 1, 0), H - 1);
  var out = [0, 0, 0];
  for (var ch = 0; ch < 3; ch++) {
    var v00 = T[j0c * W + i0c], v10 = T[j0c * W + i1c], v01 = T[j1c * W + i0c], v11 = T[j1c * W + i1c];
    out[ch] = (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
  }
  return out;
}
function buildSAT(L, W, H) { // L=Pass1 输出(已 -0.5); 逐行跑 GPU 跳跃倍增
  var SAT = new Float64Array(W * H);
  for (var y = 0; y < H; y++) {
    var row = [];
    for (var x = 0; x < W; x++) row.push(L[y * W + x]);
    var s = scanGPU(row);
    for (var x2 = 0; x2 < W; x2++) SAT[y * W + x2] = s[x2];
  }
  return SAT;
}
function pass3(SAT, W, H, px, py, Ry) { // 逐字模拟 fs-bokeh 主循环(手动半径)
  var IRy = Math.floor(Ry);
  var c = [0, 0, 0], cw = 0;
  for (var i = -IRy; i <= IRy; i++) {
    var w = hexW(i, Ry);
    var owl = Math.max(0, w - (px + 0.5)), owr = Math.max(0, (px + 0.5) - W + w);
    cw += 2 * w - owl - owr;
    var p0 = sampleBilinear(SAT, W, H, (px + 0.5) - w, (py + 0.5) + i);
    var p1 = sampleBilinear(SAT, W, H, (px + 0.5) + w, (py + 0.5) + i);
    c[0] += p1[0] - p0[0]; c[1] += p1[1] - p0[1]; c[2] += p1[2] - p0[2];
  }
  var fc = [(c[0] / Math.max(cw, 0.001) + 0.5) * EXPOSURE, (c[1] / Math.max(cw, 0.001) + 0.5) * EXPOSURE, (c[2] / Math.max(cw, 0.001) + 0.5) * EXPOSURE];
  var a = ACESFitted(fc);
  return [Math.pow(a[0], 1 / 2.2), Math.pow(a[1], 1 / 2.2), Math.pow(a[2], 1 / 2.2)];
}
var W = 160, H = 160, CX = 80, CY = 80, RY = 12.0, MARGIN = 20;
(function () {
  // --- 均匀图: 内部像素恒定, 且等于解析值 ---
  var v = 0.5;
  var Lin = InvACESFitted([Math.pow(v, 2.2), Math.pow(v, 2.2), Math.pow(v, 2.2)])[0] - 0.5;
  var L = new Float64Array(W * H).fill(Lin);
  var SAT = buildSAT(L, W, H);
  var ref = pass3(SAT, W, H, 100, 100, RY);
  // 解析值: c/cw = Lin (恒定) -> (Lin+0.5)*exp -> ACES -> ^(1/2.2)
  var a = ACESFitted([(Lin + 0.5) * EXPOSURE, (Lin + 0.5) * EXPOSURE, (Lin + 0.5) * EXPOSURE]);
  var analytic = Math.pow(a[0], 1 / 2.2);
  var maxDev = 0, nan = 0;
  for (var py = MARGIN; py < H - MARGIN; py++) for (var px = MARGIN; px < W - MARGIN; px++) {
    var o = pass3(SAT, W, H, px, py, RY);
    if (!isFinite(o[0])) { nan++; continue; }
    maxDev = Math.max(maxDev, Math.abs(o[0] - ref[0]));
  }
  ok('均匀图内部恒定(偏差<1e-9)', maxDev < 1e-9, 'maxDev=' + maxDev.toExponential(2));
  ok('均匀图 = 解析值', Math.abs(ref[0] - analytic) < 1e-9, 'out=' + ref[0].toFixed(6) + ' 解析=' + analytic.toFixed(6));
  ok('均匀图无 NaN', nan === 0);

  // --- 冲激图: 对称(镜像轴=纹素边界 cx / cy) + 支撑外纯背景 ---
  var dt = 1.0; // 输入显示空间 [0,1] 的冲激
  var bgx = Math.pow(v, 2.2), imx = Math.pow(dt, 2.2);
  var bgL = InvACESFitted([bgx, bgx, bgx])[0] - 0.5;
  var imL = InvACESFitted([imx, imx, imx])[0] - 0.5;
  var L2 = new Float64Array(W * H).fill(bgL);
  L2[CY * W + CX] = imL;
  var SAT2 = buildSAT(L2, W, H);
  var bgOut = pass3(SAT2, W, H, 100, 100, RY); // 支撑外参考(100,100 距冲激20>0.866*12+2)
  // 镜像对: 水平方向 SAT 解调有半纹素位移(镜像轴 = 纹素边界 t=80, 像素对 (80+dx <-> 79-dx));
  // 垂直方向是行间双线性混合(镜像轴 = 行中心 t=80.5, 像素对 (80+dy <-> 80-dy))
  var symErr = 0, symN = 0;
  for (var dy = -30; dy <= 30; dy++) for (var dx = -30; dx <= 30; dx++) {
    var o1 = pass3(SAT2, W, H, CX + dx, CY + dy, RY);
    var o2 = pass3(SAT2, W, H, CX - 1 - dx, CY - dy, RY);
    symErr = Math.max(symErr, Math.abs(o1[0] - o2[0]));
    symN++;
  }
  ok('冲激对称(水平轴=纹素边界/垂直轴=行中心, ' + symN + ' 对)', symErr < 1e-9, 'maxErr=' + symErr.toExponential(2));
  // 支撑外: |dx|>0.866*Ry+2 或 |dy|>Ry+2 (相对冲激) 全为纯背景
  var farErr = 0, farN = 0;
  for (var dy2 = -45; dy2 <= 46; dy2 += 3) for (var dx2 = -45; dx2 <= 46; dx2 += 3) {
    if (Math.abs(dx2) <= 0.866025 * RY + 2 && Math.abs(dy2) <= RY + 2) continue;
    var o = pass3(SAT2, W, H, CX + dx2, CY + dy2, RY);
    farErr = Math.max(farErr, Math.abs(o[0] - bgOut[0]));
    farN++;
  }
  ok('支撑外 = 纯背景 (' + farN + ' 点)', farErr < 1e-9, 'maxErr=' + farErr.toExponential(2));
  // 中心有信号: 单纹素冲激被内核扇出到 ~374px², 中心仅得小增量; 只要与背景差异显著即证明卷积发生
  var ctr = pass3(SAT2, W, H, CX, CY, RY);
  ok('中心信号显著', Math.abs(ctr[0] - bgOut[0]) > 0.001, 'Δ=' + Math.abs(ctr[0] - bgOut[0]).toFixed(4));
  // 冲激图全域无 NaN
  var nan2 = 0;
  for (var py2 = 0; py2 < H; py2 += 4) for (var px2 = 0; px2 < W; px2 += 4) {
    var o2 = pass3(SAT2, W, H, px2, py2, RY);
    if (!isFinite(o2[0]) || !isFinite(o2[1]) || !isFinite(o2[2])) nan2++;
  }
  ok('冲激图全图无 NaN', nan2 === 0);
})();

// ============================================================
console.log('⑤ 自动呼吸半径 Ry ∈ [3,55]');
// ============================================================
(function () {
  var min = 1e9, max = -1e9, nan = 0;
  var tau = 6.2831853;
  for (var t = 0; t <= 200; t += 0.005) {
    for (var rby = -1; rby <= 1; rby += 0.5) {
      var ph = Math.cos(-rby * 0.15 * tau - 0.8 + t) * 0.5 + 0.5;
      var Ry = Math.exp(Math.log(3.0) + (Math.log(55.0) - Math.log(3.0)) * ph);
      if (!isFinite(Ry)) nan++;
      if (Ry < min) min = Ry;
      if (Ry > max) max = Ry;
    }
  }
  ok('Ry 下界 ≥ 3', min >= 2.9999, 'min=' + min.toFixed(4));
  ok('Ry 上界 ≤ 55', max <= 55.0001, 'max=' + max.toFixed(4));
  ok('Ry 无 NaN', nan === 0);
  // 满呼吸(cos=±1)确实达到 3 与 55
  ok('满呼吸触达下沿 3', Math.abs(min - 3.0) < 0.02, 'min=' + min.toFixed(4));
  ok('满呼吸触达上沿 55', Math.abs(max - 55.0) < 0.5, 'max=' + max.toFixed(4));
})();

// ============================================================
console.log('\n' + (fails === 0 ? '✅ 全部通过' : '❌ 失败 ' + fails + ' 项') + ' (' + checks + ' 项检查)');
process.exit(fails === 0 ? 0 : 1);
