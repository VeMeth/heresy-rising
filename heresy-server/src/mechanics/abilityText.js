// Renders a role's ability copy from its abilityTemplate + numeric cost
// fields, instead of the copy hand-baking specific drift numbers as literal
// digits. Today those numbers are static (read once from data/roles-40k.json
// and data/drift.json at boot, in gameConfig.js). When drift costs become
// calculated rather than fixed, only the INPUT to renderAbility() changes —
// buildCostContext() starts computing its values from live game state instead
// of reading static config — the template strings and this renderer do not
// change at all.
//
// Deliberately fails LOUD, not quiet: a template referencing a placeholder
// this module doesn't know how to fill is a bug in the data, and should
// break the server at boot (gameConfig.js calls this once per role while
// loading), not render "undefined" or a stray "{typo}" to a player.

// Renders a signed drift delta with the game's own minus glyph (U+2212, not
// an ASCII hyphen) — every existing hand-written cost in the ability prose
// already used this character, and the interpolated numbers need to match.
export function formatSigned(n) {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return '0';
}

import { resolveScaledCost } from './scaledCosts.js';

const PLACEHOLDER = /\{(\w+)\}/g;

export function renderTemplate(template, values) {
  return template.replace(PLACEHOLDER, (match, key) => {
    if (!(key in values)) throw new Error(`abilityText: template references unknown placeholder {${key}}`);
    return String(values[key]);
  });
}

// Every value a role's abilityTemplate is allowed to reference, derived from
// the role's own fields plus the shared drift config — never re-typed as a
// separate constant. Sermon numbers come from the role's OWN sermonTiers
// (already structured per-tier self/target costs on Priest/Heretic Priest),
// not the global drift.json sermons table, since that's what's actually
// attached to the role definition consumed elsewhere in the codebase.
// opts.playerCount: when a role is scaled (role.scaledCostKey set), pass the
// ACTUAL game's total roster size to get that game's exact per-tier costs
// (t1Cost/t2Cost/t3Cost). Omit it (boot-time rendering in gameConfig.js, or
// any catalog/admin view with no specific game) to get a "cheapest–priciest"
// range spanning every valid table size instead — see the min/max branch
// below. Either way the template and this renderer stay the same; only the
// values fed in change, per Q31 (dispatches/2026-07-27-q31-interrogator-cost.md).
export function buildCostContext(role, driftConfig, opts = {}) {
  const zone = id => driftConfig.zones.find(z => z.id === id) || { min: '?', max: '?' };
  const red = zone('red');
  const black = zone('black');
  const sermon = (tiers, key) => tiers?.[key]?.targetEffect;
  const ctx = {
    driftWeight: formatSigned(role.driftWeight ?? 0),
    maxDrift: driftConfig.MAX_DRIFT,
    sleepRecovery: formatSigned(driftConfig.NIGHTLY_SLEEP_RECOVERY),
    trapDrift: formatSigned(driftConfig.TRAP_DRIFT),
    redMin: red.min,
    redMax: red.max,
    blackMin: black.min,
  };
  if (role.sermonTiers) {
    // Loyalist Priest tier keys; Heretic Priest's are named differently
    // (false_comfort/twisted_hymn/warp_litany) and aren't referenced by any
    // current template, so only fill these when present.
    if ('whisper' in role.sermonTiers) ctx.whisperTarget = formatSigned(sermon(role.sermonTiers, 'whisper'));
    if ('hymn' in role.sermonTiers) ctx.hymnTarget = formatSigned(sermon(role.sermonTiers, 'hymn'));
    if ('litany' in role.sermonTiers) ctx.litanyTarget = formatSigned(sermon(role.sermonTiers, 'litany'));
  }
  if (role.scaledCostKey) {
    const scaled = driftConfig.scaledCosts?.[role.scaledCostKey];
    if (!scaled) throw new Error(`abilityText: role "${role.id}" has scaledCostKey "${role.scaledCostKey}" but drift.json's scaledCosts has no entry for it`);
    const tiers = Object.keys(scaled.baseValues);
    if (opts.playerCount) {
      for (const tier of tiers) ctx[`${tier}Cost`] = formatSigned(resolveScaledCost(driftConfig.scaledCosts, role.scaledCostKey, tier, opts.playerCount));
    } else {
      const counts = Object.keys(scaled.perPlayerCount).map(Number);
      const minPlayers = Math.min(...counts), maxPlayers = Math.max(...counts);
      for (const tier of tiers) {
        // Cost falls as the table grows, so cheapest = max players, priciest = min players.
        const cheapest = resolveScaledCost(driftConfig.scaledCosts, role.scaledCostKey, tier, maxPlayers);
        const priciest = resolveScaledCost(driftConfig.scaledCosts, role.scaledCostKey, tier, minPlayers);
        ctx[`${tier}Cost`] = cheapest === priciest ? formatSigned(cheapest) : `${formatSigned(cheapest)}–${formatSigned(priciest)}`;
      }
    }
  }
  // Recruiter's combo total (base catalyst cost + a sprung Saboteur trap) is
  // derived arithmetic, not a fourth hand-kept number — it can only ever go
  // stale relative to itself if computed independently.
  ctx.recruiterComboTotal = formatSigned((role.driftWeight ?? 0) + driftConfig.TRAP_DRIFT);
  return ctx;
}

export function renderAbility(role, driftConfig, opts = {}) {
  if (!role.abilityTemplate) return role.ability || '';
  return renderTemplate(role.abilityTemplate, buildCostContext(role, driftConfig, opts));
}
