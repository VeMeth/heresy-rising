import { h } from 'vue'
import DefaultTheme from 'vitepress/theme'
import './style.css'

// Rendered only when the docs are framed by the SPA's manual overlay.
// Asks the parent window to dismiss itself instead of trying to navigate
// away (which would reload the SPA from inside the iframe).
function ManualCloseButton() {
  if (typeof window === 'undefined' || window.parent === window) return null
  const targetOrigin = window.location.origin || '*'
  return h('button', {
    type: 'button',
    class: 'docs-close-btn',
    onClick: () => window.parent.postMessage({ type: 'close-manual' }, targetOrigin),
  }, 'Close')
}

const Layout = () => h(DefaultTheme.Layout, null, {
  'nav-bar-title-before': () => [
    h('span', { class: 'docs-brand' }, [
      h('span', { class: 'docs-brand-mark', 'aria-hidden': 'true' }, 'H'),
      h('span', { class: 'docs-brand-copy' }, [
        h('strong', 'HERESY RISING'),
        h('small', 'A game of accusation and survival'),
      ]),
    ]),
  ],
  'nav-bar-content-after': () => h(ManualCloseButton),
})

export default {
  ...DefaultTheme,
  Layout,
}