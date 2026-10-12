// 临时数学校验: 引力球(体积外套)的片元步进 + 4球物理 (纯 Node, 复刻 wikimodel.js 里的实现)
const THREE = require('../js/lib/three.min.js')

// ===== 与 wikimodel.js 同源常量 =====
const ORB_RADIUS = 0.2, ORB_SHELL_SCALE = 1.6, ORB_DIST = 6, SHELL_HALF = 4.0
const S = ORB_RADIUS / 0.9 * ORB_SHELL_SCALE // 米/SDF单位
const SHELL_PHYS = { G: 3.6, softening: 0.25, drag: 0.018, brownian: 0.025, coreRadius: 0.70, repulsionForce: 18.0 }

const wp4 = { pos: [-3.489691, 3.597148, 0.778449], quat: [-0.016972, 0.97839, -0.089447, -0.185643] }
const camPos = new THREE.Vector3(...wp4.pos)
const q4 = new THREE.Quaternion(...wp4.quat)
const orbPos = camPos.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(q4).multiplyScalar(ORB_DIST))
console.log('S(米/单位) =', S.toFixed(5), ' 云团基准半径 =', (0.9 * S).toFixed(3), 'm  白球半径 =', ORB_RADIUS, 'm')
console.log('orbPos =', orbPos.toArray().map(v => v.toFixed(3)).join(', '), ' 相机→球距 =', camPos.distanceTo(orbPos).toFixed(3))

// ===== GLSL 复刻: hash/noise/fbm/smin/map =====
function fract(v) { return v - Math.floor(v) }
function hash(x, y, z) { return fract(Math.sin(x * 12.9898 + y * 78.233 + z * 45.5432) * 43758.5453123) }
function noise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
  const fx = x - ix, fy = y - iy, fz = z - iz
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
  const mix = (a, b, t) => a + (b - a) * t
  return mix(
    mix(mix(hash(ix, iy, iz), hash(ix + 1, iy, iz), ux),
      mix(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), ux), uy),
    mix(mix(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), ux),
      mix(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), ux), uy),
    uz)
}
function fbm(x, y, z) {
  let v = 0, a = 0.5
  for (let i = 0; i < 3; i++) {
    v += a * noise(x, y, z)
    x = x * 2.02 + 1.7; y = y * 2.02 + 9.2; z = z * 2.02 + 4.3
    a *= 0.5
  }
  return v
}
function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25 }
const uPos = [
  [1.55, 0.15, 0.0], [-1.25, 0.65, 0.4], [0.35, -1.15, -0.7], [-0.40, 0.25, -1.45]
]
let uTime = 30.0
function map(x, y, z) {
  const nx = x * 1.3, ny = y * 1.3 + uTime * 0.25, nz = z * 1.3 + uTime * 0.15
  const displacement = (fbm(nx, ny, nz) - 0.45) * 0.45
  const dBig = Math.hypot(x, y, z) - (0.9 + displacement)
  const small = uPos.map(p => Math.hypot(x - p[0], y - p[1], z - p[2]) - ([0.36, 0.26, 0.21, 0.17][uPos.indexOf(p)] + displacement))
  let fused = smin(dBig, small[0], 0.45)
  fused = smin(fused, small[1], 0.38)
  fused = smin(fused, small[2], 0.32)
  fused = smin(fused, small[3], 0.28)
  return Math.abs(fused) - 0.015
}

