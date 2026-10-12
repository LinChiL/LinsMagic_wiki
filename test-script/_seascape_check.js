// 纯 Node 校验(无浏览器): 复刻 wikimodel.js 里 Seascape 移植的 GLSL 数学
// 1) 两档波高场值域/有限性  2) 法线单位长且朝上  3) 雾公式端点  4) 全管线(含 HSV)无 NaN
const fract = x => x - Math.floor(x)
const mix = (a, b, t) => a + (b - a) * t
const clamp = (x, a, b) => Math.min(b, Math.max(a, x))
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t) }
const V = {
  dot: (a, b) => a[0] * b[0] + a[1] * b[1],
  addS: (a, s) => [a[0] + s, a[1] + s],
  mulS: (a, s) => [a[0] * s, a[1] * s]
}
const V3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  addS: (a, s) => [a[0] + s, a[1] + s, a[2] + s],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mulS: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: a => Math.sqrt(V3.dot(a, a)),
  norm: a => V3.mulS(a, 1 / V3.len(a)),
  mul: (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]]
}
const reflect = (e, n) => V3.sub(e, V3.mulS(n, 2 * V3.dot(e, n)))

function hash(p) { const h = V.dot(p, [127.1, 311.7]); return fract(Math.sin(h) * 83758.5453123) }
function noise(p) {
  const i = [Math.floor(p[0]), Math.floor(p[1])]
  const f = [fract(p[0]), fract(p[1])]
  const u = [f[0] * f[0] * (3 - 2 * f[0]), f[1] * f[1] * (3 - 2 * f[1])]
  return -1 + 2 * mix(
    mix(hash([i[0], i[1]]), hash([i[0] + 1, i[1]]), u[0]),
    mix(hash([i[0], i[1] + 1]), hash([i[0] + 1, i[1] + 1]), u[0]),
    u[1])
}
function seaOctave(uv0, choppy) {
  const uv = V.addS(uv0, noise(uv0))
  let wv = [1 - Math.abs(Math.sin(uv[0])), 1 - Math.abs(Math.sin(uv[1]))]
  const swv = [Math.abs(Math.cos(uv[0])), Math.abs(Math.cos(uv[1]))]
  wv = [mix(wv[0], swv[0], wv[0]), mix(wv[1], swv[1], wv[1])]
  return Math.pow(1 - Math.pow(wv[0] * wv[1], 0.65), choppy)
}
const OCT = uv => [1.7 * uv[0] - 1.2 * uv[1], 1.2 * uv[0] + 1.4 * uv[1]] // mat2(1.7,1.2,-1.2,1.4)*uv
function seaHeight(base, t, uHeight, iter, doubling, octDivide) {
  let freq = 0.24, amp = uHeight, choppy = 3.0
  let uv = [base[0] * 0.75, base[1]]
  let h = 0
  for (let i = 0; i < iter; i++) {
    let d = seaOctave(V.mulS(V.addS(uv, t), freq), choppy)
    if (doubling) d += seaOctave(V.mulS(V.addS(uv, -t), freq), choppy)
    h += d * amp
    uv = octDivide ? V.mulS(OCT(uv), 1 / 1.2) : OCT(uv)
    freq *= 1.9; amp *= 0.22; choppy = mix(choppy, 1.0, 0.2)
  }
  return h
}
const hGeo = (b, t, uH) => seaHeight(b, t, uH, 2, false, false)
const hDetail = (b, t, uH) => seaHeight(b, t, uH, 5, true, true)

// 精确移植: 原版 rgb2hsv / hsv2rgb
function r2h(c) {
  const K = [0, -1 / 3, 2 / 3, -1]
  const t1 = c[1] < c[2] ? 0 : 1 // step(c.b, c.g)
  const p = [0, 1, 2, 3].map(i => {
    const a = [c[2], c[1], K[3], K[2]]   // vec4(c.bg, K.wz)
    const b = [c[1], c[2], K[0], K[1]]   // vec4(c.gb, K.xy)
    return mix(a[i], b[i], t1)
  })
  const t2 = c[0] < p[0] ? 0 : 1 // step(p.x, c.r)
  const q = [0, 1, 2, 3].map(i => {
    const a = [p[0], p[1], p[3], c[0]]   // vec4(p.xyw, c.r)
    const b = [c[0], p[1], p[2], p[0]]   // vec4(c.r, p.yzx)
    return mix(a[i], b[i], t2)
  })
  const d = q[0] - Math.min(q[3], q[1])
  const e = 1e-10
  return [Math.abs(q[2] + (q[3] - q[1]) / (6 * d + e)), d / (q[0] + e), q[0]]
}
function h2r(c) {
  const K = [1, 2 / 3, 1 / 3, 3]
  const p = [c[0] + K[0], c[0] + K[1], c[0] + K[2]].map(v => Math.abs(fract(v) * 6 - K[3]))
  return [0, 1, 2].map(i => c[2] * mix(K[0], clamp(p[i] - K[0], 0, 1), c[1]))
}
const sky = e => { const y = Math.max(e[1], 0); return [Math.pow(1 - y, 2), 1 - y, 0.6 + (1 - y) * 0.4] }

