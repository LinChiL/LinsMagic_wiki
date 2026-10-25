// mc3d.js — 多方块结构的 3D 视图
// 原版方块交给 block-model-renderer（本地 web/mcassets/1.21.5 优先，缺的回退 mcasset CDN）
// 插件方块（结构数据里是中文/英文机器名）按贴图建立方体
// 统一用 lighting: "scene"，由这里的灯光照亮，自建立方体与原版模型才不会两套观感

import mcassetsManifest from './mcassets-manifest.generated.js'

const LIB_URL = new URL('../lib/block-model-renderer/dist/block-model-renderer.min.js', import.meta.url).href
const LOCAL_BASE = new URL('../../mcassets/1.21.5/', import.meta.url).href
const CDN_BASE = 'https://assets.mcasset.cloud/1.21.5/'
const CDN_IMG = 'https://assets.mcasset.cloud'

let THREE = null
let lib = null
let assetsPromise = null
let viewers = []

const fileCache = new Map()
const texCache = new Map()
const localPaths = new Set(mcassetsManifest || [])
const localDirs = new Map()

async function getTHREE() {
  if (!THREE) THREE = await import('three')
  return THREE
}

async function getLib() {
  if (!lib) {
    lib = await import(/* @vite-ignore */ LIB_URL)
    const T = await getTHREE()
    if (lib.configure) lib.configure({ THREE: T })
  }
  return lib
}

async function fetchAsset(base, p) {
  let res
  try { res = await fetch(base + p) } catch (e) { return undefined }
  if (!res.ok) return undefined
  return p.endsWith('.json') ? await res.text() : new Uint8Array(await res.arrayBuffer())
}

// 虚拟资源包：本地缓存的直接读，未缓存的回退 CDN
const assetHandler = {
  async read(p) {
    if (fileCache.has(p)) return fileCache.get(p)
    let val
    if (localPaths.has(p)) val = await fetchAsset(LOCAL_BASE, p)
    if (val === undefined) val = await fetchAsset(CDN_BASE, p)
    if (val === undefined) val = null
    fileCache.set(p, val)
    return val
  },
  list(dir) {
    let names = localDirs.get(dir)
    if (!names) {
      const pre = String(dir).replace(/\/?$/, '/')
      names = [...localPaths]
        .filter(p => p.startsWith(pre))
        .map(p => p.slice(pre.length))
        .filter(n => n && !n.includes('/'))
      localDirs.set(dir, names)
    }
    return names
  }
}

async function getAssets() {
  if (!assetsPromise) {
    assetsPromise = (async () => {
      const l = await getLib()
      return l.prepareAssets([assetHandler], { cache: true, version: '1.21.5' })
    })().catch(e => { assetsPromise = null; throw e })
  }
  return assetsPromise
}

function texNames(t) {
  const plain = String(t || 'item/book').replace(/\/waxed_/, '/')
  const list = [plain]
  if (plain.startsWith('item/')) list.push('block/' + plain.slice(5))
  if (plain.startsWith('block/')) list.push('item/' + plain.slice(6))
  return list
}

async function loadTexture(T, texture) {
  const key = String(texture || 'item/book')
  if (texCache.has(key)) return texCache.get(key)
  const loader = new T.TextureLoader()
  loader.setCrossOrigin('anonymous')
  let tex = null
  for (const n of texNames(key)) {
    for (const src of [`../textures/${n}.png`, `${CDN_IMG}/1.21.5/assets/minecraft/textures/${n}.png`]) {
      try {
        tex = await new Promise((ok, no) => {
          const timer = setTimeout(() => no(new Error('贴图超时')), 8000)
          loader.load(src, t => { clearTimeout(timer); ok(t) }, undefined, e => { clearTimeout(timer); no(e) })
        })
        if (tex) break
      } catch (e) { tex = null }
    }
    if (tex) break
  }
  if (tex) {
    tex.magFilter = T.NearestFilter
    tex.minFilter = T.NearestFilter
    tex.colorSpace = T.SRGBColorSpace
    texCache.set(key, tex)
  }
  return tex
}