// ===== 复刻片元步进 =====
function march(target) {
  const ro = camPos.clone().sub(orbPos).divideScalar(S)
  const rd = target.clone().sub(camPos).normalize()
  const ta = new THREE.Vector3(-SHELL_HALF, -SHELL_HALF, -SHELL_HALF).sub(ro).divide(rd)
  const tb = new THREE.Vector3(SHELL_HALF, SHELL_HALF, SHELL_HALF).sub(ro).divide(rd)
  const tmn = ta.clone().min(tb), tmx = ta.clone().max(tb)
  const tEnter = Math.max(tmn.x, tmn.y, tmn.z, 0)
  const tExit = Math.min(tmx.x, tmx.y, tmx.z)
  if (tExit <= tEnter) return { discard: true }
  let kx = ro.x + rd.x * (tEnter + 0.002), ky = ro.y + rd.y * (tEnter + 0.002), kz = ro.z + rd.z * (tEnter + 0.002)
  const camDistU = Math.hypot(ro.x, ro.y, ro.z)
  const uOrbR = ORB_RADIUS / S
  const N = [0, 0, 0, 0]
  let it = 0, bandSamples = 0
  for (it = 0; it < 96; it++) {
    const traveled = Math.hypot(kx - ro.x, ky - ro.y, kz - ro.z)
    if (traveled >= tExit || N[3] >= 6.0) break
    if (Math.hypot(kx, ky, kz) < uOrbR) break // 撞进白球
    const depth = traveled - camDistU + 4.3
    const b = Math.max(map(kx, ky, kz), 0)
    const edge = Math.min(b * 1024, 0.35 - b)
    if (edge > 0) {
      bandSamples++
      const spatialPhase = kx * 0.6 + ky * 0.5 + kz * 0.4 + kz * 0.6
      const fresnel = 1 - Math.abs(rd.x * kx + rd.y * ky + rd.z * kz) / Math.hypot(kx + 0.0001, ky, kz)
      const distBig = Math.hypot(kx, ky, kz)
      const distMinSmall = Math.min(...uPos.map(p => Math.hypot(kx - p[0], ky - p[1], kz - p[2])))
      const fusionTension = Math.exp(-Math.min(Math.max(Math.abs(distBig - distMinSmall), 0), 5) * 3.5)
      const colorPhase = spatialPhase + fresnel * 1.8 + fusionTension * 3.14 + depth * 0.15 - uTime * 0.5
      for (let c = 0; c < 3; c++) {
        const pal = 0.04 + 0.02 * Math.cos(colorPhase + [6.0, 1.0, 2.0][c])
        N[c] += edge * (pal + (c === 0 ? 0.025 : c === 1 ? 0.015 : 0.035) * fusionTension)
      }
      N[3] += edge * 0.04
    }
    const step = Math.max(b, 0.0035) * (0.8 + depth * 0.15) * 0.35
    kx += rd.x * step; ky += rd.y * step; kz += rd.z * step
  }
  const mapped = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const u = N[c] - 0.42
    const denom = u + 0.25 + 0.15 / (Math.abs(u) + 0.08)
    mapped[c] = Math.min(Math.max(u / denom + 0.4, 0.15), 1.0)
  }
  const gray = mapped[0] * 0.299 + mapped[1] * 0.587 + mapped[2] * 0.114
  for (let c = 0; c < 3; c++) mapped[c] = gray + (mapped[c] - gray) * 0.35
  const t = Math.min(Math.max((N[3] - 0.01) / 0.39, 0), 1)
  const alpha = t * t * (3 - 2 * t)
  return { tEnter, tExit, it, bandSamples, N, mapped, alpha, discard: alpha < 0.004 }
}
function report(name, target) {
  const r = march(target)
  if (r.discard) { console.log(`${name}: discard (无云) — it=${r.it === undefined ? '-' : r.it}`); return }
  console.log(`${name}: tEnter=${r.tEnter.toFixed(2)} tExit=${r.tExit.toFixed(2)} 步数=${r.it}/96 带内采样=${r.bandSamples}`)
  console.log(`   N.a=${r.N[3].toFixed(4)}  alpha=${r.alpha.toFixed(4)}  rgb=(${r.mapped.map(v => v.toFixed(3)).join(', ')})  ${r.alpha < 0.004 ? '→ discard' : ''}`)
  if ([r.N[3], r.alpha, ...r.mapped].some(v => !isFinite(v))) console.log('   !! NaN/Inf')
}

