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
    siteTitle: false,
    logoLink: { link: '/', target: '_self' },
    nav: [
      { text: 'How to Play', link: '/how-to-play' },
      { text: 'Drift', link: '/drift' },
      { text: 'Roles', link: '/roles/' },
    ],
    sidebar: [
      {
        text: 'Get Started',
        items: [
          { text: 'How to Play', link: '/how-to-play' },
        ],
      },
      {
        text: 'Mechanics',
        items: [
          { text: 'Drift — the Warp\'s corruption', link: '/drift' },
        ],
      },
      {
        text: 'Roles',
        items: [
          { text: 'Roster Index', link: '/roles/' },
          { text: 'Imperial Citizen', link: '/roles/imperial-citizen' },
          { text: 'Interrogator', link: '/roles/interrogator' },
          { text: 'Chirurgeon', link: '/roles/chirurgeon' },
          { text: 'Arbitrator', link: '/roles/arbitrator' },
          { text: 'Novice-Psychic', link: '/roles/novice-psychic' },
          { text: 'Priest', link: '/roles/priest' },
          { text: 'Sanctioned Psyker', link: '/roles/sanctioned-psyker' },
          { text: 'Murderer', link: '/roles/murderer' },
          { text: 'Saboteur', link: '/roles/saboteur' },
          { text: 'Heretic Priest', link: '/roles/heretic-priest' },
          { text: 'Recruiter', link: '/roles/recruiter' },
          { text: 'Conspirator', link: '/roles/conspirator' },
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
