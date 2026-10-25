// linsmagic.js — 纯 JS 版魔法百科（无 Vue 依赖）
// 数据: catalog.generated.js / pages.generated.js / textures.generated.js
import catalog from './catalog.generated.js?v=13'
import localTextureList from './textures.generated.js?v=13'
import pages from './pages.generated.js?v=13'

const ROOT = '#content'
const entries = catalog.entries || []
const recipes = catalog.recipes || []
const structures = catalog.structures || []
const categoryGroups = catalog.categoryGroups || []
const categorySubgroups = catalog.categorySubgroups || {}

const entryById = Object.fromEntries(entries.map(e => [e.id, e]))
const entryByName = Object.fromEntries(entries.map(e => [e.name, e]))
const recipeById = Object.fromEntries(recipes.map(r => [r.id, r]))
const structureById = Object.fromEntries(structures.map(s => [s.id, s]))
const recipeByHref = new Map()
for (const r of recipes) recipeByHref.set(r.href.replace(/\/linsmagic\/atlas/, '').replace(/\/$/, ''), r.id)
const entryByHref = new Map()
for (const e of entries) entryByHref.set(e.href.replace(/\/linsmagic\/atlas/, '').replace(/\/$/, ''), e.id)

// ===== 贴图 =====
const localSet = new Set(localTextureList || [])
const aliases = {
  'item/glass_pane': ['block/glass'], 'item/magma_block': ['block/magma'],
  'item/barrel': ['block/barrel_side'], 'item/crafting_table': ['block/crafting_table_front'],
  'item/grass_block': ['block/grass_block_top'], 'item/knowledge_book': ['item/book'],
  'item/daylight_detector': ['block/daylight_detector_top'],
  'item/smooth_red_sandstone': ['block/red_sandstone_top'], 'item/iron_block': ['block/iron_block'],
  'item/piston': ['block/piston_top'], 'item/piston_top': ['block/piston_top'],
  'item/basalt': ['block/basalt_side'], 'item/quartz_block': ['block/quartz_block_side'],
  'item/enchanting_table': ['block/enchanting_table_top'],
  'item/blast_furnace': ['block/blast_furnace_front'], 'item/prismarine_wall': ['block/prismarine'],
  'item/waxed_exposed_copper': ['block/exposed_copper'],
  'item/waxed_weathered_copper': ['block/weathered_copper'],
  'item/waxed_oxidized_copper': ['block/oxidized_copper'],
  'item/air': ['item/barrier'], 'item/ancient_debris': ['block/ancient_debris_side'],
  'item/big_dripleaf': ['block/big_dripleaf_top'],
  'item/black_stained_glass_pane': ['block/black_stained_glass'],
  'item/gray_stained_glass_pane': ['block/gray_stained_glass'],
  'item/blackstone_slab': ['block/blackstone'], 'item/bone_block': ['block/bone_block_side'],
  'item/cartography_table': ['block/cartography_table_top'], 'item/chest': ['block/oak_planks'],
  'item/trapped_chest': ['block/oak_planks'], 'item/ender_chest': ['block/obsidian'],
  'item/clock': ['item/clock_00'], 'item/compass': ['item/compass_00'],
  'item/recovery_compass': ['item/recovery_compass_00'], 'item/composter': ['block/composter_side'],
  'item/crimson_hyphae': ['block/crimson_stem'], 'item/dispenser': ['block/dispenser_front'],
  'item/dropper': ['block/dropper_front'], 'item/dried_kelp_block': ['block/dried_kelp_side'],
  'item/enchanted_golden_apple': ['item/golden_apple'],
  'item/fletching_table': ['block/fletching_table_front'], 'item/furnace': ['block/furnace_front'],
  'item/grindstone': ['block/grindstone_side'], 'item/hay_block': ['block/hay_block_side'],
  'item/heavy_weighted_pressure_plate': ['block/iron_block'],
  'item/light_weighted_pressure_plate': ['block/gold_block'],
  'item/honey_block': ['block/honey_block_side'], 'item/iron_chain': ['item/chain'],
  'item/lectern': ['block/lectern_front'], 'item/lodestone': ['block/lodestone_side'],
  'item/loom': ['block/loom_front'], 'item/moss_carpet': ['block/moss_block'],
  'item/observer': ['block/observer_front'], 'item/polished_basalt': ['block/polished_basalt_side'],
  'item/polished_blackstone_slab': ['block/polished_blackstone'],
  'item/polished_diorite_slab': ['block/polished_diorite'], 'item/pumpkin': ['block/pumpkin_side'],
  'item/purpur_slab': ['block/purpur_block'], 'item/respawn_anchor': ['block/respawn_anchor_side0'],
  'item/sculk_catalyst': ['block/sculk_catalyst_side'],
  'item/smithing_table': ['block/smithing_table_front'], 'item/smoker': ['block/smoker_front'],
  'item/smooth_stone_slab': ['block/smooth_stone'], 'item/snow_block': ['block/snow'],
  'item/sticky_piston': ['block/piston_top_sticky'], 'item/stone_slab': ['block/stone'],
  'item/stripped_oak_wood': ['block/stripped_oak_log'], 'item/sunflower': ['block/sunflower_front'],
  'item/tnt': ['block/tnt_side'], 'item/copper_bulb': ['block/copper_bulb'],
  'item/polished_blackstone_pressure_plate': ['block/polished_blackstone'],
  'item/stone_pressure_plate': ['block/stone'], 'item/copper_bars': ['block/copper_bars'],
  'item/target': ['block/target_side'], 'item/verdant_froglight': ['block/verdant_froglight_side'],
  'item/ochre_froglight': ['block/ochre_froglight_side'],
  'item/pearlescent_froglight': ['block/pearlescent_froglight_side'],
  'item/oxidized_lightning_rod': ['block/lightning_rod'], 'item/skeleton_skull': ['item/bone'],
  'item/wither_skeleton_skull': ['item/coal'], 'item/zombie_head': ['item/rotten_flesh'],
  'item/creeper_head': ['item/gunpowder'], 'item/dragon_head': ['item/dragon_breath']
}
const CDN = 'https://assets.mcasset.cloud'
function textureCandidates(texture) {
  const plain = String(texture || 'item/book').replace(/\/waxed_/, '/')
  const base = [plain, ...(aliases[plain] || [])]
  if (plain.startsWith('item/')) base.push('block/' + plain.slice(5))
  if (plain.startsWith('block/')) base.push('item/' + plain.slice(6))
  const names = [...new Set(base)]
  // 相对路径: 页面在 /web/html/ 下, 贴图在 /web/textures/ —— 服务器根目录无论指向 web 还是其上级都成立
  const local = names.filter(n => localSet.has(n)).map(n => `../textures/${n}.png`)
  const remote = names.filter(n => !localSet.has(n))
  return [
    ...local,
    ...remote.map(n => `${CDN}/1.21.5/assets/minecraft/textures/${n}.png`),
    ...remote.map(n => `${CDN}/26.1/assets/minecraft/textures/${n}.png`),
    `../textures/item/book.png`
  ]
}
window.lmImgError = function (img) {
  const cands = textureCandidates(img.dataset.t)
  const i = (parseInt(img.dataset.i || '0', 10) || 0) + 1
  if (i < cands.length) { img.dataset.i = i; img.src = cands[i] }
  else { img.onerror = null; img.src = cands[cands.length - 1] }
}
function iconHtml(id, texture, size = 44) {
  const t = texture || entryById[id]?.icon || 'item/book'
  const cands = textureCandidates(t)
  return `<img class="lm-icon-img" src="${cands[0]}" data-t="${t}" data-i="0" width="${size}" height="${size}"
    alt="" loading="lazy" onerror="lmImgError(this)">`
}
function nameOf(id) { return entryById[id]?.name || id || '' }
function hrefOf(id) { const e = entryById[id]; return e ? e.href.replace(/\/linsmagic\/atlas/, ROOT) : ROOT }

