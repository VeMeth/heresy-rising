import { defineConfig } from 'vitepress'

// Inline role sigils for the sidebar — same monoline glyphs the game client
// uses (generated/heresy-sigils.svg), collapsed to standalone <svg> markup
// because VitePress sidebar items render text as HTML but can't reference
// an external sprite. Keep path data in sync with the sprite.
const SIGIL_PATHS = {
  'imperial-citizen': `<path d="M7 3h10l3 3v12l-3 3H7l-3-3V6z"/><circle cx="12" cy="8" r="1.3"/><path d="M8 12.6h8"/><path d="M8 16h5.4"/>`,
  'interrogator': `<path d="M2.8 15c3-4.2 15.4-4.2 18.4 0-3 4.2-15.4 4.2-18.4 0z"/><circle cx="12" cy="15" r="2.3" fill="currentColor" stroke="none"/><path d="M12 1.8v9"/><path d="m9.4 6.2 2.6 2.6 2.6-2.6"/>`,
  'chirurgeon': `<path d="M5.6 9.4A7 7 0 0 1 18.4 6"/><path d="m18.4 6 1.6-2.2"/><path d="M4.4 16h15.2"/><path d="m7.2 13 2.4 6"/><path d="m11 13 2.4 6"/><path d="m14.8 13 2.4 6"/>`,
  'arbitrator': `<path d="M12 2.4 20.2 5.6v6.3c0 4.7-3.5 7.9-8.2 9.1-4.7-1.2-8.2-4.4-8.2-9.1V5.6z"/><path d="M6.6 10.2h10.8"/><path d="M12 7.8v2.4M12 10.2v6.4"/><path d="M5.1 10.6 6.6 13.8 8.1 10.6" stroke-width="1"/><path d="M15.9 10.6 17.4 13.8 18.9 10.6" stroke-width="1"/>`,
  'novice-psychic': `<path d="M12 2.2c0 4.9-5.7 6.5-5.7 11.8a5.7 5.7 0 0 0 11.4 0c0-5.3-5.7-6.9-5.7-11.8Z"/><path d="M12.6 17.9a2.7 2.7 0 1 1-2.1-4.7c1.5-.7 3.1.5 2.9 1.9-.2 1.2-1.6 1.6-2.2 1" stroke-width="1"/>`,
  'priest': `<circle cx="12" cy="8" r="4.4" stroke-width="1"/><path d="M12 2.6V21"/><path d="M8 8h8"/><path d="M9.6 12.6h4.8"/><path d="M9.4 21h5.2"/>`,
  'sanctioned-psyker': `<path d="M14.4 1.8 7.8 12.6h4L9.6 19 17 8.6h-4z"/><ellipse cx="12" cy="20.2" rx="6" ry="2.2"/><path d="M6 20.2v-1.4M18 20.2v-1.4" stroke-width="1"/>`,
  'murderer': `<path d="M12 4.4v13.2"/><path d="M10.4 17.6 12 21.4l1.6-3.8z"/><path d="M7.2 8.6h9.6"/><path d="M7.2 8.6C7.2 6 8.4 4.8 9.6 4.4"/><path d="M16.8 8.6C16.8 6 15.6 4.8 14.4 4.4"/><path d="m12 1.6 1.5 1.6L12 4.8 10.5 3.2z"/>`,
  'blood-ritual': `<circle cx="12" cy="12" r="6.4" stroke-width="1"/><path d="M12 1.8v20.4"/><path d="M8.8 6h6.4"/>`,
  'saboteur': `<path d="M3.4 9.4Q12 3 20.6 9.4"/><path d="M5.2 9.8 7.6 12.6 10 9.8 12.4 12.6 14.8 9.8 17.2 12.6 19.2 10.2"/><path d="M3.4 15.4Q12 21.8 20.6 15.4"/><path d="M5.2 15 7.6 12.2 10 15l2.4-2.8L14.8 15l2.4-2.8 2 2.4"/><path d="M3.4 9.4v6M20.6 9.4v6"/>`,
  'heretic-priest': `<circle cx="12" cy="16" r="4.4" stroke-dasharray="3.4 2.6" stroke-width="1"/><path d="M12 2.6v18.8"/><path d="M8 16h8"/><path d="M9.6 11.4h4.8"/><path d="m12 2.6-2 2.6M12 2.6l2 2.6"/>`,
  'recruiter': `<circle cx="6.2" cy="6.4" r="3.4"/><path d="M8.8 8.8C10.4 11 11.8 12.6 13.6 14.2"/><path d="M10.7 13.8 13.6 14.2 12.2 11.6"/><circle cx="17.4" cy="17" r="3.4"/><path d="m15.2 14.6-1.2-2.6M19.6 14.6l1.2-2.6"/><circle cx="17.4" cy="17" r="1" fill="currentColor" stroke="none"/>`,
  'conspirator': `<rect x="8.6" y="3.2" width="11.8" height="8" stroke-dasharray="3 2.4" stroke-width="1"/><path d="M3.6 8.2h11.8v8H8.2l-3 3.2V16.2H3.6z"/><path d="M6.2 11h7M6.2 13.6h4.4" stroke-width="1"/>`,
  'animus': `<path d="M6.8 1.6v3.4M12 1.4v3M17.2 1.6v3.4"/><path d="M6 5.6h12v5.8c0 4.4-2.5 6.8-6 9-3.5-2.2-6-4.6-6-9z"/><path d="m8.8 9.6 2.6 1M15.2 9.6l-2.6 1"/><path d="M9.8 15.2h4.4"/><path d="M11 14.4v1.6M13 14.4v1.6" stroke-width="1"/>`,
  'roster': `<circle cx="12" cy="12" r="4.2" stroke-width="1"/><circle cx="12" cy="3.6" r="1.9"/><circle cx="19.4" cy="8.2" r="1.9"/><circle cx="16.6" cy="18.4" r="1.9"/><circle cx="7.4" cy="18.4" r="1.9"/><circle cx="4.6" cy="8.2" r="1.9"/>`,
}

