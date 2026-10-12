// rpgmenu.js
// 3D 标题下方的 2D RPG 菜单: DOM、样式、交互全部由本模块注入, index.html 不含相关代码。
// 对外暴露 window.RpgMenu:
//   RpgMenu.place(centerXpx, topYpx)  按屏幕像素坐标定位(水平居中于 x, 顶部贴 y)
//   RpgMenu.show() / RpgMenu.hide()   标题装配完成后淡入 / 回退时隐藏
(function () {
  var CSS = [
    '/* 3D 标题下方 2D RPG 菜单, 位置由 tyndall.js 按标题装配后的真实屏幕包围盒写入 */',
    '.rpg-menu-container {',
    '  position: fixed;',
    '  left: var(--menu-x, 50%);',
    '  top: var(--menu-y, 52%);',
    '  transform: translate(-50%, -14px);',
    '  z-index: 5; /* 在 3D 画布之上、雪花(z-index:10)之下, 雪可从菜单前飘过 */',
    '  padding: 0;',
    '  user-select: none;',
    '  pointer-events: none; /* 容器整体穿透: 只有菜单项本身吃点击, 其余区域放行给 3D 画布拖拽路径把手 */',
    '  opacity: 0; /* 标题装配完成后淡入 */',
    '  transition: opacity 0.6s ease, transform 0.6s ease;',
    '}',
    '.rpg-menu-container.show {',
    '  opacity: 1;',
    '  transform: translate(-50%, 0);',
    '}',
    '.rpg-menu-list {',
    '  list-style: none; margin: 0; padding: 0;',
    '  display: flex; flex-direction: column; gap: clamp(16px, 2.4vh, 28px);',
    '}',
    '.rpg-menu-item {',
    '  position: relative;',
    '  display: flex; align-items: center;',
    '  cursor: pointer;',
    '  pointer-events: auto; /* 菜单项本身恢复点击, 覆盖容器的穿透设置 */',
    '  height: clamp(26px, 3.4vh, 36px);',
    '  /* 衬线字体组合: 仅用系统本地宋体栈, 不引外网字体(项目离线约定) */',
    "  font-family: 'Source Han Serif CN', 'Noto Serif CJK SC', 'Songti SC', 'STSong', 'SimSun', serif;",
    '  font-size: clamp(15px, 1.45vw, 20px);',
    '  letter-spacing: 0.15em;',
    '  color: rgba(220, 225, 230, 0.65);',
    '  transition: color 0.25s ease;',
    '}',
    '.rpg-menu-item .menu-icon {',
    '  width: 0; height: 0;',
    '  border-top: 6px solid transparent;',
    '  border-bottom: 6px solid transparent;',
    '  border-left: 9px solid #ffffff;',
    '  margin-right: 18px;',
    '  opacity: 0;',
    '  transform: translateX(-6px);',
    '  transition: opacity 0.25s ease, transform 0.25s ease;',
    '}',
    '.rpg-menu-item .menu-text {',
    '  white-space: nowrap;',
    '  text-shadow: 0 0 10px rgba(0, 0, 0, 0.8);',
    '}',
    '.rpg-menu-item .menu-line {',
    '  margin-left: 24px;',
    '  width: clamp(90px, 13vw, 180px);',
    '  height: 1px;',
    '  background: linear-gradient(',
    '    to right,',
    '    rgba(220, 225, 230, 0.7) 0%,',
    '    rgba(220, 225, 230, 0.4) 60%,',
    '    rgba(220, 225, 230, 0) 100%',
    '  );',
    '  opacity: 0;',
    '  transform: scaleX(0.7);',
    '  transform-origin: left center;',
    '  transition: opacity 0.25s ease, transform 0.25s ease;',
    '}',
    '.rpg-menu-item:hover,',
    '.rpg-menu-item.active {',
    '  color: #ffffff;',
    '  text-shadow: 0 0 12px rgba(255, 255, 255, 0.3), 0 0 4px rgba(0, 0, 0, 0.9);',
    '}',
    '.rpg-menu-item:hover .menu-icon,',
    '.rpg-menu-item.active .menu-icon {',
    '  opacity: 1;',
    '  transform: translateX(0);',
    '}',
    '.rpg-menu-item:hover .menu-line,',
    '.rpg-menu-item.active .menu-line {',
    '  opacity: 1;',
    '  transform: scaleX(1);',
    '}',
    '',
    '/* 标题下沿副标题: 左下角署名的镜像版(线在左、字样在右), 定位/淡入随 nav 自动继承 */',
    '.rpg-title-caption {',
    '  position: absolute;',
    '  left: 60%;',
    '  bottom: calc(100% + 14px); /* 位于菜单上方: 调这个 14px 改与菜单的纵向间距 */',
    '  transform: translateX(-50%);',
    '  display: inline-flex;',
    '  align-items: center;',
    '  white-space: nowrap;',
    '  pointer-events: none;',
    '}',
    '.rpg-title-caption .caption-line {',
    '  margin-right: 32px;',
    '  width: clamp(120px, 48vw, 320px); /* 线长, 与左下角署名一致 */',
    '  height: 1px;',
    '  /* 镜像: 右端实、向左渐隐(左下角署名为左端实、向右渐隐) */',
    '  background: linear-gradient(',
    '    to left,',
    '    rgba(220, 225, 230, 0.5) 0%,',
    '    rgba(220, 225, 230, 0.2) 70%,',
    '    rgba(220, 225, 230, 0) 100%',
    '  );',
    '}',
    '.rpg-title-caption .caption-text {',
    "  font-family: 'Times New Roman', Georgia, 'Source Han Serif CN', 'Noto Serif CJK SC', 'Songti SC', 'STSong', 'SimSun', serif;",
    '  font-size: clamp(9px, 0.85vw, 24px);',
    '  font-weight: 400;',
    '  text-transform: uppercase;',
    '  letter-spacing: 0.25em;',
    '  color: rgba(220, 225, 230, 0.65);',
    '  text-shadow: 0 0 8px rgba(0, 0, 0, 0.8);',
    '}'
  ].join('\n')

  // 菜单项配置: 首项默认选中
  var ITEMS = ['首页-LinsMagic', 'Wiki', '版本与更新日志', '特别鸣谢与开发者名单']

  var style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  var nav = document.createElement('nav')
  nav.className = 'rpg-menu-container'
  nav.id = 'rpg-menu'

  var ul = document.createElement('ul')
  ul.className = 'rpg-menu-list'

  ITEMS.forEach(function (text, i) {
    var li = document.createElement('li')
    li.className = 'rpg-menu-item' + (i === 0 ? ' active' : '')

    var icon = document.createElement('span')
    icon.className = 'menu-icon'
    var label = document.createElement('span')
    label.className = 'menu-text'
    label.textContent = text
    var line = document.createElement('div')
    line.className = 'menu-line'

    li.appendChild(icon)
    li.appendChild(label)
    li.appendChild(line)

    // 点击切换 .active 选中项(三角指示符/横线仅在 hover 或 active 时显现)
    li.addEventListener('click', function () {
      var all = ul.querySelectorAll('.rpg-menu-item')
      all.forEach(function (o) { o.classList.remove('active') })
      li.classList.add('active')

      // 【新增】点击"版本与更新日志"触发转场
      if (i === 2 && window.onChangelogTrigger) {
        window.onChangelogTrigger();
      }
    })

    ul.appendChild(li)
  })

  // 标题下沿副标题(左下角署名的镜像): 线在左、字样在右
  var caption = document.createElement('div')
  caption.className = 'rpg-title-caption'
  var captionLine = document.createElement('div')
  captionLine.className = 'caption-line'
  var captionText = document.createElement('span')
  captionText.className = 'caption-text'
  captionText.textContent = 'LINSMAGIC V1.10 虚空与深渊'
  caption.appendChild(captionLine)
  caption.appendChild(captionText)
  nav.appendChild(caption)

  nav.appendChild(ul)
  document.body.appendChild(nav)

  // ===== 对外接口(供 tyndall.js 标题投影锚定) =====
  window.RpgMenu = {
    // centerX/topY 为屏幕像素: 菜单水平居中于 centerX, 顶部贴 topY
    place: function (centerX, topY) {
      nav.style.setProperty('--menu-x', centerX + 'px')
      nav.style.setProperty('--menu-y', topY + 'px')
    },
    show: function () { nav.classList.add('show') },
    hide: function () { nav.classList.remove('show') }
  }
})();
