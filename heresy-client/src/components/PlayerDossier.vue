<template>
  <Teleport to="body">
    <div v-if="open" class="dossier-backdrop" @click="emit('close')">
      <div
        class="dossier-panel"
        role="dialog"
        aria-modal="true"
        :aria-label="`Dossier: ${subjectLabel}`"
        @click.stop
      >
        <header class="dossier-head">
          <div>
            <span class="eyebrow">Private Dossier</span>
            <h2>DOSSIER &middot; {{ subjectLabel }}</h2>
          </div>
          <button class="ghost dossier-close" type="button" aria-label="Close dossier" @click="emit('close')">&times;</button>
        </header>

        <nav class="dossier-tabs">
          <button type="button" :class="{ active: activeTab === 'notes' }" @click="activeTab = 'notes'">Notes</button>
          <button type="button" :class="{ active: activeTab === 'bookmarks' }" @click="activeTab = 'bookmarks'">Bookmarks ({{ subjectBookmarks.length }})</button>
        </nav>

        <section v-if="activeTab === 'notes'" class="dossier-body">
          <ul class="entry-list">
            <li v-if="!subjectNotes.length" class="empty-state">No notes on this dossier yet. Write the first one below.</li>
            <li v-for="n in subjectNotes" :key="n.id" class="note-entry">
              <template v-if="editingId === n.id">
                <input
                  :ref="setEditInput"
                  v-model="editValue"
                  class="entry-edit-input"
                  type="text"
                  maxlength="500"
                  :disabled="busy"
                  @keydown.enter.prevent.stop="saveEdit(n)"
                  @keydown.esc.prevent.stop="cancelEdit"
                  @blur="saveEdit(n)"
                />
              </template>
              <template v-else>
                <span class="entry-stamp">
                  {{ stampFor(n) }}
                  <small v-if="isEdited(n)" class="edited-marker">(edited)</small>
                </span>
                <p class="entry-body">{{ n.body }}</p>
                <span class="entry-actions">
                  <button type="button" class="entry-btn" :disabled="busy" aria-label="Edit note" @click="beginEdit(n)">&#9998;</button>
                  <button type="button" class="entry-btn" :disabled="busy" aria-label="Delete note" @click="emit('delete-note', { noteId: n.id })">&times;</button>
                </span>
              </template>
            </li>
          </ul>
          <form class="entry-append" @submit.prevent="submitNewNote">
            <input
              ref="addNoteInput"
              v-model="newNoteBody"
              type="text"
              maxlength="500"
              placeholder="Add a note..."
              :disabled="busy"
            />
            <button type="submit" class="ghost" :disabled="busy || !newNoteBody.trim()" aria-label="Add note">+</button>
          </form>
        </section>

        <section v-else class="dossier-body">
          <ul class="entry-list">
            <li v-if="!subjectBookmarks.length" class="empty-state">No bookmarks yet &mdash; save a chat message to see it here.</li>
            <li v-for="b in subjectBookmarks" :key="b.messageId" class="bookmark-entry">
              <div class="bookmark-head">
                <strong>{{ b.author }}</strong>
                <time>{{ formatBookmarkTime(b.createdAt) }}</time>
                <button type="button" class="entry-btn" :disabled="busy" aria-label="Remove bookmark" @click="emit('remove-bookmark', { messageId: b.messageId })">&times;</button>
              </div>
              <button type="button" class="bookmark-excerpt" @click="emit('jump', { messageId: b.messageId })">{{ b.excerpt }}</button>
              <input
                class="bookmark-annotation"
                type="text"
                maxlength="300"
                placeholder="why you saved this"
                :disabled="busy"
                :value="annotationValue(b)"
                @input="onAnnotationInput(b, $event)"
                @keydown.enter.prevent="commitAnnotation(b)"
                @blur="commitAnnotation(b)"
              />
            </li>
          </ul>
        </section>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  subject: { type: Object, default: null },
  notes: { type: Array, default: () => [] },
  bookmarks: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false }
});

const emit = defineEmits(['close', 'add-note', 'edit-note', 'delete-note', 'remove-bookmark', 'annotate-bookmark', 'jump']);

const activeTab = ref('notes');
const newNoteBody = ref('');
const addNoteInput = ref(null);
const editingId = ref(null);
const editValue = ref('');
const editInputEl = ref(null);