console.log('\n--- 命中率/亮度 ---')
report('正对球心(白球应透出→alpha 小)', orbPos.clone())
const perp = new THREE.Vector3().crossVectors(orbPos.clone().sub(camPos), new THREE.Vector3(0, 1, 0)).normalize()
report('切向偏 0.9m(云缘→应有 alpha)', orbPos.clone().addScaledVector(perp, 0.9))
report('切向偏 0.45m', orbPos.clone().addScaledVector(perp, 0.45))
report('切向偏 1.4m(外层小球带)', orbPos.clone().addScaledVector(perp, 1.4))
report('盒角落(应无云)', orbPos.clone().addScaledVector(perp, 1.9).add(new THREE.Vector3(0, 2.2, 0)))
report('偏 2.5m(盒外)', orbPos.clone().addScaledVector(perp, 2.5))

// 切向扫一遍: 找出"最亮"的偏距与最大 alpha
let best = { d: 0, a: 0 }, maxA = 0
for (let d = 0; d <= 2.0; d += 0.05) {
  const r = march(orbPos.clone().addScaledVector(perp, d))
  if (!r.discard && r.alpha > maxA) { maxA = r.alpha; best = { d, a: r.alpha } }
}
console.log(`切向扫描: 最大 alpha=${best.a.toFixed(4)} @ 偏距 ${best.d.toFixed(2)}m (云可被看到 → ${maxA > 0.1 ? 'PASS' : 'FAIL(整片不可见?)'})`)
console.log(`球心 alpha=${march(orbPos.clone()).alpha.toFixed(4)} (白球透出 → ${march(orbPos.clone()).alpha < 0.6 ? 'PASS' : '注意: 云盖住白球'})`)

// ===== 物理: 90 秒仿真(60fps), 查 NaN/越界/限速 =====
console.log('\n--- 4球物理 90s ---')
const bodies = [
  { pos: [1.55, 0.15, 0.0], vel: [0.0, 0.45, 1.42] },
  { pos: [-1.25, 0.65, 0.4], vel: [0.8, -0.2, -1.25] },
  { pos: [0.35, -1.15, -0.7], vel: [-1.3, 0.35, 0.55] },
  { pos: [-0.4, 0.25, -1.45], vel: [1.3, 0.65, 0.2] }
]
let maxR = 0, maxSpeed = 0, nan = false
for (let f = 0; f < 90 * 60; f++) {
  let dt = Math.min(1 / 60, 0.033)
  const steps = 8, subDt = dt / steps
  const randScale = SHELL_PHYS.brownian * Math.sqrt(1 / subDt)
  for (let s = 0; s < steps; s++) for (const b of bodies) {
    const [px, py, pz] = b.pos
    const r2 = px * px + py * py + pz * pz
    const r = Math.sqrt(Math.max(r2, 0.001))
    const invR3 = 1 / Math.pow(r2 + SHELL_PHYS.softening, 1.5)
    let ax = -SHELL_PHYS.G * px * invR3, ay = -SHELL_PHYS.G * py * invR3, az = -SHELL_PHYS.G * pz * invR3
    if (r < SHELL_PHYS.coreRadius) {
      const overlap = SHELL_PHYS.coreRadius - r
      const rep = Math.min(SHELL_PHYS.repulsionForce * overlap * overlap / (r * r + 0.06), 60)
      ax += px / r * rep; ay += py / r * rep; az += pz / r * rep
    }
    b.vel[0] += (ax - SHELL_PHYS.drag * b.vel[0] + (Math.random() * 2 - 1) * randScale) * subDt
    b.vel[1] += (ay - SHELL_PHYS.drag * b.vel[1] + (Math.random() * 2 - 1) * randScale) * subDt
    b.vel[2] += (az - SHELL_PHYS.drag * b.vel[2] + (Math.random() * 2 - 1) * randScale) * subDt
    const sp = Math.hypot(b.vel[0], b.vel[1], b.vel[2])
    if (sp > 4.5) { b.vel[0] *= 4.5 / sp; b.vel[1] *= 4.5 / sp; b.vel[2] *= 4.5 / sp }
    b.pos[0] += b.vel[0] * subDt; b.pos[1] += b.vel[1] * subDt; b.pos[2] += b.vel[2] * subDt
    if (r > 3.2) { b.vel[0] -= px * 0.8 * subDt; b.vel[1] -= py * 0.8 * subDt; b.vel[2] -= pz * 0.8 * subDt }
    const rN = Math.hypot(b.pos[0], b.pos[1], b.pos[2])
    if (rN > maxR) maxR = rN
    maxSpeed = Math.max(maxSpeed, Math.hypot(b.vel[0], b.vel[1], b.vel[2]))
    if ([...b.pos, ...b.vel].some(v => !isFinite(v))) nan = true
  }
  // 边界判据: 球心半径 3.2 + 最大球半径 0.36 + 噪声起伏 ~0.19 → 需 < 盒半 4.0
}
console.log(`最大球心半径 = ${maxR.toFixed(3)} (应 < 4.0-0.36-0.19=${(4.0 - 0.36 - 0.19).toFixed(2)} → ${maxR + 0.36 + 0.19 < 4.0 ? 'PASS 盒罩得住' : 'FAIL 球可能戳出盒'})`)
console.log(`速度上限实测 max=${maxSpeed.toFixed(3)} (限 4.5)  NaN=${nan ? '有!' : '无'}`)
console.log(`白球是否始终在云芯内: 球半径=${(ORB_RADIUS / S).toFixed(3)} 单位 < 云最小半径≈${(0.9 - 0.19).toFixed(2)} 单位 → ${ORB_RADIUS / S < 0.71 ? 'PASS' : 'FAIL'}`)

