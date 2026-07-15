import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Heresy Rising',
  description: 'A Game of Hidden Faith',
  base: '/docs/',
  appearance: 'force-dark',
  outDir: '_site',
  head: [
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;800&family=Inter:wght@400;500;600;700&display=swap' }],
  ],
  themeConfig: {
    nav: [
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
