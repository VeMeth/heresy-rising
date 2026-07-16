import { h } from 'vue'
import DefaultTheme from 'vitepress/theme'
import './style.css'

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
})

export default {
  ...DefaultTheme,
  Layout,
}
