<script setup>
// Embeds the mechanics playground (playground/client/src) at /playground on
// the real site, gated behind the SAME admin password as /admin.
//
// This component owns exactly the auth handshake: it reuses AdminView.vue's
// own sessionStorage key (see STORAGE_KEY below — deliberately the identical
// string, not a lookalike) so unlocking either /admin or /playground in a
// browser tab unlocks the other too, and there is only ever one password
// prompt/storage mechanism in this codebase. Once a password verifies, it
// configures playground/client/src/api.js (setApiBase + setAuthHeaders) and
// mounts the playground's own App.vue completely unmodified — this file
// never reaches into its internals.
import { onMounted, ref } from 'vue';
import PlaygroundApp from '@playground/App.vue';
import { setApiBase, setAuthHeaders } from '@playground/api.js';
import '@playground/style.css';

// Identical key to AdminView.vue's STORAGE_KEY — see this file's header
// comment for why that's deliberate, not a coincidence to fix later.
const STORAGE_KEY = 'heresy-rising:adminPassword';

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
// route mounted under requireAdmin would do exactly as well.
async function verify(password) {
  checking.value = true;
  error.value = '';
  setAuthHeaders({ 'X-Admin-Password': password });
  try {
    const res = await fetch('/api/playground/roles', { headers: { 'X-Admin-Password': password } });
    if (res.status === 503) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Admin access disabled.');
    }
    if (res.status === 401) {
      throw new Error('Admin password required.');
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
  // Auto-unlock if /admin (or a previous /playground visit, same tab) has
  // already stashed a password this session — no need to re-prompt.
  if (passwordInput.value) verify(passwordInput.value);
  else checking.value = false;
});
</script>

<template>
  <div class="playground-app">
    <section v-if="!authenticated" class="playground-gate">
      <div class="playground-gate__panel">
        <span class="playground-gate__eyebrow">Admin</span>
        <h1>Mechanics Playground</h1>
        <p v-if="checking" class="playground-gate__status">Checking admin password&hellip;</p>
        <template v-else>
          <p class="playground-gate__status">Admin password required.</p>
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
  border: 1px solid var(--border, #262c34);
  border-radius: 6px;
  background: var(--bg-panel, #12151a);
  text-align: center;
}

.playground-gate__eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--accent, #5aa9e6);
}

.playground-gate__panel h1 {
  margin: 0.6rem 0 1rem;
  font-size: 20px;
}

.playground-gate__status {
  color: var(--text-dim, #8e97a3);
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
  color: var(--text-dim, #8e97a3);
}

.playground-gate__error {
  margin-top: 1rem;
  color: var(--bad, #e06258);
  font-size: 12px;
}
</style>
