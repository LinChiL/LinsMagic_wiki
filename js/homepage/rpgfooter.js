// rpgfooter.js
// 左下角小字署名(LINSMAGIC | RPG PLUGIN + 右侧延伸渐隐细线): 纯装饰、不响应点击。
// DOM 与样式全部由本模块注入, index.html 不含相关代码。
(function () {
  var CSS = [
    '/* 左下角小字容器: 固定在屏幕左下角, 与右下唱片对称留白 */',
    '.rpg-footer-caption {',
    '  position: fixed;',
    '  left: clamp(24px, 3.2vw, 48px);',
    '  bottom: clamp(20px, 3vh, 36px);',
    '  z-index: 5; /* 在 3D 画布之上、雪花(z-index:10)之下, 雪可从文字前飘过 */',
    '  display: inline-flex;',
    '  align-items: center;',
    '  user-select: none;',
    '  pointer-events: none; /* 纯展示, 不拦截任何点击 */',
    '  opacity: 0; /* 与 RPG 菜单同序: 标题装配完成后由 tyndall.js 调 show() 淡入 */',
    '  transition: opacity 0.6s ease;',
    '}',
    '.rpg-footer-caption.show {',
    '  opacity: 1;',
    '}',
    '.rpg-footer-caption .caption-text {',
    '  /* 衬线字体组合: 仅用系统本地字体, 不引外网字体(项目离线约定);',
    '     Cinzel 罗马大写风格回退到 Times/Georgia, 中文回退宋体栈 */',
    "  font-family: 'Times New Roman', Georgia, 'Source Han Serif CN', 'Noto Serif CJK SC', 'Songti SC', 'STSong', 'SimSun', serif;",
    '  font-size: clamp(9px, 0.85vw, 11px);',
    '  font-weight: 400;',
    '  text-transform: uppercase;',
    '  letter-spacing: 0.25em; /* 拉开字母间距 */',
    '  color: rgba(220, 225, 230, 0.65);',
    '  white-space: nowrap;',
    '  text-shadow: 0 0 8px rgba(0, 0, 0, 0.8);',
    '}',
    '.rpg-footer-caption .caption-line {',
    '  margin-left: 18px;',
    '  width: clamp(120px, 18vw, 220px); /* 横线长度, 小屏收窄防溢出 */',
    '  height: 1px;',
    '  /* 左侧实、右侧渐隐的细线 */',
    '  background: linear-gradient(',
    '    to right,',
    '    rgba(220, 225, 230, 0.5) 0%,',
    '    rgba(220, 225, 230, 0.2) 70%,',
    '    rgba(220, 225, 230, 0) 100%',
    '  );',
    '}'
  ].join('\n')

  var style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  var box = document.createElement('div')
  box.className = 'rpg-footer-caption'

  var text = document.createElement('span')
  text.className = 'caption-text'
  text.textContent = 'LINSMAGIC | MINECRAFT PLUGIN'

  var line = document.createElement('div')
  line.className = 'caption-line'

  box.appendChild(text)
  box.appendChild(line)
  document.body.appendChild(box)

  // ===== 对外接口: 与 RPG 菜单共用标题装配完成的淡入时序 =====
  window.RpgFooter = {
    show: function () { box.classList.add('show') },
    hide: function () { box.classList.remove('show') }
  }
})();