// 复刻片元全管线(相机在洋面下), 返回最终色 + 调试量
function fragment(px, pz, cam, t, opt = {}) {
  const uHeight = 0.5, uAmp = opt.uAmp ?? 1, uEpsNrm = 0.5 / 1920
  const uFade = [42, 80], uBright = 1
  const vH = hGeo([px, pz], t, uHeight) * uAmp
  const vWorld = [px, 12 + vH, pz]
  let eye = V3.norm(V3.sub(vWorld, cam))
  if (eye[1] > 0) eye = [eye[0], -eye[1], eye[2]] // 从下仰视: 镜像
  const dist = V3.sub(vWorld, cam)
  const eps = V3.dot(dist, dist) * uEpsNrm
  const h0 = hDetail([px, pz], t, uHeight) * uAmp
  const hx = hDetail([px + eps, pz], t, uHeight) * uAmp
  const hz = hDetail([px, pz + eps], t, uHeight) * uAmp
  const n = V3.norm([h0 - hx, eps, h0 - hz])
  const l = V3.norm([0, 1, 0.8])
  const SeaBase = [0.11, 0.19, 0.22], Water = [0.55, 0.9, 0.7]
  const fresnel = Math.pow(1 - Math.max(V3.dot(n, V3.mulS(eye, -1)), 0), 3) * 0.45
  const reflected = V3.mulS(sky(reflect(eye, n)), 0.99)
  const dif = Math.pow(V3.dot(n, l) * 0.4 + 0.6, 80)
  const refracted = V3.add(SeaBase, V3.mulS(V3.mulS(Water, dif), 0.27))
  let col = V3.add(V3.mulS(refracted, 1 - fresnel), V3.mulS(reflected, fresnel))
  const atten = Math.max(1 - V3.dot(dist, dist) * 0.001, 0)
  col = V3.add(col, V3.mulS(V3.mulS(Water, vH - uHeight), 0.15 * atten))
  const spec = Math.pow(Math.max(V3.dot(reflect(eye, n), l), 0), 90) * ((90 + 8) / (3.1415 * 8))
  col = V3.add(col, [spec * 0.5, spec * 0.5, spec * 0.5])
  // 日间管线(原版逐字)
  let skyCol = sky(eye)
  col = col.map(v => Math.max(v, 0))
  col = V3.mulS(col, 1 / Math.sqrt(Math.sqrt(V3.len(dist))))
  col = col.map(v => v * Math.sqrt(Math.sqrt(v)) * 4)
  skyCol = V3.mul(V3.addS(V3.mulS(skyCol, 1.05), -0.03), V3.addS(V3.mulS(skyCol, 1.05), -0.03))
  const seaHsv = r2h(col)
  if (seaHsv[2] > 0.75 && V3.len(dist) < 50) seaHsv[2] -= (0.9 - seaHsv[2]) * 1.3
  col = h2r(seaHsv)
  const fog = Math.pow(smoothstep(0, -0.05, eye[1]), 0.3)
  let color = [0, 1, 2].map(i => mix(skyCol[i], col[i], fog)).map(v => Math.pow(v, 0.75))
  const hsv = r2h(color)
  hsv[1] += 0.131
  hsv[2] *= Math.sqrt(hsv[2]) * 1.1
  hsv[2] *= 0.9
  hsv[0] -= hsv[2] / 10
  hsv[0] += 0.02 + hsv[2] / 50
  hsv[2] *= 1.01
  hsv[1] += 0.07
  color = h2r(hsv).map(v => v * uBright)
  const dFade = Math.hypot(px - cam[0], pz - cam[2])
  color = color.map(v => v * (1 - smoothstep(uFade[0], uFade[1], dFade)))
  return { col: color, fog, n, dist: V3.len(dist) }
}

let fails = 0
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg) } }

// --- 1) 波高场值域/有限性(intersection 顶点 2 迭代) ---
let hMin = 1e9, hMax = -1e9
for (let x = -110; x <= 110; x += 2.3) for (let z = -110; z <= 110; z += 2.3) {
  for (const t of [0, 3.7, 11.9]) {
    const h = hGeo([x, z], t, 0.5)
    ok(Number.isFinite(h), `geo h NaN @(${x},${z},t=${t})`)
    hMin = Math.min(hMin, h); hMax = Math.max(hMax, h)
  }
}
console.log(`seaHeightGeo 值域: [${hMin.toFixed(3)}, ${hMax.toFixed(3)}] (期望 ⊂ [0, 0.65])`)
ok(hMin >= 0 && hMax <= 0.7, 'geo 值域越界')