// ===== 入口机位: 云是否入画(不该在入场烘焙/开局里穿帮) =====
const wp0 = { pos: [0.045908, 2.161719, 1.597315], quat: [-0.113407, 0.700901, 0.694831, 0.114397] }
const cam0 = new THREE.Vector3(...wp0.pos)
const fwd0 = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(...wp0.quat))
const toOrb = orbPos.clone().sub(cam0).normalize()
console.log('\n--- 入口机位 ---')
console.log('入口视线→球心夹角 =', (Math.acos(fwd0.dot(toOrb)) * 180 / Math.PI).toFixed(1), '° (> 35/2+边缘 → 不在入场画面)')

// ===== 逐步 trace: 球心射线的步进细节 =====
console.log('\n--- trace 球心射线 (前 40 步) ---')
{
  const target = orbPos.clone()
  const ro = camPos.clone().sub(orbPos).divideScalar(S)
  const rd = target.clone().sub(camPos).normalize()
  const ta = new THREE.Vector3(-SHELL_HALF, -SHELL_HALF, -SHELL_HALF).sub(ro).divide(rd)
  const tb = new THREE.Vector3(SHELL_HALF, SHELL_HALF, SHELL_HALF).sub(ro).divide(rd)
  const tmn = ta.clone().min(tb), tmx = ta.clone().max(tb)
  const tEnter = Math.max(tmn.x, tmn.y, tmn.z, 0)
  const tExit = Math.min(tmx.x, tmx.y, tmx.z)
  let kx = ro.x + rd.x * (tEnter + 0.002), ky = ro.y + rd.y * (tEnter + 0.002), kz = ro.z + rd.z * (tEnter + 0.002)
  const camDistU = Math.hypot(ro.x, ro.y, ro.z)
  const uOrbR = ORB_RADIUS / S
  for (let i = 0; i < 60; i++) {
    const traveled = Math.hypot(kx - ro.x, ky - ro.y, kz - ro.z)
    if (traveled >= tExit) { console.log(`i=${i} 出盒 break`); break }
    if (Math.hypot(kx, ky, kz) < uOrbR) { console.log(`i=${i} 撞白球 break (半径=${Math.hypot(kx, ky, kz).toFixed(3)} < ${uOrbR.toFixed(3)})`); break }
    const depth = traveled - camDistU + 4.3
    const b = Math.max(map(kx, ky, kz), 0)
    const edge = Math.min(b * 1024, 0.35 - b)
    const step = Math.max(b, 0.0035) * (0.8 + depth * 0.15) * 0.35
    console.log(`i=${i} traveled=${traveled.toFixed(3)} depth=${depth.toFixed(2)} b=${b.toFixed(4)} edge=${edge.toFixed(4)} step=${step.toFixed(4)}`)
    kx += rd.x * step; ky += rd.y * step; kz += rd.z * step
  }
}
