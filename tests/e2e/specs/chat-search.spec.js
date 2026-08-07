import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HeresySocketClient } from '../helpers/socketClient.js';

// playwright.config.js only manages the API/socket server (heresy-server)
// as its webServer — there is no static build of heresy-client for it to
// serve, and no other spec in this suite ever loads a browser page, so
// there is nothing to reuse. This spec brings its own throwaway Vite dev
// server for the SPA, proxying /api and /socket.io to whatever API server
// playwright.config.js already started (E2E_SERVER_URL, same convention
// every other spec in this directory uses — defaults to 4100). That keeps
// this file runnable under the normal, unmodified config on a free machine:
// it never needs a second webServer entry in the shared config, and it
// never hardcodes a client port (Vite's own port-search picks whatever is
// free, starting from heresy-client/vite.config.js's configured 5174).
const SERVER_URL = process.env.E2E_SERVER_URL || 'http://127.0.0.1:4100';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(__dirname, '../../../heresy-client');

function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function startClientDevServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(path.join(CLIENT_DIR, 'node_modules/.bin/vite'), [], {
      cwd: CLIENT_DIR,
      env: { ...process.env, SERVER_URL }
    });
    let buf = '';
    let settled = false;
    const onData = chunk => {
      buf += stripAnsi(chunk.toString());
      const m = buf.match(/Local:\s+(http:\/\/[^\s/]+)/);
      if (m && !settled) {
        settled = true;
        proc.stdout.off('data', onData);
        resolve({ proc, url: m[1] });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', chunk => { buf += stripAnsi(chunk.toString()); });
    proc.once('exit', code => {
      if (!settled) { settled = true; reject(new Error(`Client dev server exited early (code ${code}): ${buf}`)); }
    });
    setTimeout(() => {
      if (!settled) { settled = true; proc.kill(); reject(new Error(`Timed out starting client dev server: ${buf}`)); }
    }, 20_000);
  });
}

// Seeds the same localStorage keys a real browser session accumulates after
// creating/joining a game (socket.js's raw playerCode key, App.vue's JSON
// profile, and the raw game-code string saveGameCode writes) so that on
// load, App.vue's maybeAutoJoin() takes its "returning to a game we were
// already part of" branch: initialCode (from ?game=) matches
// localStorage['heresy-rising:game'] exactly, so it re-fetches game:state
// for the given playerCode instead of trying to join/spectate fresh.
async function openGameAs(page, clientUrl, code, playerCode) {
  await page.addInitScript(({ code, playerCode }) => {
    localStorage.setItem('heresy-rising:playerCode', playerCode);
    localStorage.setItem('heresy-rising:profile', JSON.stringify({ playerCode, name: 'Operative' }));
    localStorage.setItem('heresy-rising:game', code);
  }, { code, playerCode });
  await page.goto(`${clientUrl}/?game=${code}`);
  // Presence of the search trigger means GameView actually mounted (not
  // stuck on JoinView because the seeded localStorage didn't take) — fail
  // loudly here rather than downstream on a confusing selector timeout.
  await page.waitForSelector('.search-tab', { timeout: 15_000 });
}

async function openSearchPanel(page) {
  await page.click('.search-tab');
  await page.waitForSelector('.search-panel');
}

const TOKEN = 'zzqq';
const TOKEN_BODY = `Command relay for tonight's drop: the passphrase is ${TOKEN}. Burn after reading.`;
const FACTION_TERM = 'korvex19';
const FACTION_BODY = `Cabal, the extraction rendezvous is ${FACTION_TERM} at moonrise.`;