function disposeViewer(v) {
  if (!v || !v.alive) return
  v.alive = false
  viewers = viewers.filter(x => x !== v)
  if (v.raf) cancelAnimationFrame(v.raf)
  v.raf = 0
  try { v.controls && v.controls.dispose() } catch (e) { /* 忽略 */ }
  try { v.ro && v.ro.disconnect() } catch (e) { /* 忽略 */ }
  try { v.handle && v.handle.dispose && v.handle.dispose() } catch (e) { /* 忽略 */ }
  // 自建的贴图立方体（原版模型由 handle.dispose() 收走，别重复释放它共享的材质）
  try {
    const geos = new Set()
    for (const mesh of v.ownMeshes || []) {
      geos.add(mesh.geometry)
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      mats.forEach(m => { if (m && m.dispose) m.dispose() })
    }
    geos.forEach(g => { if (g && g.dispose) g.dispose() })
  } catch (e) { /* 忽略 */ }
  // 贴图由 texCache 托管、跨结构复用，这里不释放
  try { v.renderer.dispose() } catch (e) { /* 忽略 */ }
  const cv = v.renderer.domElement
  if (cv && cv.parentNode) cv.parentNode.removeChild(cv)
}

export function destroyAll() {
  viewers.forEach(disposeViewer)
  viewers = []
}

function collectBlocks(blocks) {
  const vanilla = []
  const custom = []
  for (const b of blocks) {
    const id = String(b.id || '')
    if (id === 'minecraft:air') continue
    if (/^minecraft:[a-z0-9_]+$/.test(id)) vanilla.push({ id: id.slice('minecraft:'.length), pos: [b.x, b.y, b.z] })
    else custom.push(b)
  }
  return { vanilla, custom }
}

// 插件方块：优先用同名的 block 贴图（平铺自然），没有再退回数据里的 item 图标
const TEX_SUFFIXES = ['', '_side', '_top', '_front', '_side0']
const TEX_ALIAS = { magma_block: 'magma' }
function customTexture(b, localTextures) {
  const t = String(b.texture || 'item/book')
  if (t.startsWith('block/')) return t
  const name = t.replace(/^item\//, '')
  if (!localTextures) return t
  for (const suf of TEX_SUFFIXES) {
    const cand = 'block/' + name + suf
    if (localTextures.has(cand)) return cand
  }
  const alias = TEX_ALIAS[name]
  if (alias && localTextures.has('block/' + alias)) return 'block/' + alias
  return t
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + '超时')), ms))
  ])
}