// ===== 路由 =====
function parseHash(hash) {
  const m = String(hash || '').match(/^#content\/?(.*)$/)
  if (!m) return { kind: 'home' }
  let rest = m[1]
  // 支持 #lm/xxx#小节锚点
  let anchor = ''
  const ai = rest.indexOf('#')
  if (ai >= 0) {
    anchor = rest.slice(ai + 1)
    try { anchor = decodeURIComponent(anchor) } catch (e) {}
    rest = rest.slice(0, ai)
  }
  const raw = decodeURIComponent(rest).replace(/\/$/, '')
  if (!raw) return { kind: 'home', anchor }
  const parts = raw.split('/').filter(Boolean)

  if (pages[raw]) return { kind: 'page', slug: raw, anchor }

  const fullHref = '/' + raw
  if (entryByHref.has(fullHref)) return { kind: 'entry', id: entryByHref.get(fullHref), anchor }
  if (recipeByHref.has(fullHref)) return { kind: 'recipe', id: recipeByHref.get(fullHref), anchor }

  const known = categoryGroups.map(g => g.id)
  if (known.includes(parts[0])) return { kind: 'category', category: parts[0], subgroup: parts[1], anchor }
  return { kind: 'home', anchor }
}

// ===== 视图 =====
const countCache = new Map()
function countEntries(cat) {
  if (countCache.has(cat)) return countCache.get(cat)
  const n = cat === 'recipes'
    ? recipes.length
    : entries.filter(e => e.href.startsWith(`/linsmagic/atlas/${cat}/`)).length
  countCache.set(cat, n)
  return n
}
function pageTitle(slug) {
  const html = pages[slug]?.html || ''
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : slug
}
function entryCategoryId(id) {
  const e = entryById[id]
  const m = e && String(e.href).match(/\/linsmagic\/atlas\/([^/]+)\//)
  return m ? m[1] : ''
}
function entryCategoryTitle(id) {
  const g = categoryGroups.find(c => c.id === entryCategoryId(id))
  return (entryById[id]?.category) || g?.title || '资料'
}

const guideList = [
  { slug: 'guide/book', title: '芸集知识之书', icon: 'item/book', detail: '图鉴入口、常用菜单与设置。' },
  { slug: 'guide/merchant', title: '异界行商联络器', icon: 'item/emerald', detail: '矿砂与特殊物品的交易。' },
  { slug: 'guide/hub', title: '次元枢纽传送单元', icon: 'item/ender_pearl', detail: '世界与维度之间的传送。' },
  { slug: 'guide/enchant', title: '魔法附魔玩法', icon: 'item/enchanted_book', detail: '注魔与高级附魔的获取。' },
  { slug: 'guide/guild', title: '公会', icon: 'item/shield', detail: '创建、加入与公会排名。' },
  { slug: 'guide/special', title: '特殊事件指南', icon: 'item/bell', detail: '精英怪及服务器事件。' },
  { slug: 'guide/night', title: '特殊夜晚指南', icon: 'item/nether_star', detail: '各类特殊夜晚的触发与效果。' },
  { slug: 'guide/mineral', title: '工业矿机组指南', icon: 'block/basalt_side', detail: '搭建、燃料、探针与矿砂存储。' }
]
const systemList = [
  { slug: 'tutorials/systems/pipeline', title: '管道系统', icon: 'block/black_stained_glass', detail: '第一条线路、阀门方向、分流与分拣、机器自动进出料、末影传输与填充机仓库。' },
  { slug: 'tutorials/systems/multiblock', title: '多方块机器', icon: 'block/piston_top', detail: '3D 结构图的查看方式；原石粉碎机、矿物种子、工业矿机组的用法；四十多台机器一览。' },
  { slug: 'tutorials/systems/enchanting', title: '附魔体系', icon: 'item/enchanted_book', detail: '30 级高阶附魔概率、6 系注魔器摆放、铁砧合并规则、词条刻刀与附魔结晶。' },
  { slug: 'tutorials/systems/events-bosses', title: '夜间事件与首领', icon: 'item/nether_star', detail: '六种特殊夜晚的危险与收获、催化剂召唤、精英怪、召唤祭坛与 18 个首领。' },
  { slug: 'tutorials/systems/web-machines', title: '网页机器', icon: 'item/map', detail: '使用绘制台-WE 将任意图片转换为地图画。' },
  { slug: 'tutorials/systems/automatons', title: '自动机器（LanT-Flow）', icon: 'block/chiseled_copper', detail: '可编程双轮自动机：格子程序、LanT 脚本、网页积木编辑器、程序卡与领地规则。' },
  { slug: 'tutorials/systems/applied-energistics', title: '应用能源（入门）', icon: 'item/waxed_copper_bars', detail: '陨石与材料链、压印器、ME 网络组建、存储元件、终端、总线与管道对接。' },
  { slug: 'tutorials/systems/ae-autocrafting', title: '应用能源（自动合成）', icon: 'item/flower_banner_pattern', detail: '样板编码、样板供应器、分子装配室、合成 CPU、下单与任务管理、无线终端。' },
  { slug: 'tutorials/systems/power', title: '发电系统', icon: 'item/daylight_detector', detail: '燃料、光伏板、地热、风力、魔素反应堆、能源元件与核反应堆。' }
]

function folderCard(href, icon, title, detail, extra, cls) {
  return `<a href="${href}" class="lm-folder${cls ? ' ' + cls : ''}">
    ${iconHtml(null, icon, 48)}
    <span><strong>${title}</strong><small>${detail || ''}</small>${extra ? `<em>${extra}</em>` : ''}</span>
    <span class="lm-folder-arrow" aria-hidden="true">↗</span></a>`
}

function homeHtml() {
  const quickCards = [
    folderCard('#content/tutorials/new-player', 'item/knowledge_book', '新手路线', '按 8 步走完开荒流程，从第一件魔法工具到第一条管道。', '8 步', 'lm-route-card'),
    folderCard('#content/tutorials/systems', 'block/chiseled_copper', '系统教程', '管道、机器、附魔、应用能源等 9 个系统，从原理到搭法。', '9 个系统', 'lm-route-card'),
    folderCard('#content/guide', 'item/book', '玩法指南', '大典、行商、次元枢纽、公会与夜间事件的手册合集。', '8 篇', 'lm-route-card')
  ].join('')

  const cards = categoryGroups.map(g => folderCard(
    `#content/${g.id}`, g.icon, g.title, g.description, `${countEntries(g.id)} 项`, 'lm-cat-card'
  )).join('')

  return `
    <div class="lm-hero">
      <div class="lm-hero-copy">
        <span class="lm-eyebrow">LINSMAGIC · ATLAS</span>
        <h1 class="lm-title">魔法百科</h1>
        <p class="lm-intro">第一次玩可以从「新手路线」按步骤开始；想学搭建方法进入「系统教程」；需要查询某个物品则使用下方分类与搜索。</p>
        <form class="lm-atlas-search" data-role="home-search">
          <label><span aria-hidden="true">⌕</span><input type="search" placeholder="搜索分类、物品、机器或配方…" aria-label="搜索魔法百科"></label>
          <button type="submit">打开首项</button>
        </form>
        <div class="lm-home-results" data-role="home-results" hidden></div>
      </div>
      <aside class="lm-hero-panel" aria-label="百科数据">
        <span class="lm-eyebrow">ARCHIVE</span>
        <div class="lm-hero-total"><strong>${entries.length}</strong><span>收录资料条目</span></div>
        <div class="lm-hero-minis">
          <div><strong>${recipes.length}</strong><span>配方</span></div>
          <div><strong>${structures.length}</strong><span>结构</span></div>
          <div><strong>${categoryGroups.length}</strong><span>分类</span></div>
        </div>
        <p>内容取自插件图鉴与教程，随版本更新。</p>
      </aside>
    </div>
    <div class="lm-section-head">
      <h2 class="lm-subtitle">入门与教程</h2>
      <small>START HERE</small>
    </div>
    <div class="lm-folder-grid lm-route-grid">${quickCards}</div>
    <div class="lm-section-head">
      <h2 class="lm-subtitle">分类浏览</h2>
      <small>COLLECTIONS</small>
    </div>
    <div class="lm-folder-grid lm-cat-grid">${cards}</div>`
}

function pageHtml(slug) {
  const page = pages[slug]
  if (!page) return `<p class="lm-muted">未找到页面：${slug}</p>`
  const isGuide = slug.startsWith('guide')
  return `<article class="lm-page">
    <span class="lm-eyebrow">${isGuide ? 'GUIDE / 玩法指南' : 'TUTORIAL / 系统教程'}</span>
    ${page.html}
  </article>`
}

// 少数分类的数据里，子分类名和条目上的 group 不是同一个词，归到「其他」那一档
const SUBGROUP_ALIAS = {
  machines: { other: ['machines'] },
  items: { other: ['structures'] }
}
function filterSubgroup(category, subgroup, source) {
  const extra = SUBGROUP_ALIAS[category]?.[subgroup] || []
  return source.filter(r => r.group === subgroup || extra.includes(r.group))
}

function categoryHtml(category, subgroup) {
  const group = categoryGroups.find(g => g.id === category)
  const subgroups = categorySubgroups[category] || []
  const source = category === 'recipes' ? recipes : entries.filter(e => e.href.startsWith(`/linsmagic/atlas/${category}/`))
  const rows = subgroup ? filterSubgroup(category, subgroup, source) : source
  categoryRows = rows
  categorySourceCount = source.length
  categorySubCounts = {}
  subgroups.forEach(s => { categorySubCounts[s.id] = filterSubgroup(category, s.id, source).length })
  categoryFilter = ''
  categoryPage = 1

  const subNav = subgroups.length ? `
    <nav class="lm-chips" aria-label="子分类">
      <a class="lm-chip${subgroup ? '' : ' is-active'}" href="#content/${category}">全部 <small>${source.length}</small></a>
      ${subgroups.map(s => `
        <a class="lm-chip${s.id === subgroup ? ' is-active' : ''}" href="#content/${category}/${encodeURIComponent(s.id)}">
          ${s.title} <small>${categorySubCounts[s.id]}</small>
        </a>`).join('')}
    </nav>` : ''

  return `
    <div class="lm-collection">
      <header class="lm-collection-head">
        <div>
          <span class="lm-eyebrow">COLLECTION</span>
          <h1 class="lm-title">${group?.title || ''}</h1>
          <p class="lm-intro">${group?.description || ''}${subgroup ? ` 当前查看「${subgroups.find(s => s.id === subgroup)?.title || ''}」。` : ''}</p>
        </div>
        <div class="lm-collection-count"><strong>${source.length}</strong><span>收录项</span></div>
      </header>
      ${subNav}
      <div class="lm-cat-toolbar">
        <form class="lm-category-search" data-role="cat-search">
          <span aria-hidden="true">⌕</span><input type="search" placeholder="在本分类中搜索…" aria-label="搜索">
        </form>
        <span class="lm-cat-count" data-role="cat-count"></span>
      </div>
      <div class="lm-record-grid" data-role="cat-list"></div>
      <div class="lm-pagination" data-role="cat-pager"></div>
    </div>`
}

function renderRows(rows) {
  return rows.map(r => {
    const isRecipe = 'result' in r
    const first = (r.result || [])[0]
    const id = isRecipe ? first?.id : r.id
    const href = r.href.replace(/\/linsmagic\/atlas/, ROOT)
    const summary = isRecipe
      ? `${r.station}${r.guiOnly ? ' · 专用界面' : ''} · ${(r.result || []).filter(x => x).map(x => nameOf(x.id)).join('、')}`
      : (r.description || r.obtain || '')
    return `
      <a href="${href}" class="lm-record" data-id="${id || r.id}">
        ${iconHtml(isRecipe ? id : r.id, isRecipe ? '' : r.icon, 48)}
        <span class="lm-record-body"><strong>${r.name}</strong><small>${summary || '查看资料'}</small></span>
        <span class="lm-record-arrow" aria-hidden="true">↗</span>
      </a>`
  }).join('') || '<p class="lm-muted lm-empty">没有匹配内容。</p>'
}

// 九宫格配方（slots 为 9 格，可能含 null）
function recipeGridHtml(r) {
  const slots = r.slots || []
  if (r.type === 'crafting' || slots.length) {
    return `<div class="lm-recipe-grid">${slots.map(s => s
      ? `<a class="lm-recipe-slot" href="${hrefOf(s.id)}" title="${nameOf(s.id)}">${iconHtml(s.id, '', 34)}${s.count > 1 ? `<small>${s.count}</small>` : ''}</a>`
      : `<span class="lm-recipe-slot lm-recipe-empty"></span>`).join('')}</div>`
  }
  const inputs = r.inputs || []
  return `<div class="lm-recipe-inputs">${inputs.map(i =>
    `<a class="lm-recipe-input" href="${hrefOf(i.id)}">${iconHtml(i.id, '', 36)}<span>${nameOf(i.id)} ×${i.count || 1}</span></a>`
  ).join('')}</div>`
}

function recipeCardHtml(r, compact) {
  const outs = (r.result || []).filter(x => x)
  return `
    <div class="lm-recipe${compact ? ' lm-recipe-compact' : ''}">
      <div class="lm-recipe-header">
        <a href="${r.href.replace(/\/linsmagic\/atlas/, ROOT)}">${r.name}</a>
        <span>${r.station}${r.guiOnly ? ' · 专用界面' : ''}</span>
      </div>
      <div class="lm-recipe-content">
        ${recipeGridHtml(r)}
        <span class="lm-recipe-arrow" aria-hidden="true">➜</span>
        <div class="lm-recipe-outputs">${outs.map(o =>
          `<a class="lm-recipe-output" href="${hrefOf(o.id)}">${iconHtml(o.id, '', 48)}<span>${nameOf(o.id)} <small>×${o.count || 1}</small></span></a>`
        ).join('')}</div>
      </div>
      ${r.note ? `<p class="lm-recipe-note">${r.note}</p>` : ''}
    </div>`
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX']

function entryHtml(id) {
  const e = entryById[id]
  if (!e) return `<p class="lm-muted">未找到条目：${id}</p>`
  const madeBy = recipes.filter(r => r.result?.some(x => x && x.id === id))
  const usedIn = recipes.filter(r => (r.slots || r.inputs || []).some(x => x && x.id === id))
  const processing = e.kind === 'machine'
    ? recipes.filter(r => r.type === 'machine' && r.station === e.name)
    : []
  const structure = e.structureId ? structureById[e.structureId] : null

  const jumps = [
    e.levelEffects?.length && '<a href="#等级效果">等级效果</a>',
    (e.obtain || e.details?.length) && '<a href="#资料与获取">资料与获取</a>',
    structure && '<a href="#多方块结构">多方块结构</a>',
    madeBy.length && `<a href="#如何获得">如何获得 (${madeBy.length})</a>`,
    madeBy.length && '<a href="#合成树">合成树</a>',
    processing.length && `<a href="#机器加工">机器加工 (${processing.length})</a>`,
    usedIn.length && `<a href="#作为材料的用途">作为材料的用途 (${usedIn.length})</a>`,
    e.related?.length && `<a href="#相关资料">相关资料 (${e.related.length})</a>`
  ].filter(Boolean).join('')

  const levels = e.levelEffects?.length ? `
    <section><h2 id="等级效果">等级效果</h2>
      <div class="lm-enchant-levels">
        ${e.levelEffects.map((eff, i) => `<div class="lm-enchant-level"><strong>${ROMAN[i] || (i + 1)} 级</strong><span>${eff}</span></div>`).join('')}
      </div>
    </section>` : ''

  const info = (e.obtain || e.details?.length) ? `
    <section><h2 id="资料与获取">资料与获取</h2>
      ${e.obtain ? `<p class="lm-obtain"><strong>获取方式</strong>${e.obtain}</p>` : ''}
      ${e.details?.length ? `<ul>${e.details.map(d => `<li>${d}</li>`).join('')}</ul>` : ''}
    </section>` : ''

  const structBlock = structure ? `
    <section><h2 id="多方块结构">多方块结构</h2>${structureHtml(structure.id)}</section>` : ''

  const madeByBlock = madeBy.length ? `
    <section><h2 id="如何获得">如何获得 <small>${madeBy.length} 种配方</small></h2>
      <div class="lm-stack">${madeBy.slice(0, 6).map(r => recipeCardHtml(r)).join('')}</div>
      ${madeBy.length > 6 ? `<button class="lm-more" type="button" data-more="madeby">展开全部 ${madeBy.length} 种配方</button>
      <div class="lm-stack" data-hidden="madeby" hidden>${madeBy.slice(6).map(r => recipeCardHtml(r)).join('')}</div>` : ''}
    </section>` : ''

  const treeBlock = madeBy.length ? `
    <section><h2 id="合成树">合成树</h2>${craftTreeHtml(id)}</section>` : ''

  const processingBlock = processing.length ? `
    <section><h2 id="机器加工">机器加工</h2>
      <div class="lm-stack">${processing.map(r => recipeCardHtml(r)).join('')}</div>
    </section>` : ''

  const usedBlock = usedIn.length ? `
    <section><h2 id="作为材料的用途">作为材料的用途 <small>${usedIn.length} 种配方</small></h2>
      <div class="lm-link-list">${usedIn.slice(0, 24).map(r => {
        const first = (r.result || [])[0]
        return `<a href="${r.href.replace(/\/linsmagic\/atlas/, ROOT)}">
          ${iconHtml(first?.id, '', 40)}
          <span><strong>${nameOf(first?.id)}</strong><small>${r.station} · ${r.name}</small></span>
          <span aria-hidden="true">↗</span></a>`
      }).join('')}</div>
      ${usedIn.length > 24 ? `<button class="lm-more" type="button" data-more="usedin">展开全部 ${usedIn.length} 种用途</button>
      <div class="lm-link-list" data-hidden="usedin" hidden>${usedIn.slice(24).map(r => {
        const first = (r.result || [])[0]
        return `<a href="${r.href.replace(/\/linsmagic\/atlas/, ROOT)}">
          ${iconHtml(first?.id, '', 40)}
          <span><strong>${nameOf(first?.id)}</strong><small>${r.station} · ${r.name}</small></span>
          <span aria-hidden="true">↗</span></a>`
      }).join('')}</div>` : ''}
    </section>` : ''

  const relatedBlock = e.related?.length ? `
    <section><h2 id="相关资料">相关资料 <small>${e.related.length} 项</small></h2>
      <div class="lm-related">${e.related.map(rid =>
        `<a href="${hrefOf(rid)}">${iconHtml(rid, '', 32)}${nameOf(rid)} <span aria-hidden="true">↗</span></a>`
      ).join('')}</div>
    </section>` : ''

  return `
    <div class="lm-entry">
      <div class="lm-entry-lead">
        <div class="lm-entry-icon">${iconHtml(e.id, e.icon, 96)}</div>
        <div class="lm-entry-copy">
          <span class="lm-eyebrow">ENTRY / ${entryCategoryTitle(e.id)}</span>
          <h1>${e.name}${e.glint ? ' <span class="lm-glint">✦</span>' : ''}</h1>
          <p>${e.description || '查看物品的获取、用途和关联资料。'}</p>
          <div class="lm-entry-tags">
            ${e.kind ? `<span>${e.kind}</span>` : ''}
            ${e.obtain ? `<span>${e.obtain}</span>` : ''}
            ${madeBy.length ? `<span>${madeBy.length} 种获得方式</span>` : ''}
            ${usedIn.length ? `<span>${usedIn.length} 种用途</span>` : ''}
          </div>
        </div>
      </div>
      ${jumps ? `<nav class="lm-entry-jumps" aria-label="本页章节">${jumps}</nav>` : ''}
      ${levels}${info}${structBlock}${madeByBlock}${treeBlock}${processingBlock}${usedBlock}${relatedBlock}
    </div>`
}

// 简化合成树：递归展开材料，只展示两级（避免组合爆炸）
function craftTreeHtml(id, depth = 0, seen = new Set()) {
  if (depth > 2 || seen.has(id)) return ''
  seen.add(id)
  const made = recipes.filter(r => r.result?.some(x => x && x.id === id))
  if (!made.length) return ''
  const r = made[0]
  const ings = (r.slots || r.inputs || []).filter(x => x)
  return `<ul class="lm-tree">
    ${ings.map(ing => {
      const sub = craftTreeHtml(ing.id, depth + 1, new Set(seen))
      return `<li>
        <a href="${hrefOf(ing.id)}">${iconHtml(ing.id, '', 32)}<span>${nameOf(ing.id)}</span><small>×${ing.count || 1}</small></a>
        ${sub}
      </li>`
    }).join('')}
  </ul>`
}

function structureHtml(id) {
  const s = structureById[id]
  if (!s) return `<p class="lm-muted">未找到结构：${id}</p>`
  const layers = s.variants.map((blocks, vi) => {
    const ys = [...new Set(blocks.map(b => b.y))]
    const xs = blocks.map(b => b.x), zs = blocks.map(b => b.z)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minZ = Math.min(...zs), maxZ = Math.max(...zs)
    const grids = ys.map(y => {
      let cells = ''
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          const b = blocks.find(o => o.x === x && o.y === y && o.z === z)
          const blockId = b && /^minecraft:[a-z0-9_]+$/.test(String(b.id)) && b.id !== 'minecraft:air'
            ? String(b.id).replace('minecraft:', '') : ''
          cells += b
            ? `<span class="lm-struct-cell"${blockId ? ` data-block="${blockId}"` : ''} title="${b.name}${b.description ? ' · ' + b.description : ''}">${iconHtml(b.id, b.texture, 30)}</span>`
            : `<span class="lm-struct-cell lm-struct-empty"></span>`
        }
      }
      return `<figure class="lm-struct-layer">
        <figcaption>Y = ${y}</figcaption>
        <div class="lm-struct-grid" style="--cols:${maxX - minX + 1}">${cells}</div>
      </figure>`
    }).join('')
    return `<div class="lm-struct-variant">${s.variants.length > 1 ? `<h3>变体 ${vi + 1}</h3>` : ''}${grids}</div>`
  }).join('')
  const tabs = s.variants.length > 1
    ? `<div class="lm-3d-tabs" data-3dtabs>${s.variants.map((_, vi) =>
        `<button type="button" class="lm-3d-tab${vi === 0 ? ' is-active' : ''}" data-3dvariant="${vi}">变体 ${vi + 1}</button>`
      ).join('')}</div>`
    : ''
  return `<div class="lm-structure" data-struct="${s.id}"><p class="lm-struct-name">${s.name}${s.note ? ` · ${s.note}` : ''}</p>
    <div class="lm-struct-actions">
      <button class="lm-btn3d" type="button" data-3d="${s.id}">打开 3D 视图</button>
      <span class="lm-muted">网格模式下悬停方块可查看名称与说明</span>
    </div>
    <div class="lm-3d-holder" data-3dholder="${s.id}" hidden>
      <div class="lm-3d-bar">${tabs}
        <div class="lm-3d-tools">
          <button type="button" class="lm-3d-tool" data-3dreset>重置视角</button>
          <span class="lm-3d-hint">拖动旋转 · 滚轮缩放</span>
        </div>
      </div>
      <div class="lm-3d-mount" data-3dmount></div>
      <div class="lm-3d-status" data-3dstatus hidden></div>
    </div>${layers}</div>`
}

function recipeHtml(id) {
  const r = recipeById[id]
  if (!r) return `<p class="lm-muted">未找到配方：${id}</p>`
  return `<article class="lm-entry lm-recipe-page">
    <span class="lm-eyebrow">RECIPE / ${r.station}</span>
    <h1>${r.name}</h1>
    <p class="lm-intro">工作站：${r.station}${r.guiOnly ? ' · 专用界面' : ''}</p>
    ${recipeCardHtml(r)}
    ${r.note ? `<p class="lm-recipe-note">${r.note}</p>` : ''}
    <section><h2>产物</h2><div class="lm-related">${(r.result || []).filter(x => x).map(x =>
      `<a href="${hrefOf(x.id)}">${iconHtml(x.id, '', 40)}${nameOf(x.id)} ×${x.count || 1} <span aria-hidden="true">↗</span></a>`
    ).join('')}</div></section>
  </article>`
}

// ===== 自定义元素补全（教程正文里的 lm-item / lm-recipe 等）=====
function hydrate(el) {
  el.querySelectorAll('lm-item').forEach(node => {
    const raw = node.getAttribute('id') || ''
    const entry = entryByName[raw] || entryById[raw]
    const label = node.getAttribute('label') || entry?.name || raw
    const href = entry ? entry.href.replace(/\/linsmagic\/atlas/, ROOT) : ROOT
    node.outerHTML = `<a class="lm-inline-item" href="${href}">${iconHtml(entry?.id, entry?.icon, 20)}<span>${label}</span></a>`
  })
  el.querySelectorAll('lm-recipe').forEach(node => {
    const r = recipeById[node.getAttribute('id')]
    node.outerHTML = r ? recipeCardHtml(r, true) : ''
  })
  el.querySelectorAll('lm-structure').forEach(node => {
    node.outerHTML = structureHtml(node.getAttribute('id'))
  })
  el.querySelectorAll('lm-scene').forEach(node => {
    node.outerHTML = `<div class="lm-scene-placeholder">
      <strong>3D 结构演示</strong>
      <span>该交互场景（${node.getAttribute('id')}）需在重做组件后补齐，可先参考下方文字说明。</span></div>`
  })
  el.querySelectorAll('lm-roadmap').forEach(node => {
    let steps = []
    try { steps = JSON.parse(node.getAttribute('steps') || '[]') } catch (e) { steps = [] }
    node.outerHTML = `<div class="lm-roadmap">${steps.map((s, i) => `
      <a class="lm-roadmap-step" href="${s.href || '#'}">
        <span class="lm-roadmap-index">${s.stage || `第 ${i + 1} 步`}</span>
        <span class="lm-roadmap-body"><strong>${s.title || ''}</strong><small>${s.detail || ''}</small></span>
      </a>`).join('')}</div>`
  })
  el.querySelectorAll('lm-guide').forEach(node => {
    const list = node.getAttribute('mode') === 'systems' ? systemList : guideList
    node.outerHTML = `<div class="lm-folder-grid">${list.map(g => folderCard(`#content/${g.slug}`, g.icon, g.title, g.detail)).join('')}</div>`
  })
}

// ===== 应用 =====
let container = null
let currentRoute = parseHash(location.hash)
let mc3dMod = null
let firstRender = true
let categoryRows = []
let categorySubCounts = {}
let categorySourceCount = 0
let categoryFilter = ''
let categoryPage = 1
let searchSel = -1
let searchList = []
let searchIndexCache = null
const CAT_PAGE_SIZE = 30
const getMc3d = () => (mc3dMod || (mc3dMod = import('./mc3d.js?v=14').catch(e => { mc3dMod = null; throw e })))
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// 结构网格里的原版方块：3D 场景打开后把 2D 贴图逐个换成真 3D 缩略图
// （此时库与资源已预热，串行渲染避免同一帧堆积；模型缺失就保留原贴图）
async function upgradeGridThumbs(mc3d, root, structId) {
  const wrap = root.querySelector(`[data-struct="${CSS.escape(structId)}"]`)
  if (!wrap) return
  const cells = Array.from(wrap.querySelectorAll('.lm-struct-cell[data-block]')).slice(0, 18)
  for (const cell of cells) {
    if (cell.dataset.thumb) continue
    cell.dataset.thumb = '1'
    try {
      const canvas = await mc3d.renderThumb(cell.dataset.block, 32)
      if (!canvas) continue
      canvas.className = 'lm-cell3d'
      cell.replaceChildren(canvas)
    } catch (e) { /* 保留 2D 贴图 */ }
  }
}

// ===== 壳层：左索引 / 中内容 / 右本页目录 =====
function navKeys() {
  const keys = new Set()
  const r = currentRoute
  if (r.kind === 'home') keys.add('home')
  else if (r.kind === 'category') keys.add('cat:' + r.category)
  else if (r.kind === 'page') {
    keys.add('page:' + r.slug)
    if (r.slug.startsWith('tutorials/systems')) keys.add('page:tutorials/systems')
    if (r.slug.startsWith('guide/')) keys.add('page:guide')
  } else if (r.kind === 'entry') {
    const cat = entryCategoryId(r.id)
    if (cat) keys.add('cat:' + cat)
  } else if (r.kind === 'recipe') {
    keys.add('cat:recipes')
  }
  return keys
}

function navLink(href, label, key, icon, small) {
  const on = navKeys().has(key)
  return `<a href="${href}" class="lm-nav-link${on ? ' is-active' : ''}">
    ${icon ? iconHtml(null, icon, 18) : '<span class="lm-nav-dot" aria-hidden="true"></span>'}
    <span class="lm-nav-label">${label}</span>
    ${small ? `<small>${small}</small>` : ''}
  </a>`
}

function navHtml() {
  const startLinks = [
    navLink('#content', '总览', 'home', 'item/book'),
    navLink('#content/tutorials/new-player', '新手路线', 'page:tutorials/new-player', 'item/knowledge_book'),
    navLink('#content/tutorials/systems', '系统教程', 'page:tutorials/systems', 'block/chiseled_copper'),
    navLink('#content/guide', '玩法指南', 'page:guide', 'item/written_book')
  ].join('')
  const catLinks = categoryGroups.map(g =>
    navLink(`#content/${g.id}`, g.title, 'cat:' + g.id, g.icon, countEntries(g.id))
  ).join('')
  const systemLinks = systemList.map(g =>
    navLink(`#content/${g.slug}`, g.title, 'page:' + g.slug, g.icon)
  ).join('')
  const guideLinks = guideList.map(g =>
    navLink(`#content/${g.slug}`, g.title, 'page:' + g.slug, g.icon)
  ).join('')
  return `
    <div class="lm-nav-group"><div class="lm-nav-title">开始</div>${startLinks}</div>
    <div class="lm-nav-group"><div class="lm-nav-title">资料分类</div>${catLinks}</div>
    <div class="lm-nav-group"><div class="lm-nav-title">系统教程 <small>${systemList.length}</small></div>${systemLinks}</div>
    <div class="lm-nav-group"><div class="lm-nav-title">玩法指南 <small>${guideList.length}</small></div>${guideLinks}</div>`
}

function routeMeta() {
  const base = { label: '百科', href: '#content' }
  const r = currentRoute
  if (r.kind === 'entry') {
    const e = entryById[r.id]
    return {
      title: e?.name || r.id,
      crumbs: [base, { label: entryCategoryTitle(r.id), href: '#content/' + entryCategoryId(r.id) }, { label: e?.name || r.id }]
    }
  }
  if (r.kind === 'recipe') {
    const rec = recipeById[r.id]
    return {
      title: rec?.name || r.id,
      crumbs: [base, { label: '配方', href: '#content/recipes' }, { label: rec?.name || r.id }]
    }
  }
  if (r.kind === 'page') {
    const slug = r.slug
    const title = pageTitle(slug)
    if (slug === 'guide') return { title, crumbs: [base, { label: '玩法指南' }] }
    if (slug.startsWith('guide/')) return { title, crumbs: [base, { label: '玩法指南', href: '#content/guide' }, { label: title }] }
    if (slug === 'tutorials/systems') return { title, crumbs: [base, { label: '系统教程' }] }
    if (slug.startsWith('tutorials/systems/')) return { title, crumbs: [base, { label: '系统教程', href: '#content/tutorials/systems' }, { label: title }] }
    return { title, crumbs: [base, { label: title }] }
  }
  if (r.kind === 'category') {
    const group = categoryGroups.find(g => g.id === r.category)
    const subs = categorySubgroups[r.category] || []
    const crumbs = [base, { label: group?.title || r.category, href: `#content/${r.category}` }]
    if (r.subgroup) crumbs.push({ label: subs.find(s => s.id === r.subgroup)?.title || r.subgroup })
    return { title: group?.title || r.category, crumbs }
  }
  return { title: '总览', crumbs: [base, { label: '总览' }] }
}

function crumbsHtml(crumbs) {
  return crumbs.map((c, i) => {
    const last = i === crumbs.length - 1
    if (last) return `<b>${c.label}</b>`
    const node = c.href ? `<a href="${c.href}">${c.label}</a>` : `<span>${c.label}</span>`
    return node + '<i aria-hidden="true">/</i>'
  }).join('')
}

function searchLayerHtml() {
  return `<div class="lm-search-layer" data-role="search-layer" aria-hidden="true">
    <div class="lm-search-panel" role="dialog" aria-modal="true" aria-label="搜索百科">
      <div class="lm-search-bar">
        <span class="lm-search-mark" aria-hidden="true">⌕</span>
        <input type="search" data-role="search-input" placeholder="搜索物品、配方、教程…" aria-label="搜索百科" autocomplete="off" spellcheck="false">
        <kbd>ESC</kbd>
      </div>
      <div class="lm-search-results" data-role="search-results"></div>
      <div class="lm-search-hint"><span>↑ ↓ 选择</span><span>Enter 打开</span><span>Esc 关闭</span></div>
    </div>
  </div>`
}

function shellHtml(html) {
  const meta = routeMeta()
  return `<div class="lm-root" data-kind="${currentRoute.kind}">
    <aside class="lm-side">
      <div class="lm-side-head">
        <span class="lm-side-eyebrow">ATLAS / INDEX</span>
        <button type="button" class="lm-search-trigger" data-role="open-search">
          <span aria-hidden="true">⌕</span><span>搜索全站</span><kbd>/</kbd>
        </button>
      </div>
      <nav class="lm-nav" aria-label="百科索引">${navHtml()}</nav>
      <div class="lm-side-foot"><span>${entries.length} 资料</span><span>${recipes.length} 配方</span></div>
    </aside>
    <main class="lm-main">
      <div class="lm-main-bar">
        <button type="button" class="lm-nav-toggle" data-role="toggle-nav" aria-label="打开索引">目录</button>
        <nav class="lm-crumbs" aria-label="位置">${crumbsHtml(meta.crumbs)}</nav>
        <div class="lm-main-tools">
          <button type="button" class="lm-tool lm-tool-search" data-role="open-search" title="搜索全站（/）" aria-label="搜索全站">⌕</button>
          <button type="button" class="lm-tool" data-role="copy-link">复制链接</button>
        </div>
        <div class="lm-progress" aria-hidden="true"><i data-role="progress"></i></div>
      </div>
      <div class="lm-main-scroll" data-role="main-scroll">
        <div class="lm-main-inner">${html}</div>
        <div class="lm-footline"><span>LINSMAGIC · ATLAS</span><span>${meta.title}</span></div>
      </div>
      <button type="button" class="lm-topbtn" data-role="to-top" aria-label="回到顶部">↑</button>
    </main>
    <aside class="lm-rail" data-role="rail" aria-label="本页目录"><div class="lm-rail-inner" data-role="rail-body"></div></aside>
    <div class="lm-nav-scrim" data-role="nav-scrim"></div>
    ${searchLayerHtml()}
  </div>`
}

// ===== 右栏 =====
function railStatsHtml() {
  return `<div class="lm-rail-stats">
    <div><strong>${entries.length}</strong><span>资料</span></div>
    <div><strong>${recipes.length}</strong><span>配方</span></div>
    <div><strong>${structures.length}</strong><span>结构</span></div>
    <div><strong>${categoryGroups.length}</strong><span>分类</span></div>
  </div>`
}

function railInfoHtml() {
  const r = currentRoute
  if (r.kind === 'category') {
    const subs = categorySubgroups[r.category] || []
    const subLinks = subs.length ? `<div class="lm-rail-block">
      <div class="lm-rail-title"><span>子分类</span><small>${subs.length}</small></div>
      <div class="lm-rail-links">
        ${subs.map(s => `<a href="#content/${r.category}/${encodeURIComponent(s.id)}" class="${s.id === r.subgroup ? 'is-active' : ''}">${s.title}<small>${categorySubCounts[s.id] || 0}</small></a>`).join('')}
      </div></div>` : ''
    return `<div class="lm-rail-block">
      <div class="lm-rail-title"><span>分类信息</span></div>
      <div class="lm-rail-kv"><div><span>全部收录</span><b>${categorySourceCount}</b></div>
      <div><span>当前视图</span><b>${categoryRows.length}</b></div>
      <div><span>每页</span><b>${CAT_PAGE_SIZE}</b></div></div>
    </div>${subLinks}
    <div class="lm-rail-block"><button type="button" class="lm-rail-action" data-role="random-entry">随机抽一条资料 <span aria-hidden="true">↯</span></button></div>`
  }
  if (r.kind === 'entry') {
    const e = entryById[r.id]
    const madeBy = recipes.filter(x => x.result?.some(o => o && o.id === r.id)).length
    const usedIn = recipes.filter(x => (x.slots || x.inputs || []).some(o => o && o.id === r.id)).length
    return `<div class="lm-rail-block">
      <div class="lm-rail-title"><span>资料</span></div>
      <div class="lm-rail-kv">
        <div><span>归类</span><b>${entryCategoryTitle(r.id)}</b></div>
        ${e?.kind ? `<div><span>类型</span><b>${e.kind}</b></div>` : ''}
        <div><span>获得方式</span><b>${madeBy}</b></div>
        <div><span>材料用途</span><b>${usedIn}</b></div>
      </div>
    </div>
    <div class="lm-rail-block"><button type="button" class="lm-rail-action" data-role="random-entry">随机抽一条资料 <span aria-hidden="true">↯</span></button></div>`
  }
  if (r.kind === 'recipe') {
    const rec = recipeById[r.id]
    return `<div class="lm-rail-block">
      <div class="lm-rail-title"><span>配方信息</span></div>
      <div class="lm-rail-kv">
        <div><span>工作站</span><b>${rec?.station || '—'}</b></div>
        <div><span>产物</span><b>${(rec?.result || []).filter(Boolean).length}</b></div>
        ${rec?.guiOnly ? '<div><span>界面</span><b>专用</b></div>' : ''}
      </div>
    </div>`
  }
  if (r.kind === 'page') {
    const slug = r.slug
    const parent = slug.startsWith('guide/') ? { label: '玩法指南', href: '#content/guide' }
      : slug.startsWith('tutorials/systems/') ? { label: '系统教程', href: '#content/tutorials/systems' } : null
    return `<div class="lm-rail-block">
      <div class="lm-rail-title"><span>阅读信息</span></div>
      <div class="lm-rail-kv">
        ${parent ? `<div><span>所属</span><b><a href="${parent.href}">${parent.label}</a></b></div>` : ''}
        <div><span>页面</span><b>${pageTitle(slug)}</b></div>
      </div>
      ${parent ? '' : `<div class="lm-rail-links lm-rail-links-plain">
        <a href="#content/tutorials/systems">系统教程 <small>${systemList.length}</small></a>
        <a href="#content/guide">玩法指南 <small>${guideList.length}</small></a>
      </div>`}
    </div>`
  }
  return `<div class="lm-rail-block">
    <div class="lm-rail-title"><span>档案</span></div>
    ${railStatsHtml()}
  </div>
  <div class="lm-rail-block">
    <div class="lm-rail-title"><span>快速开始</span></div>
    <div class="lm-rail-links lm-rail-links-plain">
      <a href="#content/tutorials/new-player">新手路线 <small>8 步</small></a>
      <a href="#content/tutorials/systems">系统教程 <small>${systemList.length}</small></a>
      <a href="#content/guide">玩法指南 <small>${guideList.length}</small></a>
    </div>
  </div>
  <div class="lm-rail-block"><button type="button" class="lm-rail-action" data-role="random-entry">随机抽一条资料 <span aria-hidden="true">↯</span></button></div>`
}

function headingLabel(h) {
  const copy = h.cloneNode(true)
  copy.querySelectorAll('small').forEach(n => n.remove())
  return copy.textContent.replace(/\s+/g, ' ').trim()
}

function buildRail() {
  const body = container.querySelector('[data-role="rail-body"]')
  const inner = container.querySelector('.lm-main-inner')
  if (!body || !inner) return
  const heads = Array.from(inner.querySelectorAll('h2')).filter(h => headingLabel(h))
  heads.forEach((h, i) => { if (!h.id) h.id = 'lm-sec-' + (i + 1) })
  const toc = heads.length ? `<div class="lm-rail-block">
    <div class="lm-rail-title"><span>本页目录</span><small>${heads.length}</small></div>
    <nav class="lm-toc">${heads.map(h => `<a href="#${encodeURIComponent(h.id)}" data-target="${esc(h.id)}">${esc(headingLabel(h))}</a>`).join('')}</nav>
  </div>` : ''
  body.innerHTML = toc + railInfoHtml()

  body.querySelectorAll('.lm-toc a').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault()
      const target = container.querySelector('#' + CSS.escape(a.dataset.target))
      const scroller = container.querySelector('[data-role="main-scroll"]')
      if (!target || !scroller) return
      const top = scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12
      scroller.scrollTo({ top, behavior: 'smooth' })
    })
  })
}

