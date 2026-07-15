import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Heresy Rising',
  description: 'A Game of Hidden Faith',
  base: '/docs/',
  appearance: 'dark',
  outDir: '_site',
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'How to Play', link: '/how-to-play' },
    ],
    sidebar: [
      {
        text: 'Get Started',
        items: [
          { text: 'Home', link: '/' },
          { text: 'How to Play', link: '/how-to-play' },
        ],
      },
    ],
    socialLinks: [],
    search: {
      provider: 'local',
      options: {
        miniSearch: {
          searchOptions: { fuzzy: 0.2, prefix: true },
        },
      },
    },
  },
})
