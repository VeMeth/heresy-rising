# Heresy Rising — graphics kit

Four files. Nothing depends on a build step or a package.

    heresy-sigils.svg     18 glyphs as <symbol>s — roles, status, phases, events
    heresy-defs.svg       the wax-roughening filter + rose-window ornament
    heresy-graphics.css   atmosphere, ornament, and the stamped components
    preview.html          standalone spec sheet (open it directly, no server)

## Wiring it in

1. Drop `heresy-graphics.css` after your existing stylesheet.
2. **Inline `heresy-defs.svg` at the top of `<body>`.** It must be in the same
   document — Chromium will not resolve `filter: url(external.svg#id)`.
3. Serve `heresy-sigils.svg` from your assets path and reference glyphs by id:

   ```html
   <svg class="hr-sigil"><use href="/assets/heresy-sigils.svg#hr-murderer"/></svg>
   ```

   Same-origin only. If your assets sit on another host, inline the sprite too.
4. Add `class="hr-atmosphere"` to your app shell for grain + vignette, and
   `<div class="hr-embers"><i></i>×9</div>` for the drifting cinders.

## Components

| Class | Replaces |
|---|---|
| `.hr-seal` / `.hr-seal--loyalist` | the red "HERETIC VICTORY" text |
| `.hr-role` / `--heretic` / `--neutral` | the plain role pills |
| `.hr-portrait[data-status]` | the square letter boxes in roll call |
| `.hr-entry--<type>` | your uniform amber log lines |
| `.hr-phase--day` / `--night` | the phase banner |
| `.hr-fleuron`, `.hr-frame`, `.hr-rosette` | dividers, corners, watermark |

Log entry types: `accusation`, `vote`, `execution`, `death`, `phase`,
`verdict`, `system`.

## Glyph ids

`hr-priest` `hr-murderer` `hr-interrogator` `hr-chirurgeon` `hr-citizen`
`hr-unknown` · `hr-alive` `hr-deceased` `hr-observing` `hr-sealed` ·
`hr-day` `hr-night` · `hr-accusation` `hr-vote` `hr-verdict` `hr-execution`
`hr-vox` `hr-conclave` · `hr-mark` (logo / favicon)

## Notes

- Every glyph is monoline on `currentColor`. One file covers gold, blood
  and ash states — tint with `color`, don't ship variants.
- Colours are CSS custom properties on `:root` (`--hr-gilt`, `--hr-blood`,
  `--hr-verdigris`, …). Override them there, not at call sites.
- `--hr-verdigris` (#5c8a76) is the one addition to your palette — oxidised
  copper for living presence, so "alive" stops using a generic UI green.
- `color-mix()` and `clip-path` are used throughout; Chrome/Firefox/Safari
  current are fine, nothing older is.
- Fonts are pulled from Google (Cinzel / EB Garamond / Cutive Mono) via
  `@import`. Self-host them if you'd rather not have the third-party
  request — the stacks fall back to Georgia and Courier cleanly.
- `prefers-reduced-motion` kills the cinders, the gilt sheen and the seal press.