// ===== 滚动跟随 =====
function setupScroll() {
  const scroller = container.querySelector('[data-role="main-scroll"]')
  if (!scroller) return
  const progress = container.querySelector('[data-role="progress"]')
  const toTop = container.querySelector('[data-role="to-top"]')
  const links = Array.from(container.querySelectorAll('.lm-toc a'))
  const heads = links.map(a => container.querySelector('#' + CSS.escape(a.dataset.target))).filter(Boolean)
  let raf = 0
  const update = () => {
    raf = 0
    const st = scroller.scrollTop
    const max = scroller.scrollHeight - scroller.clientHeight
    if (progress) progress.style.width = (max > 0 ? Math.min(100, st / max * 100) : 0) + '%'
    if (toTop) toTop.classList.toggle('on', st > 360)
    if (heads.length) {
      const base = scroller.getBoundingClientRect().top
      let active = heads[0]
      for (const h of heads) {
        if (h.getBoundingClientRect().top - base <= 64) active = h
        else break
      }
      links.forEach(a => a.classList.toggle('is-active', a.dataset.target === active.id))
    }
  }
  scroller.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(update) }, { passive: true })
  update()
}

// ===== 全局搜索 =====
function globalIndex() {
  if (searchIndexCache) return searchIndexCache
  const out = [{ name: '总览', detail: '百科首页', href: '#content', icon: 'item/book', kind: 0 }]
  categoryGroups.forEach(g => out.push({ name: g.title, detail: '资料分类 · ' + (g.description || ''), href: `#content/${g.id}`, icon: g.icon, kind: 0 }))
  ;[...systemList, ...guideList].forEach(g => out.push({ name: g.title, detail: '教程 · ' + (g.detail || ''), href: `#content/${g.slug}`, icon: g.icon, kind: 0 }))
  entries.forEach(e => out.push({ name: e.name, detail: e.category || '', href: e.href.replace(/\/linsmagic\/atlas/, ROOT), icon: e.icon, kind: 1 }))
  recipes.forEach(r => {
    const first = (r.result || [])[0]
    out.push({
      name: r.name,
      detail: (r.station || '') + (r.guiOnly ? ' · 专用界面' : ''),
      href: r.href.replace(/\/linsmagic\/atlas/, ROOT),
      icon: entryById[first?.id]?.icon || 'item/crafting_table',
      kind: 2
    })
  })
  searchIndexCache = out
  return out
}