export async function mountStructureViewer(mount, struct, opts = {}) {
  const report = typeof opts.onProgress === 'function' ? opts.onProgress : () => {}
  const variants = struct.variants || []
  const variant = Math.min(Math.max(Number(opts.variant) || 0, 0), Math.max(variants.length - 1, 0))
  const blocks = variants[variant] || []
  if (!blocks.length) throw new Error('该结构没有可显示的方块')

  report('正在加载 3D 引擎…')
  const T = await getTHREE()
  const l = await getLib()
  report('正在准备方块资源…')
  const assets = await withTimeout(getAssets(), 45000, '方块资源准备')

  const width = Math.max(Math.round(mount.clientWidth) || 640, 240)
  const height = Math.max(Math.round(mount.clientHeight) || Math.round(width * 0.62), 220)

  const scene = new T.Scene()
  const camera = new T.PerspectiveCamera(36, width / height, 1, 5000)
  let renderer
  try {
    renderer = new T.WebGLRenderer({ antialias: true, alpha: true })
  } catch (e) {
    throw new Error('当前浏览器不支持 WebGL')
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(width, height, false)
  renderer.outputColorSpace = T.SRGBColorSpace
  renderer.domElement.className = 'lm-3d-canvas'
  mount.replaceChildren(renderer.domElement)

  scene.add(new T.AmbientLight(0xffffff, 1.2))
  scene.add(new T.HemisphereLight(0xffffff, 0xcfcfc9, 0.7))
  const key = new T.DirectionalLight(0xffffff, 1.8); key.position.set(70, 110, 60); scene.add(key)
  const fill = new T.DirectionalLight(0xffffff, 0.55); fill.position.set(-80, 40, -70); scene.add(fill)

  const root = new T.Group()
  scene.add(root)
  const ownMeshes = []

  const { vanilla, custom } = collectBlocks(blocks)
  let handle = null

  if (vanilla.length) {
    report('正在生成方块模型…')
    try {
      handle = await withTimeout(l.createScene(assets, vanilla, {
        lighting: 'scene',
        optimize: true,
        onProgress: (stage, done, total) => {
          if (!stage || !stage.count) return
          const frac = (stage.index + (total ? done / total : 0)) / stage.count
          report(`正在生成方块模型 ${Math.round(frac * 100)}%`)
        }
      }), 45000, '方块模型生成')
      if (handle && handle.group) root.add(handle.group)
    } catch (e) {
      // 资源拿不到时退回贴图立方体，至少还能看结构
      console.warn('[mc3d] 原版方块建模失败，退回贴图立方体:', e)
      vanilla.forEach(v => custom.push({ id: '', x: v.pos[0], y: v.pos[1], z: v.pos[2], texture: 'block/' + v.id }))
    }
  }

  if (custom.length) {
    const geo = new T.BoxGeometry(16, 16, 16)
    for (const b of custom) {
      const tex = await loadTexture(T, customTexture(b, opts.localTextures))
      const mat = new T.MeshStandardMaterial({
        map: tex || null,
        color: tex ? 0xffffff : 0xb9b9b3,
        roughness: 0.92,
        metalness: 0
      })
      const mesh = new T.Mesh(geo, mat)
      mesh.position.set(b.x * 16, b.y * 16, b.z * 16)
      root.add(mesh)
      ownMeshes.push(mesh)
    }
  }

  const box = new T.Box3().setFromObject(root)
  if (box.isEmpty()) throw new Error('该结构没有可显示的方块')
  const center = box.getCenter(new T.Vector3())
  const radius = Math.max(box.getBoundingSphere(new T.Sphere()).radius, 12)
  const dist = radius / Math.sin(T.MathUtils.degToRad(camera.fov / 2)) * 1.06
  const home = center.clone().addScaledVector(new T.Vector3(0.85, 0.7, 1).normalize(), dist)
  camera.position.copy(home)
  camera.near = Math.max(1, radius / 60)
  camera.far = dist + radius * 12
  camera.updateProjectionMatrix()
  camera.lookAt(center)

  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js')
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.copy(center)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.rotateSpeed = 0.9
  controls.zoomSpeed = 0.8
  controls.minDistance = radius * 0.55
  controls.maxDistance = dist * 3
  controls.autoRotate = true
  controls.autoRotateSpeed = 0.9
  controls.addEventListener('start', () => { controls.autoRotate = false })
  controls.update()

  const syncSize = () => {
    const w = Math.round(mount.clientWidth)
    const h = Math.round(mount.clientHeight)
    if (!w || !h) return
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h, false)
  }

  const viewer = {
    alive: true,
    scene,
    camera,
    renderer,
    controls,
    root,
    ownMeshes,
    handle,
    raf: 0,
    ro: null,
    pause() {
      if (this.raf) cancelAnimationFrame(this.raf)
      this.raf = 0
    },
    resume() {
      if (!this.alive || this.raf) return
      syncSize()
      tick()
    },
    reset() {
      camera.position.copy(home)
      controls.target.copy(center)
      controls.autoRotate = true
      controls.update()
    },
    dispose() { disposeViewer(this) }
  }

  const tick = () => {
    if (!viewer.alive) return
    controls.update()
    renderer.render(scene, camera)
    viewer.raf = requestAnimationFrame(tick)
  }

  viewers.push(viewer)
  tick()

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(syncSize)
    ro.observe(mount)
    viewer.ro = ro
  }

  return viewer
}

// 单个方块的 3D 缩略图（返回 canvas；库/资源已预热后再调用）
export async function renderThumb(id, size = 96) {
  const l = await getLib()
  const assets = await getAssets()
  const clean = String(id).replace('minecraft:', '')
  return l.renderBlock({ id: clean, assets, width: size, height: size })
}
