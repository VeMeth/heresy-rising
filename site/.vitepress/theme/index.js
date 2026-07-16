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
  'home-hero-info-before': () => h('span', { class: 'docs-eyebrow' }, 'The enemy is among us'),
})

export default {
  ...DefaultTheme,
  Layout,
}