function searchWiki(q, limit) {
  const list = globalIndex()
  if (!q) return list.filter(it => it.kind === 0).slice(0, 24)
  const s = q.toLocaleLowerCase('zh-CN')
  const scored = []
  for (let i = 0; i < list.length; i++) {
    const it = list[i]
    const name = it.name.toLocaleLowerCase('zh-CN')
    const pos = name.indexOf(s)
    if (pos < 0 && !String(it.detail || '').toLocaleLowerCase('zh-CN').includes(s)) continue
    const score = (pos === 0 ? 0 : pos > 0 ? 1 : 2) + it.kind * 0.25
    scored.push([score, it])
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].name.length - b[1].name.length)
  return scored.slice(0, limit || 60).map(x => x[1])
}

function searchItemHtml(it, i, sel) {
  const kind = it.kind === 2 ? '配方' : it.kind === 1 ? '资料' : '页面'
  return `<a class="lm-search-item${sel ? ' is-sel' : ''}" href="${it.href}" data-i="${i}">
    ${iconHtml(null, it.icon || 'item/book', 30)}
    <span class="lm-search-body"><strong>${it.name}</strong><small>${it.detail || ''}</small></span>
    <span class="lm-search-kind">${kind}</span>
  </a>`
}

function setSearchSel(i) {
  const results = container.querySelector('[data-role="search-results"]')
  if (!results) return
  const items = Array.from(results.querySelectorAll('.lm-search-item'))
  searchSel = Math.max(0, Math.min(items.length - 1, i))
  items.forEach((a, idx) => a.classList.toggle('is-sel', idx === searchSel))
  const active = items[searchSel]
  if (active) active.scrollIntoView({ block: 'nearest' })
}