const subjectLabel = computed(() => props.subject ? props.subject.name : 'GENERAL');

// Filtering rule from the contract: General is subjectCode == null, a named
// dossier matches by playerCode. Loose equality on subjectCode covers the
// occasional string/undefined mismatch coming off the wire.
function belongsToSubject(item) {
  const code = props.subject?.playerCode ?? null;
  if (code === null) return item.subjectCode == null;
  return item.subjectCode === code;
}

// Sorted by createdAt (not updatedAt) so an edited entry keeps its original
// position — the stamp records when the read was formed, not when it was
// last touched, and reordering on edit would make the timeline lie.
const subjectNotes = computed(() =>
  props.notes.filter(belongsToSubject).slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
);
const subjectBookmarks = computed(() =>
  props.bookmarks.filter(belongsToSubject).slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
);

function stampFor(n) {
  if (n.phase === 'day') return `D${n.round}`;
  if (n.phase === 'night') return `N${n.round}`;
  return '·';
}
function isEdited(n) {
  return !!(n.updatedAt && n.createdAt && new Date(n.updatedAt) > new Date(n.createdAt));
}
function formatBookmarkTime(t) {
  if (!t) return '';
  const d = new Date(t);
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function submitNewNote() {
  const body = newNoteBody.value.trim();
  if (!body) return;
  emit('add-note', { subjectCode: props.subject?.playerCode ?? null, body });
  newNoteBody.value = '';
}

function beginEdit(n) {
  editingId.value = n.id;
  editValue.value = n.body;
  nextTick(() => editInputEl.value?.focus());
}
function cancelEdit() {
  editingId.value = null;
  editValue.value = '';
}
// Shared by Enter and blur — Enter clears editingId first so the input
// unmounts and the blur it triggers is a no-op against a stale id.
function saveEdit(n) {
  if (editingId.value !== n.id) return;
  const body = editValue.value.trim();
  editingId.value = null;
  if (!body) return; // empty save cancels instead of emitting; `x` deletes
  if (body === n.body) return;
  emit('edit-note', { noteId: n.id, body });
}
function setEditInput(el) { editInputEl.value = el; }

// Bookmark annotations are drafted locally so keystrokes don't need a
// round trip; the draft is dropped once committed (or if unchanged) so a
// later prop update from the server is what the field displays again.
const annotationDrafts = reactive({});
function annotationValue(b) {
  return Object.prototype.hasOwnProperty.call(annotationDrafts, b.messageId) ? annotationDrafts[b.messageId] : (b.note || '');
}
function onAnnotationInput(b, e) {
  annotationDrafts[b.messageId] = e.target.value;
}
function commitAnnotation(b) {
  if (!Object.prototype.hasOwnProperty.call(annotationDrafts, b.messageId)) return;
  const val = annotationDrafts[b.messageId];
  delete annotationDrafts[b.messageId];
  if (val === (b.note || '')) return;
  emit('annotate-bookmark', { messageId: b.messageId, note: val });
}

// Opening the dossier always lands on Notes with the compose box focused —
// matches "focus the note input when it opens" and avoids trying to focus
// an input that doesn't exist when the Bookmarks tab was left active.
watch(() => props.open, (isOpen) => {
  if (!isOpen) return;
  activeTab.value = 'notes';
  editingId.value = null;
  nextTick(() => addNoteInput.value?.focus());
}, { immediate: true });

function onKeydown(e) {
  if (!props.open) return;
  if (e.key === 'Escape') emit('close');
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<style scoped>
.dossier-backdrop {
  position: fixed;
  inset: 0;
  z-index: 900;
  background: rgba(6, 7, 6, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.dossier-panel {
  position: relative;
  width: 100%;
  max-width: 480px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: linear-gradient(145deg, rgba(27, 29, 24, 0.98), rgba(15, 17, 14, 0.98));
  border: 1px solid var(--line);
  box-shadow: 0 24px 80px #0008;
}

.dossier-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--line);
}
.dossier-head h2 {
  font: 700 18px Cinzel, serif;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 4px 0 0;
  color: var(--pale);
}
.dossier-close {
  padding: 4px 10px;
  font-size: 16px;
  line-height: 1;
}

.dossier-tabs {
  display: flex;
  border-bottom: 1px solid var(--line);
}
.dossier-tabs button {
  flex: 1;
  background: none;
  border: 0;
  border-right: 1px solid var(--line);
  color: var(--muted);
  text-transform: uppercase;
  font: 700 10px Inter, sans-serif;
  letter-spacing: 0.1em;
  padding: 12px 8px;
  cursor: pointer;
}
.dossier-tabs button:last-child { border-right: 0; }
.dossier-tabs button.active {
  color: var(--gold2);
  box-shadow: inset 0 -2px 0 0 var(--gold);
}

.dossier-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.entry-list {
  list-style: none;
  margin: 0;
  padding: 12px 16px;
  overflow-y: auto;
  flex: 1;
}

.empty-state {
  color: var(--muted);
  font-size: 12px;
  text-align: center;
  padding: 24px 8px;
}

/* ── Notes ──────────────────────────────────────────────────────────── */
.note-entry {
  position: relative;
  border: 1px solid var(--line);
  border-left: 2px solid rgba(182, 154, 92, 0.4);
  padding: 8px 34px 8px 10px;
  margin-bottom: 8px;
}
.entry-stamp {
  display: block;
  font: 700 9px Cinzel, serif;
  letter-spacing: 0.08em;
  color: var(--gold);
  text-transform: uppercase;
}
.edited-marker {
  color: var(--muted);
  font: 500 9px Inter, sans-serif;
  text-transform: none;
  letter-spacing: 0;
  margin-left: 4px;
}
.entry-body {
  margin: 4px 0 0;
  font: 13px/1.5 Georgia, serif;
  color: var(--pale);
  white-space: pre-wrap;
  word-break: break-word;
}
.entry-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.12s ease;
}
/* Keyboard users get the controls via Tab even without a hover — the
   right-click that opens this panel is already one hidden gesture, and
   nothing else here should require a mouse. */
.note-entry:hover .entry-actions,
.note-entry:focus-within .entry-actions {
  opacity: 1;
}
.entry-btn {
  background: #171916;
  border: 1px solid var(--line);
  color: var(--muted);
  width: 22px;
  height: 22px;
  line-height: 1;
  font-size: 12px;
  cursor: pointer;
}
.entry-btn:hover:not(:disabled) { color: var(--gold2); border-color: var(--gold); }
.entry-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.entry-edit-input {
  width: 100%;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--gold);
  color: var(--pale);
  font: 13px/1.5 Georgia, serif;
  padding: 6px 8px;
  outline: none;
}

