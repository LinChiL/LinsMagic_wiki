// 将 ylg 的 linsmagic md 指南/教程转换为 pages.generated.js
// 用法: node build-pages.mjs
import fs from 'node:fs'
import path from 'node:path'

const SRC = 'F:/pluginweb/ylg/linsmagic/atlas'
const OUT = 'F:/pluginweb/web/js/linsmagic/pages.generated.js'

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ---------- 行内 ----------
function inline(text) {
  let s = text
  // 自定义组件
  s = s.replace(/<LmItem\s+id="([^"]+)"(?:\s+label="([^"]+)")?\s*\/>/g, (_, id, label) =>
    `<lm-item id="${id}"${label ? ` label="${label}"` : ''}></lm-item>`)
  s = s.replace(/<AtlasRecipe\s+id="([^"]+)"\s*\/>/g, (_, id) => `<lm-recipe id="${id}"></lm-recipe>`)
  s = s.replace(/<AtlasStructure\s+id="([^"]+)"\s*\/>/g, (_, id) => `<lm-structure id="${id}"></lm-structure>`)
  s = s.replace(/<LmScene\s+id="([^"]+)"\s*\/>/g, (_, id) => `<lm-scene id="${id}"></lm-scene>`)
  s = s.replace(/<LinsMagicGuide\s*\/>/g, '<lm-guide mode="guides"></lm-guide>')
  s = s.replace(/<LinsMagicGuide\s+mode="([^"]+)"\s*\/>/g, (_, m) => `<lm-guide mode="${m}"></lm-guide>`)
  s = s.replace(/<LmRoadmap[\s\S]*?\/>/g, (m) => `<lm-roadmap steps='${JSON.stringify(parseSteps(m))}'></lm-roadmap>`)

  // 图片 ![alt](src) —— 站内绝对路径(/linsmagic/...)改写为相对页面(/web/html/)的 ../
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) =>
    `<span class="lm-shot"><img src="${src.startsWith('/') ? '..' + src : src}" alt="${alt}" loading="lazy"></span>`)
  // 链接 [text](href)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, href) => `<a href="${fixHref(href)}">${t}</a>`)
  // 行内代码
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${esc(c)}</code>`)
  // 粗体 / 斜体
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  return s
}

function fixHref(href) {
  if (!href.startsWith('/linsmagic/atlas')) return href
  let h = href.replace('/linsmagic/atlas', '#content')
  h = h.replace(/\/$/, '')
  return h || '#content'
}

function parseSteps(tag) {
  const m = tag.match(/:steps="(\[[\s\S]*?\])"/)
  if (!m) return []
  try {
    return Function(`return ${m[1]
      .replace(/([{,]\s*)([a-zA-Z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/'/g, '"')}`)()
  } catch { return [] }
}

// ---------- 块级 ----------
function convert(md) {
  // 去 frontmatter
  const body = md.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  const lines = body.split(/\r?\n/)
  const out = []
  let i = 0
  const stack = []

  const closeP = () => {}

  while (i < lines.length) {
    const raw = lines[i]
    const line = raw.trim()

    // 空行
    if (!line) { i++; continue }

    // 代码块
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const buf = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) { buf.push(lines[i]); i++ }
      i++
      out.push(`<pre class="lm-code"${lang ? ` data-lang="${lang}"` : ''}><code>${esc(buf.join('\n'))}</code></pre>`)
      continue
    }

    // ::: 容器
    if (line.startsWith(':::')) {
      const m = line.match(/^:::\s*(\w+)?\s*(.*)$/)
      if (line === ':::' || /^:::\s*$/.test(line)) {
        // 关闭
        out.push('</div>')
        i++
        continue
      }
      const kind = (m[1] || 'tip').toLowerCase()
      const title = (m[2] || '').trim()
      out.push(`<div class="lm-callout lm-callout-${kind}">${title ? `<p class="lm-callout-title">${inline(title)}</p>` : ''}`)
      i++
      continue
    }

    // 自定义块 div（lm-goal / lm-recipe-row 等）—— 保留标签，内部继续解析
    if (/^<div[\s>]/.test(line)) {
      out.push(inline(line))
      const opens = (line.match(/<div\b/g) || []).length
      const closes = (line.match(/<\/div>/g) || []).length
      for (let k = 0; k < opens - closes; k++) stack.push('div')
      i++
      continue
    }
    if (line.startsWith('</div>')) {
      out.push('</div>')
      stack.pop()
      i++
      continue
    }
    if (line.startsWith('<figure')) {
      const buf = [line]
      i++
      if (!line.includes('</figure>')) {
        while (i < lines.length && !lines[i].includes('</figure>')) { buf.push(lines[i]); i++ }
        if (i < lines.length) { buf.push(lines[i]); i++ }
      }
      out.push(inline(buf.join('\n')))
      continue
    }

    // 标题
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      const level = h[1].length
      let text = h[2]
      let id = ''
      const idm = text.match(/\{#([^}]+)\}\s*$/)
      if (idm) { id = idm[1]; text = text.replace(/\s*\{#[^}]+\}\s*$/, '') }
      out.push(`<h${level}${id ? ` id="${id}"` : ''}>${inline(text)}</h${level}>`)
      i++
      continue
    }

    // 水平线
    if (/^(-{3,}|\*{3,})$/.test(line)) { out.push('<hr>'); i++; continue }

    // 引用
    if (line.startsWith('>')) {
      const buf = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        buf.push(lines[i].trim().replace(/^>\s?/, ''))
        i++
      }
      // [!IMPORTANT] 之类
      const first = buf[0] || ''
      const alert = first.match(/^\[!(\w+)\]$/)
      if (alert) {
        out.push(`<div class="lm-callout lm-callout-${alert[1].toLowerCase()}">`)
        buf.shift()
        for (const b of buf) out.push(`<p>${inline(b)}</p>`)
        out.push('</div>')
      } else {
        out.push(`<blockquote>${buf.map(b => `<p>${inline(b)}</p>`).join('')}</blockquote>`)
      }
      continue
    }

    // 表格
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]+\|/.test(lines[i + 1])) {
      const header = splitRow(line)
      i += 2
      const rows = []
      while (i < lines.length && lines[i].trim().includes('|')) { rows.push(splitRow(lines[i])); i++ }
      out.push(`<div class="lm-table-wrap"><table><thead><tr>${header.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
        rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')
      }</tbody></table></div>`)
      continue
    }

    // 有序列表
    if (/^\d+\.\s/.test(line)) {
      const items = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s/, ''))
        i++
      }
      out.push(`<ol>${items.map(t => `<li>${inline(t)}</li>`).join('')}</ol>`)
      continue
    }

    // 无序列表（含二级缩进）
    if (/^[-*]\s/.test(line)) {
      const items = []
      while (i < lines.length && /^(\s*)[-*]\s/.test(lines[i])) {
        const lead = lines[i].match(/^(\s*)/)[1].length
        const text = lines[i].trim().replace(/^[-*]\s/, '')
        if (lead >= 2 && items.length) items[items.length - 1].sub.push(text)
        else items.push({ text, sub: [] })
        i++
      }
      out.push('<ul>' + items.map(it =>
        `<li>${inline(it.text)}${it.sub.length ? `<ul>${it.sub.map(s => `<li>${inline(s)}</li>`).join('')}</ul>` : ''}</li>`
      ).join('') + '</ul>')
      continue
    }

    // 段落
    const buf = [line]
    i++
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|:::|```|\||>|\d+\.\s|[-*]\s|<div|<\/div|!\[|<figure|(-{3,}))/ .test(lines[i].trim())) {
      buf.push(lines[i].trim())
      i++
    }
    out.push(`<p>${inline(buf.join(' '))}</p>`)
  }

  return out.join('\n')
    // 块级自定义元素不放在 <p> 内（否则浏览器会提前闭合段落导致 DOM 错乱）
    .replace(/<p>\s*(<lm-(?:roadmap|guide|recipe|structure|scene)[\s\S]*?<\/lm-\w+>)\s*<\/p>/g, '$1')
    // 原文里的 <figure><img src="/linsmagic/..."> 同样改写为相对页面的 ../
    .replace(/(src|poster)="\/linsmagic\//g, '$1="../linsmagic/')
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
}

// ---------- 遍历 ----------
const pages = {}
function walk(dir, prefix) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) { walk(full, prefix + e.name + '/'); continue }
    if (!e.name.endsWith('.md')) continue
    const rel = (prefix + e.name).replace(/\.md$/, '')
    const slug = rel.replace(/\/index$/, '').replace(/^index$/, '')
    const md = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n')
    const titleLine = (md.match(/^title:\s*(.+)$/m) || [])[1] || ''
    const title = titleLine.replace(/^["']|["']$/g, '').replace(/\s*-\s*LinsMagic 魔法百科\s*$/, '').trim() || e.name.replace(/\.md$/, '')
    pages[slug] = { title, html: convert(md) }
  }
}
walk(path.join(SRC, 'guide'), 'guide/')
walk(path.join(SRC, 'tutorials'), 'tutorials/')

const order = Object.keys(pages)
fs.writeFileSync(OUT, `// 自动生成: node build-pages.mjs (来源 ylg/linsmagic/atlas)\nexport default ${JSON.stringify(pages, null, 0)}\n`)
console.log('生成', order.length, '篇 ->', OUT)
console.log(order.join('\n'))