function paintSearch(q) {
  const results = container.querySelector('[data-role="search-results"]')
  if (!results) return
  searchList = searchWiki(q, 60)
  searchSel = searchList.length ? 0 : -1
  results.innerHTML = searchList.length
    ? searchList.map((it, i) => searchItemHtml(it, i, i === 0)).join('')
    : `<p class="lm-muted lm-empty">没有找到「${esc(q)}」。</p>`
  results.querySelectorAll('.lm-search-item').forEach(a => {
    a.addEventListener('mouseenter', () => setSearchSel(Number(a.dataset.i)))
  })
}

function openSearch() {
  const layer = container && container.querySelector('[data-role="search-layer"]')
  if (!layer) return
  layer.classList.add('is-open')
  layer.setAttribute('aria-hidden', 'false')
  const input = layer.querySelector('[data-role="search-input"]')
  if (input) {
    input.value = ''
    paintSearch('')
    setTimeout(() => input.focus(), 40)
  }
}

function closeSearch() {
  const layer = container && container.querySelector('[data-role="search-layer"]')
  if (!layer || !layer.classList.contains('is-open')) return
  layer.classList.remove('is-open')
  layer.setAttribute('aria-hidden', 'true')
}

// ===== 事件 =====
function bindHomeSearch() {
  const homeForm = container.querySelector('[data-role="home-search"]')
  if (!homeForm) return
  const input = homeForm.querySelector('input')
  const box = container.querySelector('[data-role="home-results"]')
  const run = () => {
    const q = input.value.trim()
    if (!q) { box.hidden = true; box.innerHTML = ''; return }
    const list = searchWiki(q, 40).filter(it => it.name !== '总览')
    box.hidden = false
    box.innerHTML = list.length
      ? `<p class="lm-result-meta">找到 ${list.length} 项${list.length >= 40 ? '（仅显示前 40 项）' : ''}</p>
        <div class="lm-inline-results">${list.map(it => `<a class="lm-inline-result" href="${it.href}">
          ${iconHtml(null, it.icon || 'item/book', 26)}
          <span><strong>${it.name}</strong><small>${it.detail || ''}</small></span>
          <em>${it.kind === 2 ? '配方' : it.kind === 1 ? '资料' : '页面'}</em>
        </a>`).join('')}</div>`
      : `<p class="lm-muted lm-empty">没有找到「${esc(q)}」。</p>`
  }
  input.addEventListener('input', run)
  homeForm.addEventListener('submit', e => {
    e.preventDefault()
    const a = box.querySelector('a')
    if (a) location.hash = a.getAttribute('href')
  })
}

