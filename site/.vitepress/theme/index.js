import { h, ref, onMounted, defineComponent } from 'vue'
import DefaultTheme from 'vitepress/theme'
import './style.css'

// Rendered only when the docs are framed by the SPA's manual overlay.
// Asks the parent window to dismiss itself instead of trying to navigate
// away (which would reload the SPA from inside the iframe).
//
// The button is gated behind onMounted + a ref so that the SSR HTML and
// the initial client render both produce nothing — the close button only
// appears after hydration. Without this, SSR returns null while the
// client render returns a <button>, which trips Vue's "Hydration
// completed but contains mismatches" warning.
const ManualCloseButton = defineComponent({
  setup() {
    const show = ref(false)
    onMounted(() => {
      if (window.parent !== window) show.value = true
    })
    return () => {
      if (!show.value) return null
      const targetOrigin = window.location.origin || '*'
      return h('button', {
        type: 'button',
        class: 'docs-close-btn',
        onClick: () => window.parent.postMessage({ type: 'close-manual' }, targetOrigin),
      }, 'Close')
    }
  },
})

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