test.describe('chat search', () => {
  /** @type {{proc: import('node:child_process').ChildProcess, url: string}} */
  let clientServer;
  /** @type {HeresySocketClient[]} */
  let clients;
  let gameCode;
  let tokenMessageId;
  let hereticClient;
  let loyalistClient;

  test.beforeAll(async () => {
    clientServer = await startClientDevServer();

    const stamp = Date.now();
    clients = Array.from({ length: 5 }, (_, i) => new HeresySocketClient({
      baseUrl: SERVER_URL,
      name: `Operative-${i}`,
      playerCode: `E2ECS-${stamp}-${i}`
    }));
    await Promise.all(clients.map(c => c.connect()));

    const host = clients[0];
    const { code } = await host.emit('game:create', { name: host.name, mode: 'live' });
    gameCode = code;
    for (let i = 1; i < clients.length; i++) {
      await clients[i].emit('game:join', { code, name: clients[i].name });
      await clients[i].emit('game:ready', { code, ready: true });
    }

    const started = await host.emit('game:start', { code, setup: { maxDrift: 20 } });
    expect(started.state.phase).toBe('day');
    expect(started.state.round).toBe(1);
    // FIRST_VOTING_ROUND is 2 — Day 1 has no vote, so this 5-player preset
    // (murderer + 4 loyalist roles, see game_data/composition.json) is
    // exactly one Heretic seated among four Loyalists. Wait for every
    // client's personalized state (from the game:start broadcast) so
    // .me.faction is actually populated before reading it.
    await Promise.all(clients.map(c => c.waitFor(() => c.state?.phase === 'day' && c.state?.round === 1)));
    hereticClient = clients.find(c => c.state?.me?.faction === 'heretic');
    loyalistClient = clients.find(c => c !== hereticClient);
    expect(hereticClient).toBeTruthy();
    expect(loyalistClient).toBeTruthy();

    // Plant the rare token in exactly one Day 1 public message.
    const sentToken = await host.emit('chat:send', { code, channel: 'public', body: TOKEN_BODY });
    tokenMessageId = sentToken.message.id;
    await loyalistClient.waitFor(() => loyalistClient.messages.some(m => m.id === tokenMessageId));

    // Day 1 -> Night 1 (force-resolve; day 1 has no vote to wait out).
    await host.emit('game:advance-phase', { code });
    await Promise.all(clients.map(c => c.waitFor(() => c.state?.phase === 'night' && c.state?.round === 1)));

    // A real Heretic sends a real faction-channel message during the night
    // (faction chat is night-only — see authorizeChannel) so the leak-
    // regression test below has genuine history to fail to find, not a
    // vacuous absence.
    const sentFaction = await hereticClient.emit('chat:send', { code, channel: 'faction', body: FACTION_BODY });
    await hereticClient.waitFor(() => hereticClient.messages.some(m => m.id === sentFaction.message.id));

    // Night 1 -> Day 2 (no actions submitted; resolves peacefully). This is
    // what turns "Day 1" into a collapsed past section in the UI.
    await host.emit('game:advance-phase', { code });
    await Promise.all(clients.map(c => c.waitFor(() => c.state?.phase === 'day' && c.state?.round === 2)));
  });

  test.afterAll(async () => {
    clients?.forEach(c => c.disconnect());
    clientServer?.proc.kill();
  });

  test('cross-day search finds the Day 1 token and jumps to it, expanding the collapsed section', async ({ page }) => {
    await openGameAs(page, clientServer.url, gameCode, loyalistClient.playerCode);
    await openSearchPanel(page);

    const input = page.locator('.search-query-input');
    await expect(input).toBeFocused();
    await input.fill(TOKEN);

    await expect(page.locator('.search-count')).toHaveText('1 hit');
    const rows = page.locator('.search-hit-row');
    await expect(rows).toHaveCount(1);

    await rows.first().click();

    // Panel closed (ChatSearch is v-if="open" behind a Teleport to body).
    await expect(page.locator('.search-backdrop')).toHaveCount(0);

    const target = page.locator(`#hr-msg-${tokenMessageId}`);
    await expect(target).toBeVisible();

    // scrollIntoView silently no-ops on a display:none node, so visibility
    // alone doesn't prove the Day 1 section actually expanded — confirm the
    // wrapping .day-messages element (v-show="day.expanded") is genuinely
    // un-hidden, not just that Playwright's visibility check tolerated it.
    const sectionState = await target.evaluate(el => {
      const section = el.closest('.day-messages');
      if (!section) return 'no-day-section-ancestor';
      return getComputedStyle(section).display === 'none' ? 'collapsed' : 'expanded';
    });
    expect(sectionState).toBe('expanded');

    // And it must actually be inside the viewport, not just "visible" per
    // Playwright's own laxer definition.
    const box = await target.evaluate(el => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, vh: window.innerHeight };
    });
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(box.vh);
  });

  test('Ctrl/Cmd+F opens the panel with focus already in the query field', async ({ page }) => {
    await openGameAs(page, clientServer.url, gameCode, loyalistClient.playerCode);

    await page.keyboard.press('Control+f');
    await page.waitForSelector('.search-panel');

    const activeElementIsQueryInput = await page.evaluate(
      () => document.activeElement?.classList.contains('search-query-input') === true
    );
    expect(activeElementIsQueryInput).toBe(true);
  });

  test('a living Loyalist gets zero hits on a real faction-channel message; a Heretic viewer gets the real one', async ({ browser }) => {
    const loyalistCtx = await browser.newContext();
    const heretiCtx = await browser.newContext();
    try {
      const loyalistPage = await loyalistCtx.newPage();
      await openGameAs(loyalistPage, clientServer.url, gameCode, loyalistClient.playerCode);
      await openSearchPanel(loyalistPage);
      await loyalistPage.locator('.search-query-input').fill(FACTION_TERM);
      // FACTION_TERM is a literal substring of FACTION_BODY, which a real
      // Heretic really sent on the faction channel this game (see
      // beforeAll) — not a string chosen to be absent everywhere.
      await expect(loyalistPage.locator('.search-count')).toHaveText('0 hits');
      await expect(loyalistPage.locator('.search-hit-row')).toHaveCount(0);

      const hereticPage = await heretiCtx.newPage();
      await openGameAs(hereticPage, clientServer.url, gameCode, hereticClient.playerCode);
      await openSearchPanel(hereticPage);
      await hereticPage.locator('.search-query-input').fill(FACTION_TERM);
      // Proves the search string genuinely exists and is findable — the
      // Loyalist's zero above is a real gate, not a vacuous "nothing ever
      // matches this string" pass.
      await expect(hereticPage.locator('.search-count')).toHaveText('1 hit');
      await expect(hereticPage.locator('.search-hit-row')).toHaveCount(1);
    } finally {
      await loyalistCtx.close();
      await heretiCtx.close();
    }
  });
});