function bindCategory() {
  const list = container.querySelector('[data-role="cat-list"]')
  if (!list) return
  const input = container.querySelector('[data-role="cat-search"] input')
  const pager = container.querySelector('[data-role="cat-pager"]')
  const countEl = container.querySelector('[data-role="cat-count"]')
  const scroller = container.querySelector('[data-role="main-scroll"]')

  const paint = () => {
    const q = categoryFilter
    const filtered = q
      ? categoryRows.filter(r => `${r.name} ${r.description || ''} ${r.obtain || ''} ${r.station || ''}`.toLocaleLowerCase('zh-CN').includes(q))
      : categoryRows
    const pages = Math.max(1, Math.ceil(filtered.length / CAT_PAGE_SIZE))
    if (categoryPage > pages) categoryPage = pages
    const start = (categoryPage - 1) * CAT_PAGE_SIZE
    const pageRows = filtered.slice(start, start + CAT_PAGE_SIZE)
    list.innerHTML = pageRows.length ? renderRows(pageRows) : `<p class="lm-muted lm-empty">没有匹配内容。</p>`
    if (countEl) {
      countEl.textContent = filtered.length
        ? `${start + 1}–${Math.min(filtered.length, start + CAT_PAGE_SIZE)} / 共 ${filtered.length} 项`
        : '共 0 项'
    }
    pager.innerHTML = pages > 1
      ? `<button type="button" data-page="${categoryPage - 1}" ${categoryPage <= 1 ? 'disabled' : ''}>上一页</button>
        <span class="lm-page-info"><b>${categoryPage}</b><i>/</i>${pages}</span>
        <button type="button" data-page="${categoryPage + 1}" ${categoryPage >= pages ? 'disabled' : ''}>下一页</button>`
      : ''
    pager.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = Number(btn.dataset.page)
        if (!next || next === categoryPage || next > pages) return
        categoryPage = next
        paint()
        if (scroller) {
          const top = scroller.scrollTop + list.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16
          scroller.scrollTo({ top, behavior: 'smooth' })
        }
      })
    })
  }

  if (input) input.addEventListener('input', () => {
    categoryFilter = input.value.trim().toLocaleLowerCase('zh-CN')
    categoryPage = 1
    paint()
  })
  paint()
}