// 细节场(5 迭代)也应有界
let dMin = 1e9, dMax = -1e9
for (let i = 0; i < 400; i++) {
  const h = hDetail([(i * 37 % 200) - 100, (i * 71 % 200) - 100], i * 0.23, 0.5)
  ok(Number.isFinite(h), 'detail h NaN')
  dMin = Math.min(dMin, h); dMax = Math.max(dMax, h)
}
console.log(`seaHeightDetail 值域: [${dMin.toFixed(3)}, ${dMax.toFixed(3)}] (×2 双向叠加, 期望 ⊂ [0, 1.4])`)
ok(dMin >= 0 && dMax <= 1.5, 'detail 值域越界')

// --- 2) 法线: 单位长、朝上 ---
let nOk = true
for (let i = 0; i < 200; i++) {
  const px = (i * 37 % 160) - 80, pz = (i * 53 % 160) - 80
  const r = fragment(px, pz, [0, 3, 0.5], i * 0.31)
  if (Math.abs(V3.len(r.n) - 1) > 1e-9 || !(r.n[1] > 0)) { nOk = false; break }
}
ok(nOk, '法线非法')
console.log('法线: 200 采样全部单位长且 n.y>0')

// --- 3) 雾公式端点(纯函数): 0 = 全海色, 1 = 全"天光雾" ---
const fogFor = ey => Math.pow(smoothstep(0, -0.05, ey), 0.3)
ok(fogFor(-0.1) === 1 && fogFor(-5) === 1, '|eye.y|>=0.05 应为纯海色(fog=1)')
ok(fogFor(-0.025) > 0.4 && fogFor(-0.025) < 0.95, '掠射带(0~0.05)应有部分混入')
console.log(`雾公式: eye.y=-0.1→${fogFor(-0.1).toFixed(3)}, -0.025→${fogFor(-0.025).toFixed(3)}`)
// 本场景实拍: 相机 y=3 洋面 y≈12, 80m 掠射处 fog 也应为 1(纯海色, 白光雾只在 186m+ 才够掠射)
const g = fragment(80, 0, [0, 3, 0], 5)
ok(g.fog === 1, `本场景 80m 掠射 fog 应为 1 (实际 ${g.fog})`)

// --- 4) 全管线有限 + 颜色偏青 ---
let allFinite = true
for (let i = 0; i < 300; i++) {
  const px = (i * 29 % 200) - 100, pz = (i * 71 % 200) - 100
  const cam = [i % 40 - 20, 2.5, i % 30]
  const r = fragment(px, pz, cam, i * 0.17)
  if (!r.col.every(Number.isFinite) || r.col.some(v => v < 0)) { allFinite = false; console.log('NaN/负色 @', px, pz, r.col) }
}
ok(allFinite, '管线出现 NaN/Inf/负值')
console.log('全管线: 300 点无 NaN')

const near = fragment(0, 0, [0, 2.5, 0], 7.3)
console.log(`头顶近处 RGB: [${near.col.map(v => v.toFixed(3)).join(', ')}]`)
ok(near.col[1] >= near.col[0] * 0.9 && near.col.reduce((a, b) => a + b) > 0.15, '近处海色应非黑且偏青')

// --- 5) 距离渐隐 42→80m ---
const fadeIn = fragment(10, 0, [0, 3, 0], 3)
const fadeOut = fragment(100, 0, [0, 3, 0], 3)
ok(fadeOut.col.every(v => v === 0), '100m 处应完全没入黑')
ok(fadeIn.col.reduce((a, b) => a + b, 0) > 0.1, '10m 处不应被渐隐吃掉')
console.log(`渐隐: 10m 亮度=${fadeIn.col.reduce((a, b) => a + b, 0).toFixed(3)}, 100m 亮度=0`)

// --- 6) uAmp=0 平静如镜 ---
const flat = fragment(5, 5, [0, 3, 0], 4, { uAmp: 0 })
ok(Math.abs(flat.n[1] - 1) < 0.02, `uAmp=0 时法线应近垂直 (n.y=${flat.n[1]})`)
console.log(`uAmp=0: n=[${flat.n.map(v => v.toFixed(4)).join(', ')}]`)

console.log(fails ? `\n${fails} 项未过` : '\n全部通过')
process.exit(fails ? 1 : 0)