function roleItem(id, text, link) {
  const paths = SIGIL_PATHS[id]
  const svg = paths
    ? `<svg class="role-sigil" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
    : ''
  return { text: `${svg}${text}`, link }
}

export default defineConfig({
  title: 'Heresy Rising',
  description: 'A Game of Hidden Faith',
  base: '/docs/',
  cleanUrls: true,
  appearance: 'force-dark',
  outDir: '_site',
  head: [
    ['link', { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
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
          { text: 'Lynch & Torture', link: '/torture' },
        ],
      },
      {
        text: 'Roles',
        items: [
          roleItem('roster', 'Roster Index', '/roles/'),
          roleItem('imperial-citizen', 'Imperial Citizen', '/roles/imperial-citizen'),
          roleItem('interrogator', 'Interrogator', '/roles/interrogator'),
          roleItem('chirurgeon', 'Chirurgeon', '/roles/chirurgeon'),
          roleItem('arbitrator', 'Arbitrator', '/roles/arbitrator'),
          roleItem('novice-psychic', 'Novice-Psychic', '/roles/novice-psychic'),
          roleItem('priest', 'Priest', '/roles/priest'),
          roleItem('sanctioned-psyker', 'Sanctioned Psyker', '/roles/sanctioned-psyker'),
          roleItem('murderer', 'Murderer', '/roles/murderer'),
          roleItem('blood-ritual', 'Blood Ritual', '/roles/blood-ritual'),
          roleItem('saboteur', 'Saboteur', '/roles/saboteur'),
          roleItem('heretic-priest', 'Heretic Priest', '/roles/heretic-priest'),
          roleItem('recruiter', 'Recruiter', '/roles/recruiter'),
          roleItem('conspirator', 'Conspirator', '/roles/conspirator'),
          roleItem('animus', 'Animus', '/roles/animus'),
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