function bindMoreButtons() {
  container.querySelectorAll('[data-more]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.more
      const target = container.querySelector(`[data-hidden="${key}"]`)
      if (!target) return
      const open = !target.hasAttribute('hidden')
      target.toggleAttribute('hidden', open)
      btn.textContent = open
        ? (key === 'madeby' ? `展开全部 ${target.children.length} 种配方` : '展开全部')
        : (key === 'madeby' ? '收起配方' : '收起用途')
    })
  })
}

function bindStructure3D() {
  container.querySelectorAll('[data-3d]').forEach(btn => {
    const id = btn.dataset['3d']
    const holder = container.querySelector(`[data-3dholder="${CSS.escape(id)}"]`)
    const struct = structureById[id]
    if (!holder || !struct) return
    const mount = holder.querySelector('[data-3dmount]')
    const status = holder.querySelector('[data-3dstatus]')
    const tabs = holder.querySelector('[data-3dtabs]')
    const resetBtn = holder.querySelector('[data-3dreset]')
    let viewer = null
    let variant = 0
    let busy = false
    let thumbsDone = false

    const say = (text) => {
      if (!status) return
      status.hidden = !text
      status.textContent = text || ''
    }

    const render = async (next) => {
      if (busy) return
      busy = true
      if (viewer) { viewer.dispose(); viewer = null }
      holder.dataset.loaded = ''
      say('正在准备 3D 场景…')
      try {
        const mc3d = await getMc3d()
        viewer = await mc3d.mountStructureViewer(mount, struct, {
          variant: next,
          localTextures: localSet,
          onProgress: say
        })
        say('')
        holder.dataset.loaded = '1'
        holder.dataset.error = ''
        holder.dataset.variant = String(next)
        if (holder.hidden) viewer.pause()
        else btn.textContent = '收起 3D 视图'
        if (tabs) tabs.querySelectorAll('[data-3dvariant]').forEach(t =>
          t.classList.toggle('is-active', Number(t.dataset['3dvariant']) === next))
        if (!thumbsDone) { thumbsDone = true; upgradeGridThumbs(mc3d, container, id) }
      } catch (e) {
        console.warn('[wiki] 3D 视图加载失败:', e)
        say(`3D 视图加载失败：${(e && e.message) || '未知错误'}`)
        holder.dataset.error = '1'
        viewer = null
      } finally {
        busy = false
        btn.disabled = false
      }
    }

    btn.addEventListener('click', () => {
      if (!holder.hidden && holder.dataset.error !== '1') {
        holder.hidden = true
        btn.textContent = '打开 3D 视图'
        if (viewer) viewer.pause()
        return
      }
      holder.hidden = false
      holder.dataset.error = ''
      btn.textContent = '收起 3D 视图'
      if (viewer) { viewer.resume(); return }
      if (busy) return
      btn.disabled = true
      btn.textContent = '3D 加载中…'
      render(variant).then(() => {
        btn.textContent = holder.hidden ? '打开 3D 视图' : (holder.dataset.error ? '重试 3D 视图' : '收起 3D 视图')
      })
    })

    if (tabs) tabs.querySelectorAll('[data-3dvariant]').forEach(tab => {
      tab.addEventListener('click', () => {
        const next = Number(tab.dataset['3dvariant']) || 0
        if (next === variant || busy) return
        variant = next
        render(next)
      })
    })

    if (resetBtn) resetBtn.addEventListener('click', () => { if (viewer) viewer.reset() })
  })
}

