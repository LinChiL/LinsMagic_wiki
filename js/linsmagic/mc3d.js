// mc3d.js — Minecraft 方块 3D 渲染
// 原版方块: block-model-renderer（库与资源包均已下载到 web/js/lib/，原版资源优先读 web/mcassets/，缺失才回退 CDN）
// 插件方块: 用本地贴图构建立方体（原版资源里没有这些方块）
// 统一挂在 three.js 场景里，OrbitControls 旋转缩放。

import mcassetsManifest from './mcassets-manifest.generated.js'

// 本地 vendor（web/js/lib/block-model-renderer/{dist/assets.zip,LICENSE}），资源包 assets.zip 由库按 ../assets.zip 自动定位
const LIB_URL = new URL('../lib/block-model-renderer/dist/block-model-renderer.min.js', import.meta.url).href
// 原版资源：优先本地缓存（web/mcassets/1.21.5），缺失的再回退 CDN
const LOCAL_BASE = new URL('../../mcassets/1.21.5/', import.meta.url).href
const CDN_BASE = 'https://assets.mcasset.cloud/1.21.5/'

let THREE = null
let lib = null
let assetsPromise = null
const fileCache = new Map()   // 资源文件缓存（JSON 字符串 / Uint8Array）
const texCache = new Map()    // THREE.Texture 缓存
let viewers = []              // 活动中的查看器，切换页面时统一销毁

const CDN_IMG = 'https://assets.mcasset.cloud'
const texUrls = (t) => {
  const n = String(t || 'item/book')
  const plain = n.replace(/\/waxed_/, '/')
  const list = [plain]
  if (plain.startsWith('item/')) list.push('block/' + plain.slice(5))
  if (plain.startsWith('block/')) list.push('item/' + plain.slice(6))
  return list
}

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

// 虚拟资源包：本地缓存的资源直接读，未缓存的回退到 mcasset CDN
const localPaths = new Set(mcassetsManifest || [])
const localDirs = new Map()   // dir -> [文件名]，供 list() 使用
const fileCache = new Map()   // 资源文件缓存（JSON 字符串 / Uint8Array）

async function fetchAsset(base, p) {
  let res
  try { res = await fetch(base + p) } catch (e) { return undefined }
  if (!res.ok) return undefined
  return p.endsWith('.json') ? await res.text() : new Uint8Array(await res.arrayBuffer())
}

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
    })()
  }
  return assetsPromise
}

async function loadTexture(T, texture) {
  const key = String(texture || 'item/book')
  if (texCache.has(key)) return texCache.get(key)
  const T0 = T
  const loader = new T0.TextureLoader()
  loader.setCrossOrigin('anonymous')
  let tex = null
  for (const n of texUrls(key)) {
    const sources = [`../textures/${n}.png`, `${CDN_IMG}/1.21.5/assets/minecraft/textures/${n}.png`]
    for (const src of sources) {
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
  if (!tex) {
    try {
      tex = await new Promise((ok, no) => {
        const timer = setTimeout(() => no(new Error('贴图超时')), 8000)
        loader.load('../textures/item/book.png', t => { clearTimeout(timer); ok(t) }, undefined, e => { clearTimeout(timer); no(e) })
      })
    } catch (e) { tex = null }
  }
  if (tex) {
    tex.magFilter = T0.NearestFilter
    tex.minFilter = T0.NearestFilter
    tex.colorSpace = T0.SRGBColorSpace
    texCache.set(key, tex)
  }
  return tex
}

function disposeViewer(v) {
  try {
    v.alive = false
    if (v.raf) cancelAnimationFrame(v.raf)
    if (v.controls) v.controls.dispose()
    if (v.ro) v.ro.disconnect()
    v.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose()
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        mats.forEach(m => { if (m.map && !texCache.has(m.map.__key)) m.map.dispose(); m.dispose() })
      }
    })
    v.renderer.dispose()
    if (v.renderer.domElement.parentNode) v.renderer.domElement.parentNode.removeChild(v.renderer.domElement)
  } catch (e) { /* 忽略销毁异常 */ }
}

