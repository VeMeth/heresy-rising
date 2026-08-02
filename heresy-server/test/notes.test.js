import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HeresyGameManager } from '../src/heresyGameManager.js';

// Same fixture() shape as game.test.js: a fresh on-disk DB per test, a
// deterministic clock, and count players (p0..p{count-1}), all ready.
function fixture(count = 5) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-notes-'));
  let now = 1_000_000;
  const manager = new HeresyGameManager({ databasePath: path.join(dir, 'game.db'), now: () => now, random: () => 0.9 });
  const { code } = manager.create({ playerCode: 'p0', name: 'P0' });
  for (let i = 1; i < count; i++) {
    manager.join({ code, playerCode: `p${i}`, name: `P${i}` });
    manager.ready(code, `p${i}`, true);
  }
  return {
    manager, code,
    setNow(v) { now = v; },
    close() { manager.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  };
}

// ── Notes: owner isolation ──────────────────────────────────────────────

test('notes: two players\' notes never appear in each other\'s listNotes', () => {
  const f = fixture();
  try {
    f.manager.addNote(f.code, 'p0', 'p1', 'p0 thinks p1 is suspicious');
    f.manager.addNote(f.code, 'p1', 'p0', 'p1 thinks p0 is suspicious');
    const p0View = f.manager.listNotes(f.code, 'p0');
    const p1View = f.manager.listNotes(f.code, 'p1');
    assert.equal(p0View.notes.length, 1);
    assert.equal(p0View.notes[0].body, 'p0 thinks p1 is suspicious');
    assert.equal(p1View.notes.length, 1);
    assert.equal(p1View.notes[0].body, 'p1 thinks p0 is suspicious');
    assert.ok(!p0View.notes.some(n => n.body.includes('p1 thinks')));
    assert.ok(!p1View.notes.some(n => n.body.includes('p0 thinks')));
  } finally { f.close(); }
});

test('notes: editing another owner\'s note id throws and leaves the victim\'s row byte-identical', () => {
  const f = fixture();
  try {
    const note = f.manager.addNote(f.code, 'p0', 'p1', 'original observation');
    const before = f.manager.db.prepare('SELECT * FROM hr_notes WHERE id=?').get(note.id);
    assert.throws(() => f.manager.editNote(f.code, 'p1', note.id, 'hostile takeover'), /Note not found/);
    const after = f.manager.db.prepare('SELECT * FROM hr_notes WHERE id=?').get(note.id);
    assert.deepEqual(after, before);
  } finally { f.close(); }
});

test('notes: deleting another owner\'s note id throws and mutates nothing', () => {
  const f = fixture();
  try {
    const note = f.manager.addNote(f.code, 'p0', 'p1', 'original observation');
    const countBefore = f.manager.db.prepare('SELECT COUNT(*) AS n FROM hr_notes').get().n;
    assert.throws(() => f.manager.deleteNote(f.code, 'p1', note.id), /Note not found/);
    const countAfter = f.manager.db.prepare('SELECT COUNT(*) AS n FROM hr_notes').get().n;
    assert.equal(countAfter, countBefore);
    const stillThere = f.manager.db.prepare('SELECT * FROM hr_notes WHERE id=?').get(note.id);
    assert.ok(stillThere);
  } finally { f.close(); }
});

test('notes: edit preserves round/phase/created_at, bumps updated_at, changes body', () => {
  const f = fixture();
  try {
    const note = f.manager.addNote(f.code, 'p0', 'p1', 'first draft');
    assert.equal(note.createdAt, note.updatedAt, 'stamps equal on insert');
    f.setNow(2_000_000);
    const edited = f.manager.editNote(f.code, 'p0', note.id, 'revised draft');
    assert.equal(edited.body, 'revised draft');
    assert.equal(edited.round, note.round);
    assert.equal(edited.phase, note.phase);
    assert.equal(edited.createdAt, note.createdAt, 'created_at never moves');
    assert.equal(edited.updatedAt, 2_000_000, 'updated_at bumps to the edit time');
    assert.ok(edited.updatedAt > edited.createdAt, 'updated_at > created_at is the only edited signal');
  } finally { f.close(); }
});