.entry-append {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--line);
  background: #0e100e;
}
.entry-append input {
  flex: 1;
  background: #0d0f0d;
  border: 1px solid #3a3c34;
  color: var(--pale);
  padding: 9px 10px;
  font: 13px Inter, sans-serif;
  outline: none;
}
.entry-append input:focus { border-color: var(--gold); }
.entry-append button {
  padding: 0 16px;
  font-size: 16px;
  line-height: 1;
}

/* ── Bookmarks ──────────────────────────────────────────────────────── */
.bookmark-entry {
  border: 1px solid var(--line);
  padding: 8px 10px;
  margin-bottom: 8px;
}
.bookmark-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.bookmark-head strong {
  font: 700 11px Inter, sans-serif;
  color: var(--pale);
}
.bookmark-head time {
  font-size: 9px;
  color: var(--muted);
  flex: 1;
}
.bookmark-excerpt {
  display: block;
  width: 100%;
  text-align: left;
  background: #1d201b;
  border: 1px solid #2f322b;
  color: #d1cfc4;
  font: 13px/1.5 Georgia, serif;
  padding: 8px 10px;
  margin: 6px 0;
  cursor: pointer;
  white-space: pre-wrap;
  word-break: break-word;
}
.bookmark-excerpt:hover { border-color: var(--gold); }
.bookmark-annotation {
  width: 100%;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--line);
  color: var(--muted);
  font: 12px Inter, sans-serif;
  padding: 6px 8px;
  outline: none;
}
.bookmark-annotation:focus { border-color: var(--gold); color: var(--pale); }

@media (max-width: 850px) {
  .dossier-backdrop { padding: 0; }
  .dossier-panel {
    max-width: none;
    max-height: none;
    width: 100%;
    height: 100%;
    border: 0;
  }
}
</style>