function bindInPageAnchors() {
  const inner = container.querySelector('.lm-main-inner')
  const scroller = container.querySelector('[data-role="main-scroll"]')
  if (!inner || !scroller) return
  inner.querySelectorAll('a[href^="#"]').forEach(a => {
    const href = a.getAttribute('href')
    if (href.startsWith('#content')) return
    a.addEventListener('click', e => {
      let id = href.slice(1)
      try { id = decodeURIComponent(id) } catch (err) {}
      if (!id) { e.preventDefault(); return }
      const target = inner.querySelector('#' + CSS.escape(id))
      if (!target) return
      e.preventDefault()
      const top = scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12
      scroller.scrollTo({ top, behavior: 'smooth' })
    })
  })
}

function bindChrome() {
  container.querySelectorAll('[data-role="open-search"]').forEach(btn => {
    btn.addEventListener('click', openSearch)
  })

  const copyBtn = container.querySelector('[data-role="copy-link"]')
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href)
      copyBtn.textContent = '已复制'
    } catch (e) {
      copyBtn.textContent = '复制失败'
    }
    setTimeout(() => { copyBtn.textContent = '复制链接' }, 1300)
  })

  const root = container.querySelector('.lm-root')
  const toggle = container.querySelector('[data-role="toggle-nav"]')
  if (toggle && root) toggle.addEventListener('click', () => root.classList.toggle('nav-open'))
  const scrim = container.querySelector('[data-role="nav-scrim"]')
  if (scrim && root) scrim.addEventListener('click', () => root.classList.remove('nav-open'))
  const nav = container.querySelector('.lm-nav')
  if (nav && root) nav.addEventListener('click', e => { if (e.target.closest('a')) root.classList.remove('nav-open') })

  const toTop = container.querySelector('[data-role="to-top"]')
  const scroller = container.querySelector('[data-role="main-scroll"]')
  if (toTop && scroller) toTop.addEventListener('click', () => scroller.scrollTo({ top: 0, behavior: 'smooth' }))

  container.querySelectorAll('[data-role="random-entry"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pool = entries.filter(e => e.description)
      const pick = pool[Math.floor(Math.random() * pool.length)] || entries[0]
      if (pick) location.hash = pick.href.replace(/\/linsmagic\/atlas/, ROOT)
    })
  })

  const layer = container.querySelector('[data-role="search-layer"]')
  const input = container.querySelector('[data-role="search-input"]')
  if (layer) {
    layer.addEventListener('click', e => {
      if (e.target === layer) closeSearch()
      else if (e.target.closest('.lm-search-item')) closeSearch()
    })
  }
  if (input) {
    input.addEventListener('input', () => paintSearch(input.value.trim()))
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSearchSel(searchSel + 1) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSearchSel(searchSel - 1) }
      else if (e.key === 'Enter') {
        e.preventDefault()
        const a = layer.querySelector('.lm-search-item.is-sel')
        if (a) location.hash = a.getAttribute('href')
      }
    })
  }
}

function bindEvents() {
  bindHomeSearch()
  bindCategory()
  bindMoreButtons()
  bindStructure3D()
  bindInPageAnchors()
  bindChrome()
}

function render() {
  if (!container) return
  // 切换页面前销毁上一页的 3D 场景（释放 WebGL 上下文）
  if (mc3dMod && mc3dMod.then) mc3dMod.then(m => m.destroyAll && m.destroyAll()).catch(() => {})
  categoryRows = []
  categorySubCounts = {}
  categorySourceCount = 0
  categoryFilter = ''
  categoryPage = 1
  let html
  if (currentRoute.kind === 'entry') html = entryHtml(currentRoute.id)
  else if (currentRoute.kind === 'recipe') html = recipeHtml(currentRoute.id)
  else if (currentRoute.kind === 'page') html = pageHtml(currentRoute.slug)
  else if (currentRoute.kind === 'category') html = categoryHtml(currentRoute.category, currentRoute.subgroup)
  else html = homeHtml()

  container.innerHTML = shellHtml(html)
  hydrate(container)
  const inner = container.querySelector('.lm-main-inner')
  inner.querySelectorAll('h2, h3').forEach((h, i) => {
    if (h.id) return
    h.id = 'lm-sec-' + (i + 1)
  })
  bindEvents()
  buildRail()
  setupScroll()

  if (firstRender) {
    container.querySelector('.lm-root')?.classList.add('lm-enter')
    firstRender = false
  }

  const scroller = container.querySelector('[data-role="main-scroll"]')
  if (currentRoute.anchor && scroller) {
    const target = inner.querySelector('#' + CSS.escape(currentRoute.anchor))
    if (target) {
      const top = scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12
      scroller.scrollTop = Math.max(0, top)
      return
    }
  }
  if (scroller) scroller.scrollTop = 0
}

function onHashChange() {
  currentRoute = parseHash(location.hash)
  render()
}

function onGlobalKey(e) {
  if (e.key === 'Escape') { closeSearch(); return }
  const t = e.target
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
  if (!typing && (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'))) {
    e.preventDefault()
    openSearch()
  }
}

export function mountLinsmagic(c) {
  container = c || document.getElementById('lm-app')
  if (!container) {
    container = document.createElement('div')
    container.id = 'lm-app'
    document.body.appendChild(container)
  }
  document.body.classList.add('lm-on')
  currentRoute = parseHash(location.hash)
  firstRender = true
  render()
  window.addEventListener('hashchange', onHashChange)
  document.addEventListener('keydown', onGlobalKey)
  if (!location.hash.startsWith('#content')) {
    try { history.replaceState(null, '', location.pathname + location.search + '#content') } catch (e) {}
  }
}

export function unmountLinsmagic() {
  document.body.classList.remove('lm-on')
  window.removeEventListener('hashchange', onHashChange)
  document.removeEventListener('keydown', onGlobalKey)
  if (container) container.innerHTML = ''
}