test('notes: empty and over-cap bodies are rejected', () => {
  const f = fixture();
  try {
    assert.throws(() => f.manager.addNote(f.code, 'p0', 'p1', ''), /Note is empty/);
    assert.throws(() => f.manager.addNote(f.code, 'p0', 'p1', '   '), /Note is empty/);
    assert.throws(() => f.manager.addNote(f.code, 'p0', 'p1', 'x'.repeat(501)), /too long/);
    assert.doesNotThrow(() => f.manager.addNote(f.code, 'p0', 'p1', 'x'.repeat(500)));
  } finally { f.close(); }
});

test('notes: unknown subjectCode is rejected, null subjectCode (General bucket) is allowed', () => {
  const f = fixture();
  try {
    assert.throws(() => f.manager.addNote(f.code, 'p0', 'not-a-real-player', 'body'), /Unknown subject/);
    const general = f.manager.addNote(f.code, 'p0', null, 'a note about nobody in particular');
    assert.equal(general.subjectCode, null);
  } finally { f.close(); }
});

test('notes: scoped per game — same owner in two games, no bleed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heresy-notes-multi-'));
  const manager = new HeresyGameManager({ databasePath: path.join(dir, 'game.db'), now: () => 1_000_000, random: () => 0.9 });
  try {
    const gameA = manager.create({ playerCode: 'shared', name: 'Shared' }).code;
    manager.join({ code: gameA, playerCode: 'other-a', name: 'OtherA' });
    const gameB = manager.create({ playerCode: 'shared', name: 'Shared' }).code;
    manager.join({ code: gameB, playerCode: 'other-b', name: 'OtherB' });
    manager.addNote(gameA, 'shared', null, 'note in game A');
    manager.addNote(gameB, 'shared', null, 'note in game B');
    const viewA = manager.listNotes(gameA, 'shared');
    const viewB = manager.listNotes(gameB, 'shared');
    assert.equal(viewA.notes.length, 1);
    assert.equal(viewA.notes[0].body, 'note in game A');
    assert.equal(viewB.notes.length, 1);
    assert.equal(viewB.notes[0].body, 'note in game B');
  } finally { manager.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── Bookmarks: visibility ───────────────────────────────────────────────

test('bookmarks: a player not in the heretic faction cannot bookmark a faction-channel message', () => {
  const f = fixture();
  try {
    f.manager.db.prepare("UPDATE hr_players SET faction='loyalist' WHERE game_code=? AND player_code='p0'").run(f.code);
    const factionMsg = f.manager.factionSystem(f.code, 'Cabal-only chatter.');
    assert.throws(() => f.manager.toggleBookmark(f.code, 'p0', factionMsg.id), /Faction channel denied/);
    const row = f.manager.db.prepare('SELECT * FROM hr_bookmarks WHERE game_code=? AND owner_code=? AND message_id=?').get(f.code, 'p0', factionMsg.id);
    assert.equal(row, undefined, 'no bookmark row was written');
  } finally { f.close(); }
});

test('bookmarks: a private-channel message can only be bookmarked by its recipient', () => {
  const f = fixture();
  try {
    const priv = f.manager.privateSystem(f.code, 'p1', 'A secret hint, just for you.');
    assert.throws(() => f.manager.toggleBookmark(f.code, 'p0', priv.id), /Message not found/, 'not the recipient — denied');
    const wrongRow = f.manager.db.prepare('SELECT * FROM hr_bookmarks WHERE game_code=? AND owner_code=? AND message_id=?').get(f.code, 'p0', priv.id);
    assert.equal(wrongRow, undefined);
    const bookmark = f.manager.toggleBookmark(f.code, 'p1', priv.id);
    assert.ok(bookmark, 'the recipient can bookmark their own private message');
    assert.equal(bookmark.messageId, priv.id);
    assert.equal(bookmark.channel, 'private');
  } finally { f.close(); }
});

test('bookmarks: possession — subjectCode resolves to the PUPPET, never the possessor', () => {
  const f = fixture();
  try {
    f.manager.start(f.code, 'p0');
    const g = f.manager.game(f.code);
    assert.equal(g.phase, 'day');
    // p2 possesses p1: sendMessageAs posts under p1's display name but is
    // actually authored (player_code) by p2.
    f.manager.db.prepare('UPDATE hr_players SET possessed_by=? WHERE game_code=? AND player_code=?').run('p2', f.code, 'p1');
    const message = f.manager.sendMessageAs(f.code, 'p2', 'Trust me, it wasn\'t me.');
    assert.equal(message.player_code, 'p2', 'stored player_code is the POSSESSOR (sendMessageAs behavior)');
    const target = f.manager.player(f.code, 'p1');
    assert.equal(message.author, target.name, 'displayed author is the PUPPET');
    const bookmark = f.manager.toggleBookmark(f.code, 'p0', message.id);
    assert.equal(bookmark.subjectCode, 'p1', 'resolved subject is the puppet p1');
    assert.notEqual(bookmark.subjectCode, 'p2', 'never the possessor p2 — that would leak who is possessing whom');
  } finally { f.close(); }
});

test('bookmarks: a system message ("The Vox") resolves to subjectCode null', () => {
  const f = fixture();
  try {
    const sys = f.manager.system(f.code, 'The conclave gathers.');
    assert.equal(sys.author, 'The Vox');
    const bookmark = f.manager.toggleBookmark(f.code, 'p0', sys.id);
    assert.equal(bookmark.subjectCode, null);
  } finally { f.close(); }
});

test('bookmarks: toggling twice removes the bookmark', () => {
  const f = fixture();
  try {
    const sys = f.manager.system(f.code, 'An announcement.');
    const first = f.manager.toggleBookmark(f.code, 'p0', sys.id);
    assert.ok(first, 'first toggle bookmarks it');
    const second = f.manager.toggleBookmark(f.code, 'p0', sys.id);
    assert.equal(second, null, 'second toggle removes it');
    const { notes, bookmarks } = f.manager.listNotes(f.code, 'p0');
    assert.equal(bookmarks.length, 0);
    assert.equal(notes.length, 0);
  } finally { f.close(); }
});

test('bookmarks: excerpt truncation, author, channel, and annotate/edit note behavior', () => {
  const f = fixture();
  try {
    const longBody = 'x'.repeat(400);
    const message = f.manager.sendMessage(f.code, 'p0', 'public', longBody);
    const bookmark = f.manager.toggleBookmark(f.code, 'p1', message.id);
    assert.equal(bookmark.excerpt.length, 300, 'excerpt truncated to 300 chars');
    assert.equal(bookmark.author, message.author);
    assert.equal(bookmark.channel, 'public');
    assert.equal(bookmark.note, null);
    const annotated = f.manager.annotateBookmark(f.code, 'p1', message.id, 'keep an eye on this');
    assert.equal(annotated.note, 'keep an eye on this');
    assert.throws(() => f.manager.annotateBookmark(f.code, 'p1', message.id, 'x'.repeat(301)), /too long/);
    assert.throws(() => f.manager.annotateBookmark(f.code, 'p0', message.id, 'not mine'), /Bookmark not found/, 'annotate is owner-scoped too');
  } finally { f.close(); }
});

test('bookmarks: caps enforced per (game, owner)', () => {
  const f = fixture();
  try {
    const ids = [];
    for (let i = 0; i < 300; i++) {
      const m = f.manager.system(f.code, `Event number ${i}.`);
      ids.push(m.id);
      f.manager.toggleBookmark(f.code, 'p0', m.id);
    }
    const countBefore = f.manager.db.prepare('SELECT COUNT(*) AS n FROM hr_bookmarks WHERE game_code=? AND owner_code=?').get(f.code, 'p0').n;
    assert.equal(countBefore, 300);
    const overflow = f.manager.system(f.code, 'One too many.');
    assert.throws(() => f.manager.toggleBookmark(f.code, 'p0', overflow.id), /limit/);
    const countAfter = f.manager.db.prepare('SELECT COUNT(*) AS n FROM hr_bookmarks WHERE game_code=? AND owner_code=?').get(f.code, 'p0').n;
    assert.equal(countAfter, 300, 'the over-cap bookmark was not written');
  } finally { f.close(); }
});

test('bookmarks: unknown message id throws and toggling someone else\'s existing bookmark id is a no-op for the caller (game-scoped lookup)', () => {
  const f = fixture();
  try {
    assert.throws(() => f.manager.toggleBookmark(f.code, 'p0', 999999), /Message not found/);
  } finally { f.close(); }
});
