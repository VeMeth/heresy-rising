<script setup>
// Embeds the mechanics playground (playground/client/src) at /playground on
// the real site, gated behind a SEPARATE password from /admin.
//
// The playground mutates throwaway sandboxes (separate SQLite DBs from the
// live gameManager — see playground/server/sandbox.js) and shows omniscient
// state. It's dangerous, but not on the live-game admin panel — so it gets
// its own sessionStorage key (heresy-rising:playgroundPassword) and its own
// header (X-Playground-Password) so the playground password can be shared
// with playtesters without exposing ADMIN_PASSWORD.
//
// This component owns exactly the auth handshake: it configures
// playground/client/src/api.js (setApiBase + setAuthHeaders) and mounts the
// playground's own App.vue completely unmodified — this file never reaches
// into its internals.
import { onMounted, ref } from 'vue';
import PlaygroundApp from '@playground/App.vue';
import { setApiBase, setAuthHeaders } from '@playground/api.js';
import '@playground/style.css';

// Deliberately a DIFFERENT key from AdminView.vue's `heresy-rising:adminPassword`
// — the two routes are independent gates (per AGENTS.md / this file's header),
// and a successful /admin unlock must NOT auto-unlock /playground.
const STORAGE_KEY = 'heresy-rising:playgroundPassword';

const passwordInput = ref(sessionStorage.getItem(STORAGE_KEY) || '');
const authenticated = ref(false);
const checking = ref(true);
const error = ref('');

setApiBase('/api/playground');

// Verifies a candidate password against the live server (never trusts
// sessionStorage blindly — a stale or hand-edited value must still fail
// closed) before ever mounting PlaygroundApp, which starts firing its own
// requests (GET /roles, GET /scenarios) the instant it's on the page. GET
// /roles is a harmless, side-effect-free probe for this: any authenticated
// route mounted under requirePlayground would do exactly as well.
async function verify(password) {
  checking.value = true;
  error.value = '';
  setAuthHeaders({ 'X-Playground-Password': password });
  try {
    const res = await fetch('/api/playground/roles', { headers: { 'X-Playground-Password': password } });
    if (res.status === 503) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Playground access disabled.');
    }
    if (res.status === 401) {
      throw new Error('Playground password rejected.');
    }
    // A 404 here does NOT mean the password is wrong: it means /api/playground
    // isn't mounted at all, i.e. the SERVER is running a build from before the
    // playground was added. Reported distinctly because it otherwise reads as
    // an auth failure and sends people hunting for a password that is fine.
    if (res.status === 404) {
      throw new Error('The playground API is not on this server (404). The server build predates /api/playground — rebuild and redeploy heresy-server, not just the client.');
    }
    if (res.status === 502 || res.status === 504) {
      throw new Error(`The server is unreachable through the proxy (${res.status}). Check that heresy-server is up and that nginx proxies /api/ to it.`);
    }
    if (!res.ok) {
      throw new Error(`Request failed (${res.status})`);
    }
    sessionStorage.setItem(STORAGE_KEY, password);
    authenticated.value = true;
  } catch (e) {
    authenticated.value = false;
    setAuthHeaders({});
    error.value = e.message;
  } finally {
    checking.value = false;
  }
}

function submit() {
  verify(passwordInput.value);
}

onMounted(() => {
  // Auto-unlock if a previous /playground visit in this tab has already
  // stashed a password — no need to re-prompt. Note: this does NOT consult
  // /admin's sessionStorage key; the two gates are independent.
  if (passwordInput.value) verify(passwordInput.value);
  else checking.value = false;
});
</script>

<template>
  <div class="playground-app">
    <section v-if="!authenticated" class="playground-gate">
      <div class="playground-gate__panel">
        <span class="playground-gate__eyebrow">Playground</span>
        <h1>Mechanics Playground</h1>
        <p v-if="checking" class="playground-gate__status">Checking playground password&hellip;</p>
        <template v-else>
          <p class="playground-gate__status">Playground password required.</p>
          <form @submit.prevent="submit">
            <label>
              Password
              <input v-model="passwordInput" type="password" autocomplete="current-password" autofocus />
            </label>
            <button type="submit">Unlock</button>
          </form>
          <p v-if="error" class="playground-gate__error" role="alert">{{ error }}</p>
        </template>
      </div>
    </section>
    <PlaygroundApp v-else />
  </div>
</template>

<style scoped>
/* Scoped to this component's own elements only (the login gate) — the
   playground itself (PlaygroundApp) is styled entirely by the imported
   style.css above, scoped there under .playground-app. */
.playground-gate {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
.playground-gate__panel {
  width: min(360px, 90vw);
  padding: 2rem;
  border: 1px solid var(--border, #34372f);
  border-radius: 2px;
  background: var(--bg-panel, #121411);
  box-shadow: 0 24px 80px #0008;
  text-align: center;
}
.playground-gate__eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--accent, #b69a5c);
}
.playground-gate__panel h1 {
  margin: 0.6rem 0 1rem;
  font-size: 20px;
}
.playground-gate__status {
  color: var(--text-dim, #8f9287);
  font-size: 13px;
  margin-bottom: 1rem;
}
.playground-gate__panel form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.playground-gate__panel label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  text-align: left;
  font-size: 12px;
  color: var(--text-dim, #8f9287);
}
.playground-gate__error {
  margin-top: 1rem;
  color: var(--bad, #b5453c);
  font-size: 12px;
}
</style>