export function destroyAll() {
  viewers.forEach(disposeViewer)
  viewers = []
}

function collectBlocks(struct) {
  const vanilla = []
  const custom = []
  for (const layer of struct.variants || []) {
    for (const b of layer) {
      const id = String(b.id || '')
      // 只有纯原版方块交给库；插件方块（中文名）与"可替换位置"用贴图立方体
      if (/^minecraft:[a-z0-9_]+$/.test(id) && !b.options) {
        vanilla.push({ id: id.replace('minecraft:', ''), pos: [b.x, b.y, b.z] })
      } else {
        custom.push(b)
      }
    }
  }
  return { vanilla, custom }
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' 超时')), ms))
  ])
}

export async function mountStructureViewer(container, struct) {
  const T = await getTHREE()
  const l = await getLib()
  const assets = await withTimeout(getAssets(), 20000, '资源准备')

  const width = Math.max(container.clientWidth || 640, 320)
  const height = Math.max(Math.round(width * 0.62), 260)

  const scene = new T.Scene()
  const camera = new T.PerspectiveCamera(38, width / height, 2, 6000)
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(width, height)
  renderer.outputColorSpace = T.SRGBColorSpace
  container.innerHTML = ''
  container.appendChild(renderer.domElement)
  renderer.domElement.className = 'lm-3d-canvas'

  scene.add(new T.AmbientLight(0xffffff, 2.0))
  const key = new T.DirectionalLight(0xffffff, 1.5); key.position.set(1, 2, 1.2); scene.add(key)
  const fill = new T.DirectionalLight(0xffffff, 0.7); fill.position.set(-1.2, 0.8, -1); scene.add(fill)

  const root = new T.Group()
  scene.add(root)

  const { vanilla, custom } = collectBlocks(struct)

  if (vanilla.length) {
    try {
      const handle = await withTimeout(l.createScene(assets, vanilla), 25000, '原版方块场景')
      const g = handle && (handle.group || handle)
      if (g) root.add(g)
    } catch (e) {
      console.warn('[mc3d] 原版方块渲染失败，退回贴图立方体', e)
      custom.push(...vanilla.map(v => ({ id: '', x: v.pos[0], y: v.pos[1], z: v.pos[2], texture: 'stone' })))
    }
  }

  for (const b of custom) {
    const tex = await loadTexture(T, b.texture || (b.options && b.options[0] && b.options[0].texture))
    const mat = new T.MeshLambertMaterial({ map: tex || null, color: tex ? 0xffffff : 0x9aa0a6 })
    const mesh = new T.Mesh(new T.BoxGeometry(15.4, 15.4, 15.4), mat)
    mesh.position.set(b.x * 16, b.y * 16, b.z * 16)
    root.add(mesh)
  }

  // 自动取景
  const box = new T.Box3().setFromObject(root)
  const center = box.getCenter(new T.Vector3())
  const size = Math.max(box.getSize(new T.Vector3()).length(), 24)
  camera.position.copy(center).add(new T.Vector3(size * 0.72, size * 0.62, size * 0.72))
  camera.lookAt(center)

  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js')
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.copy(center)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 20
  controls.maxDistance = size * 4
  controls.update()

  const viewer = { alive: true, scene, camera, renderer, controls, raf: 0, ro: null, root }
  viewers.push(viewer)
  window.__lm3d = viewer // 调试钩子：控制台可查看 root.children.length / renderer.info

  const tick = () => {
    if (!viewer.alive) return
    controls.update()
    renderer.render(scene, camera)
    viewer.raf = requestAnimationFrame(tick)
  }
  tick()

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      const w = Math.max(container.clientWidth, 320)
      if (!w) return
      const h = Math.max(Math.round(w * 0.62), 260)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    })
    ro.observe(container)
    viewer.ro = ro
  }

  return viewer
}

// 单个方块/物品的 3D 缩略图（返回 canvas，按需调用，不要批量刷）
export async function renderThumb(id, size = 96) {
  const l = await getLib()
  const assets = await getAssets()
  const clean = String(id).replace('minecraft:', '')
  return l.renderBlock({ id: clean, assets, width: size, height: size })
}
