<template>
  <main class="admin-shell">
    <section v-if="!authenticated" class="login-panel">
      <span>ADMIN</span>
      <h1>Heresy Rising Control</h1>
      <form @submit.prevent="login">
        <label>Password<input v-model="passwordInput" type="password" autocomplete="current-password" autofocus></label>
        <button type="submit" :disabled="loading">Unlock</button>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
    </section>

    <section v-else class="control-room">
      <header class="topbar">
        <div>
          <span>ADMIN</span>
          <h1>Live Conclaves</h1>
        </div>
        <div class="actions">
          <button type="button" @click="loadOverview" :disabled="loading">Refresh</button>
          <button type="button" @click="logout">Lock</button>
        </div>
      </header>

      <p v-if="error" class="error">{{ error }}</p>

      <div class="metrics">
        <div><span>Conclaves</span><strong>{{ totals.games || 0 }}</strong></div>
        <div><span>Active</span><strong>{{ totals.active || 0 }}</strong></div>
        <div><span>Lobby</span><strong>{{ totals.lobby || 0 }}</strong></div>
        <div><span>Ended</span><strong>{{ totals.ended || 0 }}</strong></div>
        <div><span>Players</span><strong>{{ totals.players || 0 }}</strong></div>
        <div><span>Messages</span><strong>{{ totals.messages || 0 }}</strong></div>
      </div>

      <nav class="tabs">
        <button type="button" :class="{ active: tab === 'cells' }" @click="tab = 'cells'">Conclaves</button>
        <button type="button" :class="{ active: tab === 'logs' }" @click="openLogs">Game Logs</button>
        <button type="button" :class="{ active: tab === 'players' }" @click="openPlayers">Players</button>
        <button type="button" :class="{ active: tab === 'bots' }" @click="openBots">Bots</button>
        <button type="button" :class="{ active: tab === 'simulator' }" @click="tab = 'simulator'">Simulator</button>
      </nav>

      <section v-if="tab === 'cells'" class="layout">
        <aside class="cell-list">
          <button
            v-for="game in games"
            :key="game.code"
            type="button"
            :class="{ selected: selectedCode === game.code }"
            @click="loadGame(game.code)"
          >
            <strong>{{ game.code }}</strong>
            <span>{{ game.status }} · {{ game.phase }}{{ game.dayStage ? `/${game.dayStage}` : '' }}</span>
            <small>{{ game.playerCount }} players · avg drift {{ formatDrift(game.averageDrift) }} · round {{ game.round }}</small>
          </button>
          <p v-if="!games.length" class="empty">No conclaves found.</p>
        </aside>

        <article v-if="detail" class="detail">
          <header class="detail-head">
            <div>
              <span>CONCLAVE {{ detail.game.code }}</span>
              <h2>{{ detail.game.status }} · {{ detail.game.phase }}{{ detail.game.dayStage ? `/${detail.game.dayStage}` : '' }}</h2>
            </div>
            <div class="actions">
              <button type="button" @click="copyJson(detail)">Copy JSON</button>
              <button type="button" @click="endGame('admin')">End</button>
              <button type="button" class="danger" @click="deleteGame">Delete</button>
            </div>
          </header>

          <div class="facts">
            <span>Mode <strong>{{ detail.game.mode }}</strong></span>
            <span>Round <strong>{{ detail.game.round }}</strong></span>
            <span>Winner <strong>{{ detail.game.winner || '-' }}</strong></span>
            <span>Deadline <strong>{{ formatDate(detail.game.deadline) }}</strong></span>
            <span>Max drift <strong>{{ detail.game.maxDrift }}</strong></span>
            <span>Updated <strong>{{ formatDate(detail.game.updatedAt) }}</strong></span>
          </div>

          <section>
            <h3>Drift overview</h3>
            <div class="facts drift-overview">
              <span>Average <strong>{{ formatDrift(averageDrift) }}</strong></span>
              <span>Highest <strong>{{ highestDriftPlayer ? `${highestDriftPlayer.name} · ${highestDriftPlayer.drift}` : '-' }}</strong></span>
              <span>At maximum <strong>{{ playersAtMaxDrift }}</strong></span>
            </div>
          </section>

          <section>
            <h3>Players</h3>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Seat</th><th>Name</th><th>Role</th><th>Faction</th><th>Drift</th><th>State</th><th></th></tr></thead>
                <tbody>
                  <tr v-for="player in detail.players" :key="player.playerCode">
                    <td>{{ player.seat }}<span v-if="player.isHost"> H</span></td>
                    <td><strong>{{ player.name }}</strong><code>{{ player.playerCode }}</code></td>
                    <td>
                      <select v-model="player.roleId">
                        <option :value="null">Unassigned</option>
                        <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.displayName }}</option>
                      </select>
                    </td>
                    <td>
                      <select v-model="player.faction">
                        <option value="">-</option>
                        <option value="loyalist">loyalist</option>
                        <option value="heretic">heretic</option>
                      </select>
                    </td>
                    <td class="drift-cell">
                      <input v-model.number="player.drift" type="number" min="0" :max="detail.game.maxDrift">
                      <span>/ {{ detail.game.maxDrift }}</span>
                    </td>
                    <td class="checks">
                      <label><input v-model="player.alive" type="checkbox"> Alive</label>
                      <label><input v-model="player.ready" type="checkbox"> Ready</label>
                      <label><input v-model="player.connected" type="checkbox"> Online</label>
                      <label><input v-model="player.confessed" type="checkbox"> Confessed</label>
                    </td>
                    <td><button type="button" @click="savePlayer(player)">Save</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <div class="columns">
            <section>
              <h3>Actions</h3>
              <pre>{{ pretty(detail.actions) }}</pre>
            </section>
            <section>
              <h3>Votes</h3>
              <pre>{{ pretty(detail.votes) }}</pre>
            </section>
          </div>

          <div class="columns">
            <section>
              <h3>Messages</h3>
              <div class="scroll-list">
                <p v-for="message in detail.messages" :key="message.id">
                  <span>{{ formatDate(message.createdAt) }} · {{ message.channel }} · {{ message.author }}</span>
                  {{ message.body }}
                </p>
              </div>
            </section>
            <section>
              <h3>Events</h3>
              <pre>{{ pretty(detail.events) }}</pre>
            </section>
          </div>
        </article>
      </section>

      <section v-if="tab === 'logs'" class="logs">
        <header class="detail-head">
          <div><span>ARCHIVE</span><h2>Game Logs</h2></div>
          <button type="button" @click="loadLogs" :disabled="loading">Refresh</button>
        </header>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Room</th><th>Phase</th><th>Players</th><th>Events</th><th>Updated</th><th></th></tr></thead>
            <tbody>
              <tr v-for="log in logs" :key="log.id">
                <td><code>{{ log.roomCode }}</code></td>
                <td>{{ log.phase }}</td>
                <td>{{ (log.players || []).map(p => p.name).join(', ') || '-' }}</td>
                <td>{{ log.eventCount }}</td>
                <td>{{ formatDate(log.updatedAt) }}</td>
                <td class="actions">
                  <button type="button" @click="loadLog(log.id)">Open</button>
                  <button type="button" class="danger" @click="deleteLog(log)">Delete</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <article v-if="selectedLog" class="archive-detail">
          <header class="detail-head">
            <div>
              <span>ARCHIVED CONCLAVE {{ selectedLog.roomCode || selectedLog.id }}</span>
              <h2>{{ selectedLog.winner ? `${selectedLog.winner} victory` : selectedLog.phase || 'Archived game' }}</h2>
            </div>
            <div class="actions archive-actions">
              <button type="button" @click="copyJson(selectedLog)">Copy JSON</button>
              <button type="button" @click="selectedLog = null">Close</button>
            </div>
          </header>

          <div class="facts">
            <span>Phase <strong>{{ selectedLog.phase || '-' }}</strong></span>
            <span>Round <strong>{{ selectedLog.round ?? '-' }}</strong></span>
            <span>Mode <strong>{{ selectedLog.mode || '-' }}</strong></span>
            <span>Winner <strong>{{ selectedLog.winner || '-' }}</strong></span>
            <span>Players <strong>{{ archivePlayers.length }}</strong></span>
            <span>Events <strong>{{ archiveEvents.length }}</strong></span>
            <span>Created <strong>{{ formatDate(selectedLog.createdAt) }}</strong></span>
            <span>Updated <strong>{{ formatDate(selectedLog.updatedAt) }}</strong></span>
          </div>

          <section>
            <h3>Players</h3>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Seat</th><th>Name</th><th>Role</th><th>Faction</th><th>Final drift</th><th>State</th></tr></thead>
                <tbody>
                  <tr v-for="player in archivePlayers" :key="player.playerCode || player.id">
                    <td>{{ player.seat ?? '-' }}</td>
                    <td><strong>{{ player.name }}</strong><code>{{ player.playerCode || player.id }}</code></td>
                    <td>{{ player.roleId || player.hero || '-' }}</td>
                    <td>{{ player.faction || '-' }}</td>
                    <td>{{ player.finalDrift }} / {{ archiveMaxDrift }}</td>
                    <td>{{ player.alive === null ? '-' : player.alive ? 'Alive' : 'Dead' }}<template v-if="player.crippleTier != null"> · T{{ player.crippleTier }}</template></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3>Player drift history</h3>
            <p v-if="!archiveDriftEntries.length" class="empty">No drift changes were recorded.</p>
            <div v-else class="table-wrap">
              <table>
                <thead><tr><th>Time</th><th>Player</th><th>Round</th><th>Phase</th><th>Change</th><th>Drift</th><th>Zone</th><th>Reason</th></tr></thead>
                <tbody>
                  <tr v-for="entry in archiveDriftEntries" :key="entry.id">
                    <td>{{ formatDate(entry.createdAt) }}</td>
                    <td><strong>{{ entry.playerName }}</strong></td>
                    <td>{{ entry.round ?? '-' }}</td>
                    <td>{{ entry.phase || '-' }}</td>
                    <td>{{ entry.delta > 0 ? '+' : '' }}{{ entry.delta }}</td>
                    <td>{{ entry.before }} → {{ entry.after }}</td>
                    <td>{{ entry.zone || '-' }}</td>
                    <td>{{ entry.reason || '-' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <div class="columns">
            <section>
              <h3>Messages</h3>
              <div class="scroll-list">
                <p v-for="message in selectedLog.history || []" :key="message.id">
                  <span>{{ formatDate(message.createdAt || message.created_at) }} · {{ message.channel }} · {{ message.author }}</span>
                  {{ message.body }}
                </p>
                <p v-if="!(selectedLog.history || []).length" class="empty">No messages recorded.</p>
              </div>
            </section>
            <section>
              <h3>Event timeline</h3>
              <div class="scroll-list">
                <p v-for="event in archiveEvents" :key="event.id">
                  <span>{{ formatDate(event.createdAt) }} · {{ event.type }}</span>
                  <code>{{ pretty(event.payload) }}</code>
                </p>
                <p v-if="!archiveEvents.length" class="empty">No events recorded.</p>
              </div>
            </section>
          </div>
        </article>
      </section>

      <section v-if="tab === 'players'" class="players">
        <header class="detail-head">
          <div><span>PROFILES</span><h2>Player Overview</h2></div>
          <div class="actions">
            <button type="button" @click="loadPlayers" :disabled="loadingPlayers">Refresh</button>
          </div>
        </header>
        <p v-if="playerError" class="error">{{ playerError }}</p>

        <div class="merge-form">
          <h3>Merge Profiles</h3>
          <p class="form-hint">Combine two profiles, keeping one as the primary. Both must have non-overlapping games.</p>
          <div class="merge-inputs">
            <label>Player to merge (from)
              <input v-model="mergeForm.fromPlayerCode" type="text" placeholder="old player code" />
            </label>
            <label>Keep as primary (to)
              <input v-model="mergeForm.toPlayerCode" type="text" placeholder="new player code" />
            </label>
            <button type="button" @click="mergeProfiles" :disabled="loadingPlayers || !mergeForm.fromPlayerCode || !mergeForm.toPlayerCode">Merge</button>
          </div>
          <p v-if="mergeResult" :class="{ ok: mergeResult.merged, error: !mergeResult.merged }">
            {{ mergeResult.merged ? `✓ Merged ${mergeResult.fromPlayerCode} → ${mergeResult.toPlayerCode} (${mergeResult.gamesAffected} games)` : mergeResult.error }}
          </p>
        </div>

        <div class="players-list">
          <h3>All Players ({{ players.length }})</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Player Code</th><th>Total Games</th><th>Ended</th><th>Active</th><th>Last Seen</th><th></th></tr></thead>
              <tbody>
                <tr v-for="player in players" :key="player.playerCode" :class="{ 'has-active': player.activeGames.length > 0 }">
                  <td><code>{{ player.playerCode }}</code></td>
                  <td><strong>{{ player.gameCount }}</strong></td>
                  <td>{{ player.endedCount }}</td>
                  <td>
                    <template v-if="player.activeGames.length">
                      <span class="badge badge-active">{{ player.activeGames.length }}</span>
                      <span class="game-codes">{{ player.activeGames.join(', ') }}</span>
                    </template>
                    <template v-else><span class="badge badge-na">0</span></template>
                  </td>
                  <td>{{ formatDate(player.lastSeen) }}</td>
                  <td class="actions">
                    <button type="button" @click="selectPlayerForMerge(player.playerCode)" title="Use as target for merge">→</button>
                    <button type="button" class="danger" @click="deletePlayer(player)" :disabled="player.activeGames.length > 0">Delete</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="!players.length" class="empty">No players found.</p>
        </div>
      </section>

      <section v-if="tab === 'bots'" class="bots">
        <header class="detail-head">
          <div><span>HERESY BOTS</span><h2>AI operatives</h2></div>
          <div class="actions">
            <button type="button" @click="loadBots" :disabled="loadingBots">Refresh</button>
            <button type="button" :class="{ active: botsPolling }" @click="toggleBotsPolling">{{ botsPolling ? 'Auto: On' : 'Auto: Off' }}</button>
          </div>
        </header>
        <p v-if="botError" class="error">{{ botError }}</p>
        <p v-if="bots.length > 0 && bots.every(b => b.llmPassive)" class="warning-banner">⚠️ All bots are in <strong>PASSIVE</strong> mode — no LLM endpoint configured (set OPENAI_BASE_URL and rebuild the bot-manager). They will join games but pass every turn silently.</p>
        <p v-if="bots.length > 0 && bots.some(b => b.llmPassive) && !bots.every(b => b.llmPassive)" class="warning-banner">⚠️ Some bots are in <strong>PASSIVE</strong> mode.</p>

        <section class="spawn-form">
          <h3>Spawn bot</h3>
          <div class="spawn-grid">
            <label>Conclave code
              <input v-model="spawnForm.conclaveCode" type="text" placeholder="ABC123" maxlength="8" />
            </label>
            <label>Name
              <input v-model="spawnForm.name" type="text" placeholder="random W40k name" maxlength="20" />
            </label>
            <label>Seat hint (optional)
              <!-- max is MAX_PLAYERS - 1, expressed as a zero-based seat index -->
              <input v-model.number="spawnForm.seatHint" type="number" min="0" :max="rules.MAX_PLAYERS - 1" placeholder="auto" />
            </label>
            <label>Per-game token budget
              <input v-model.number="spawnForm.costCeiling" type="number" min="1000" max="500000" />
            </label>
            <label>Persona overrides (freeform)
              <textarea v-model="spawnForm.personaOverrides" rows="3" placeholder="e.g. speak in clipped, terse sentences; never claim Citizen; vote with the Heretic consensus"></textarea>
            </label>
          </div>
          <div class="actions">
            <button type="button" :disabled="loadingBots || !spawnForm.conclaveCode" @click="spawnBot">Spawn</button>
          </div>
          <p v-if="lastSpawnResult" class="spawn-result">
            <span>Last response:</span>
            <code>{{ pretty(lastSpawnResult) }}</code>
          </p>
        </section>

        <section>
          <h3>Active sessions ({{ bots.length }})</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>botId</th><th>Conclave</th><th>Name</th><th>Role</th><th>Faction</th><th>Phase</th><th>Round</th><th>Alive</th><th>Mode</th><th>Round Action</th><th>Last</th><th>Tokens</th><th>Mem</th><th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="bot in bots" :key="bot.botId">
                  <td><code>{{ bot.botId }}</code></td>
                  <td>{{ bot.conclaveCode }}</td>
                  <td><strong>{{ bot.name || '-' }}</strong></td>
                  <td>{{ bot.role || '-' }}</td>
                  <td>{{ bot.faction || '-' }}</td>
                  <td>{{ bot.phase || '-' }}</td>
                  <td>{{ bot.round ?? '-' }}</td>
                  <td>{{ bot.alive === false ? 'no' : 'yes' }}</td>
                  <td><span v-if="bot.llmPassive" class="badge badge-passive" title="No LLM configured — bot passes every turn">PASSIVE</span><span v-else class="badge badge-active" title="LLM is active">ACTIVE</span></td>
                  <td><span class="badge" :class="roundActionBadgeClass(bot)" :title="roundActionTitle(bot)">{{ roundActionLabel(bot) }}</span></td>
                  <td><code>{{ bot.lastAction || '-' }}</code></td>
                  <td>{{ bot.tokensUsed ?? 0 }} / {{ bot.costCeiling ?? '?' }}</td>
                  <td>{{ bot.memoryBytes ?? 0 }}</td>
                  <td class="actions">
                    <button type="button" @click="selectBot(bot.botId)">Notes</button>
                    <button type="button" class="danger" @click="despawnBot(bot)">Despawn</button>
                  </td>
                </tr>
                <tr v-if="!bots.length"><td colspan="13"><p class="empty">No bots currently spawned.</p></td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section v-if="selectedBot" class="bot-detail">
          <header class="detail-head">
            <div>
              <span>BOT</span>
              <h3>{{ selectedBot.name || selectedBot.botId }}</h3>
            </div>
            <div class="actions">
              <button
                v-for="t in botTabs"
                :key="t.id"
                type="button"
                :class="{ active: botTab === t.id }"
                @click="botTab = t.id"
              >{{ t.label }}</button>
              <button type="button" @click="selectedBot = null; botNotes = {}">Close</button>
            </div>
          </header>

          <!-- Bot info bar -->
          <div class="facts">
            <span>Role <strong>{{ selectedBot.role || '-' }}</strong></span>
            <span>Faction <strong>{{ selectedBot.faction || '-' }}</strong></span>
            <span>Phase <strong>{{ selectedBot.phase || '-' }}</strong></span>
            <span>Round <strong>{{ selectedBot.round ?? '-' }}</strong></span>
            <span>Alive <strong>{{ selectedBot.alive === false ? 'No' : 'Yes' }}</strong></span>
            <span>Round Action <strong><span class="badge" :class="roundActionBadgeClass(selectedBot)" :title="roundActionTitle(selectedBot)">{{ roundActionLabel(selectedBot) }}</span></strong></span>
            <span>Last <strong><code>{{ selectedBot.lastAction || '-' }}</code></strong></span>
            <span>Tokens <strong>{{ selectedBot.tokensUsed ?? 0 }} / {{ selectedBot.costCeiling ?? '?' }}</strong></span>
            <span>Memory <strong>{{ selectedBot.memoryBytes ?? 0 }} events</strong></span>
            <span>Connected <strong>{{ selectedBot.connected ? 'Yes' : 'No' }}</strong></span>
            <span>Winner <strong>{{ selectedBot.winner || '-' }}</strong></span>
          </div>

          <!-- Tab: Memory (phase summaries + current events) -->
          <section v-if="botTab === 'memory'" class="bot-tab-content">
            <h4>Phase Summaries <small>(long-term notes carried across rounds)</small></h4>
            <div class="scroll-list" style="max-height:200px">
              <p v-for="(val, key) in phaseSummaries" :key="key" class="mem-item">
                <span class="mem-meta">{{ key }}</span>
                <span class="mem-announce">{{ val }}</span>
              </p>
              <p v-if="Object.keys(phaseSummaries).length === 0" class="empty">No phase summaries stored yet.</p>
            </div>

            <h4 style="margin-top:14px">Current Events <small>(last {{ selectedBot.memoryBytes ?? 0 }} — cleared each phase)</small></h4>
            <div class="scroll-list">
              <p v-for="(item, i) in (selectedBot.shortTermMemory || [])" :key="i" class="mem-item">
                <span class="mem-meta">
                  <template v-if="item.round != null">R{{ item.round }} </template>
                  <template v-if="item.phase">{{ item.phase }} </template>
                  <template v-if="item.kind">· {{ item.kind }}</template>
                </span>
                <template v-if="item.kind === 'chat_message'">
                  <strong>{{ item.author || item.from }}:</strong> {{ item.text }}
                </template>
                <template v-else-if="item.kind === 'announcement'">
                  <span class="mem-announce">{{ item.title }}: {{ item.message }}</span>
                </template>
                <template v-else-if="item.kind === 'intel_return'">
                  <span class="mem-intel">Intel: {{ item.intelKind || item.type }}
                    <template v-if="item.message">— {{ item.message }}</template>
                  </span>
                </template>
                <template v-else>
                  <code>{{ JSON.stringify(item) }}</code>
                </template>
              </p>
              <p v-if="!selectedBot.shortTermMemory || selectedBot.shortTermMemory.length === 0" class="empty">No current events — phase just started or memory was flushed.</p>
            </div>
          </section>

          <!-- Tab: Actions -->
          <section v-if="botTab === 'actions'" class="bot-tab-content">
            <h4>Action Log <small>(last {{ (selectedBot.actionLog || []).length }} actions)</small></h4>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr><th>Time</th><th>Round</th><th>Phase</th><th>Kind</th><th>Details</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(entry, i) in (selectedBot.actionLog || []).slice().reverse()" :key="i">
                    <td>{{ formatDate(entry.ts) }}</td>
                    <td>{{ entry.round ?? '-' }}</td>
                    <td>{{ entry.phase || '-' }}</td>
                    <td><code>{{ entry.kind }}</code></td>
                    <td class="action-detail">
                      <template v-if="entry.kind === 'chat'">
                        <span v-if="entry.text">“{{ entry.text }}”</span>
                        <span v-else-if="entry.target">→ {{ entry.target }}</span>
                      </template>
                      <template v-else-if="entry.kind === 'vote'">
                        Vote → <strong>{{ entry.target || 'skip' }}</strong>
                      </template>
                      <template v-else-if="entry.kind === 'action'">
                        <strong>{{ entry.verb }}</strong>
                        <span v-if="entry.targetCode"> → {{ entry.targetCode }}</span>
                        <span v-if="entry.target"> ({{ entry.target }})</span>
                      </template>
                      <template v-else-if="entry.kind === 'rejected'">
                        <span class="mem-intel">{{ entry.reason }}</span>
                      </template>
                      <template v-else>
                        <code>{{ JSON.stringify(entry.action || entry) }}</code>
                      </template>
                    </td>
                  </tr>
                  <tr v-if="!selectedBot.actionLog || selectedBot.actionLog.length === 0"><td colspan="5"><p class="empty">No actions recorded yet.</p></td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- Tab: Notes (existing read/write) -->
          <section v-if="botTab === 'notes'" class="bot-tab-content bot-notes-panel">
            <div class="columns">
              <div>
                <h4>Read</h4>
                <pre>{{ pretty(botNotes) }}</pre>
                <button type="button" @click="loadBotNotes(selectedBot.botId)">Reload</button>
              </div>
              <div>
                <h4>Write</h4>
                <label>Key<input v-model="noteForm.key" type="text" placeholder="P-02-suspicion" /></label>
                <label>Value<input v-model="noteForm.value" type="text" placeholder="voted against me on Day 2" /></label>
                <button type="button" @click="saveBotNote">Save note</button>
              </div>
            </div>
          </section>

          <!-- Tab: Inspect (raw JSON) -->
          <section v-if="botTab === 'inspect'" class="bot-tab-content">
            <h4>Raw session data</h4>
            <pre>{{ pretty(selectedBot) }}</pre>
          </section>
        </section>
      </section>

      <section v-if="tab === 'simulator'" class="simulator">
        <header class="detail-head">
          <div><span>BALANCE LAB</span><h2>Composition Simulator</h2></div>
        </header>
        <p class="sim-tab-hint">
          Runs heresy-sim against a composition you build here — not tied to any live conclave.
          Games are capped server-side at 500.
        </p>
        <p v-if="simError" class="error">{{ simError }}</p>

        <section class="sim-builder">
          <h3>Composition</h3>
          <div class="sim-mode-toggle">
            <button type="button" :class="{ active: simMode === 'preset' }" @click="setSimMode('preset')">Preset doctrine</button>
            <button type="button" :class="{ active: simMode === 'custom' }" @click="setSimMode('custom')">Custom roster</button>
          </div>

          <div v-if="simMode === 'preset'" class="sim-preset-picker">
            <label v-for="n in simPresetCounts" :key="n" :class="{ selected: simPresetCount === n }">
              <input type="radio" :value="n" v-model="simPresetCount">
              <span><strong>{{ n }}p</strong><small>{{ presetFlavor[n] }}</small></span>
            </label>
          </div>

          <div v-else class="sim-custom-picker">
            <label class="sim-target-size">Target roster size
              <input type="number" v-model.number="simTargetCount" min="5" max="12">
            </label>

            <div class="sim-summary-row">
              <span>Roster <strong>{{ simCustomRoster.length }} / {{ simTargetCount }}</strong></span>
              <span>Loyalists <strong class="loy">{{ simFactionCounts.loyalist }}</strong></span>
              <span>Heretics <strong class="her" :class="{ bad: simFactionCounts.heretic > simFactionCounts.loyalist }">{{ simFactionCounts.heretic }}</strong></span>
              <span>Citizens <strong>{{ simFactionCounts.citizen }}</strong></span>
            </div>

            <div class="sim-faction-columns">
              <div v-for="faction in ['loyalist', 'heretic']" :key="faction" class="sim-faction-group">
                <h4>{{ faction === 'loyalist' ? 'Loyalist choir' : 'Heretic cabal' }}</h4>
                <ul>
                  <li v-for="r in simRolesByFaction[faction]" :key="r.id" :class="{ selected: simCountInRoster(r.id) > 0 }">
                    <span>{{ r.displayName }}</span>
                    <span class="sim-count-controls">
                      <button type="button" @click="simRemoveRole(r.id)" :disabled="simCountInRoster(r.id) === 0">−</button>
                      <strong>{{ simCountInRoster(r.id) }}</strong>
                      <button type="button" @click="simAddRole(r.id)" :disabled="!simCanAdd(r.id)">+</button>
                    </span>
                  </li>
                </ul>
              </div>
            </div>

            <div class="sim-roster-preview">
              <span v-for="(id, i) in simCustomRoster" :key="id + '-' + i" class="sim-chip" :class="simRoleFaction(id)" @click="simRemoveRoleAt(i)">{{ simRoleDisplay(id) }} ×</span>
              <span v-if="!simCustomRoster.length" class="empty">No roles selected.</span>
            </div>
            <div class="actions">
              <button type="button" @click="simClearRoster" :disabled="!simCustomRoster.length">Clear roster</button>
              <button type="button" @click="simSeedMinimal">Seed minimal legal roster</button>
            </div>

            <div v-if="simLocalWarnings.length" class="warning-banner sim-warnings">
              <p v-for="w in simLocalWarnings" :key="w.rule">
                <span :class="{ acked: simConfirmedWarnings.includes(w.rule) }">{{ simConfirmedWarnings.includes(w.rule) ? '✓' : '○' }}</span> {{ w.message }}
              </p>
              <button type="button" @click="simAcknowledgeAll">Acknowledge all &amp; proceed</button>
            </div>
            <div v-if="simLocalHardErrors.length" class="error sim-hard-errors">
              <p v-for="e in simLocalHardErrors" :key="e.rule">{{ e.message }}</p>
            </div>
          </div>
        </section>

        <section class="sim-run">
          <label>Games
            <input type="number" v-model.number="simGamesCount" min="1" max="500">
          </label>
          <button type="button" :disabled="simBusy || !simCompositionValid" @click="runAdminSimulation">{{ simBusy ? 'Running…' : 'Run Simulation' }}</button>
        </section>

        <SimResultsPanel v-if="simResult" :result="simResult" />
      </section>
    </section>
  </main>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { pickBotName } from '../botNames.js';
import { validRoles, hardRules, presetFlavor } from '../compositionData.js';
import { validateComposition } from '../server-composition-validator.js';
import SimResultsPanel from './SimResultsPanel.vue';
import phases from '@game_data/phases.json';
import rules from '@game_data/rules.json';
import { DRIFT } from '../driftCosts.js';

const STORAGE_KEY = 'heresy-rising:adminPassword';
const passwordInput = ref(sessionStorage.getItem(STORAGE_KEY) || '');
const password = ref(sessionStorage.getItem(STORAGE_KEY) || '');
const authenticated = ref(!!password.value);
const loading = ref(false);
const error = ref('');
const tab = ref('cells');
const games = ref([]);
const totals = ref({});
const roles = ref([]);
const detail = ref(null);
const selectedCode = ref('');
const logs = ref([]);
const selectedLog = ref(null);

const players = ref([]);
const loadingPlayers = ref(false);
const playerError = ref('');
const mergeForm = ref({ fromPlayerCode: '', toPlayerCode: '' });
const mergeResult = ref(null);

const bots = ref([]);
const botsPolling = ref(false);
let botsPollTimer = null;
const loadingBots = ref(false);
const botError = ref('');
const spawnForm = ref({ conclaveCode:'', name:'', seatHint:null, costCeiling:50000, personaOverrides:'' });
const lastSpawnResult = ref(null);
const selectedBot = ref(null);
const botNotes = ref({});
const noteForm = ref({ key:'', value:'' });
const botTab = ref('memory');
const botTabs = [
  { id: 'memory', label: 'Memory' },
  { id: 'actions', label: 'Actions' },
  { id: 'notes', label: 'Notes' },
  { id: 'inspect', label: 'Inspect' }
];
const phaseSummaries = computed(() => {
  const notes = botNotes.value || {};
  return Object.fromEntries(
    Object.entries(notes).filter(([k]) => k.startsWith('phase-'))
  );
});
const averageDrift = computed(() => {
  const players = detail.value?.players || [];
  return players.length ? players.reduce((sum, player) => sum + Number(player.drift || 0), 0) / players.length : 0;
});
const highestDriftPlayer = computed(() => {
  const players = detail.value?.players || [];
  return players.reduce((highest, player) => !highest || Number(player.drift || 0) > Number(highest.drift || 0) ? player : highest, null);
});
const playersAtMaxDrift = computed(() => {
  const maxDrift = Number(detail.value?.game?.maxDrift || 0);
  return (detail.value?.players || []).filter(player => Number(player.drift || 0) >= maxDrift).length;
});
const archiveMaxDrift = computed(() => Number(selectedLog.value?.maxDrift) || DRIFT.MAX);
const archiveEvents = computed(() => (selectedLog.value?.events || []).map(event => ({
  ...event,
  createdAt: event.createdAt || event.created_at,
  payload: parsePayload(event.payload)
})));
const archiveDriftEntries = computed(() => {
  const values = new Map();
  const players = new Map((selectedLog.value?.players || []).map(player => [player.playerCode || player.id, player]));
  return archiveEvents.value.filter(event => event.type === 'drift').map(event => {
    const payload = event.payload || {};
    const previous = values.get(payload.playerCode) || 0;
    const before = Number.isFinite(Number(payload.before)) ? Number(payload.before) : previous;
    const after = Number.isFinite(Number(payload.after)) ? Number(payload.after) : Math.max(0, Math.min(archiveMaxDrift.value, before + Number(payload.delta || 0)));
    values.set(payload.playerCode, after);
    return {
      id: event.id,
      createdAt: event.createdAt,
      playerCode: payload.playerCode,
      playerName: players.get(payload.playerCode)?.name || payload.playerCode || 'Unknown',
      delta: Number(payload.delta || 0),
      before,
      after,
      reason: payload.reason,
      zone: payload.zone,
      round: payload.round,
      phase: payload.phase
    };
  });
});
const archivePlayers = computed(() => {
  const finalByPlayer = new Map();
  for (const entry of archiveDriftEntries.value) finalByPlayer.set(entry.playerCode, entry.after);
  return (selectedLog.value?.players || []).map(player => ({
    ...player,
    alive: player.alive === undefined ? null : player.alive,
    finalDrift: Number.isFinite(Number(player.drift)) ? Number(player.drift) : finalByPlayer.get(player.playerCode || player.id) || 0
  }));
});

const headers = computed(() => ({ 'Content-Type': 'application/json', 'X-Admin-Password': password.value }));

async function adminFetch(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { ...headers.value, ...(options.headers || {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed (${res.status})`);
    if (body.details) err.details = body.details;
    throw err;
  }
  return res.json();
}
async function login() {
  error.value = '';
  loading.value = true;
  try {
    password.value = passwordInput.value;
    await adminFetch('/api/admin/login', { method: 'POST', body: '{}' });
    sessionStorage.setItem(STORAGE_KEY, password.value);
    authenticated.value = true;
    await loadOverview();
  } catch (err) {
    error.value = err.message;
    authenticated.value = false;
  } finally {
    loading.value = false;
  }
}
function logout() {
  sessionStorage.removeItem(STORAGE_KEY);
  password.value = '';
  passwordInput.value = '';
  authenticated.value = false;
  if (botsPollTimer) { clearInterval(botsPollTimer); botsPollTimer = null; }
  botsPolling.value = false;
}
async function loadOverview() {
  error.value = '';
  loading.value = true;
  try {
    const data = await adminFetch('/api/admin/overview');
    games.value = data.games || [];
    totals.value = data.totals || {};
    roles.value = data.roles || [];
    if (!selectedCode.value && games.value[0]) await loadGame(games.value[0].code);
    else if (selectedCode.value) await loadGame(selectedCode.value).catch(() => { detail.value = null; selectedCode.value = ''; });
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}
async function loadGame(code) {
  selectedCode.value = code;
  detail.value = await adminFetch(`/api/admin/games/${encodeURIComponent(code)}`);
}
async function savePlayer(player) {
  const data = await adminFetch(`/api/admin/games/${encodeURIComponent(selectedCode.value)}/players/${encodeURIComponent(player.playerCode)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      roleId: player.roleId,
      faction: player.faction || null,
      drift: player.drift,
      alive: player.alive,
      ready: player.ready,
      connected: player.connected,
      confessed: player.confessed
    })
  });
  Object.assign(player, data.player);
}
async function endGame(winner) {
  if (!selectedCode.value || !confirm(`End conclave ${selectedCode.value}?`)) return;
  detail.value = await adminFetch(`/api/admin/games/${encodeURIComponent(selectedCode.value)}/end`, { method: 'POST', body: JSON.stringify({ winner }) });
  await loadOverview();
}
async function deleteGame() {
  if (!selectedCode.value || !confirm(`Permanently delete conclave ${selectedCode.value}?`)) return;
  await adminFetch(`/api/admin/games/${encodeURIComponent(selectedCode.value)}`, { method: 'DELETE' });
  detail.value = null;
  selectedCode.value = '';
  await loadOverview();
}
async function openLogs() {
  tab.value = 'logs';
  if (!logs.value.length) await loadLogs();
}
async function loadLogs() {
  const data = await adminFetch('/api/admin/game-logs?limit=200');
  logs.value = data.logs || [];
}
async function loadLog(id) {
  const data = await adminFetch(`/api/admin/game-logs/${encodeURIComponent(id)}`);
  selectedLog.value = data.log;
}
async function deleteLog(log) {
  if (!confirm(`Delete log for ${log.roomCode}?`)) return;
  await adminFetch(`/api/admin/game-logs/${encodeURIComponent(log.id)}`, { method: 'DELETE' });
  logs.value = logs.value.filter(item => item.id !== log.id);
  if (selectedLog.value?.id === log.id) selectedLog.value = null;
}

// ── Player Management ─────────────────────────────────────────────────────
async function openPlayers() {
  tab.value = 'players';
  if (!players.value.length) await loadPlayers();
}
async function loadPlayers() {
  playerError.value = '';
  loadingPlayers.value = true;
  try {
    const data = await adminFetch('/api/admin/players');
    players.value = data.players || [];
    mergeResult.value = null;
  } catch (err) {
    playerError.value = err.message;
  } finally {
    loadingPlayers.value = false;
  }
}
function selectPlayerForMerge(playerCode) {
  mergeForm.value.toPlayerCode = playerCode;
}
async function mergeProfiles() {
  const { fromPlayerCode, toPlayerCode } = mergeForm.value;
  if (!fromPlayerCode || !toPlayerCode) return;
  if (!confirm(`Merge ${fromPlayerCode} → ${toPlayerCode}?\n\nBoth profiles must have non-overlapping games.`)) return;
  playerError.value = '';
  loadingPlayers.value = true;
  try {
    const result = await adminFetch(`/api/admin/players/${encodeURIComponent(fromPlayerCode)}/merge`, {
      method: 'POST',
      body: JSON.stringify({ targetPlayerCode: toPlayerCode })
    });
    mergeResult.value = result;
    mergeForm.value = { fromPlayerCode: '', toPlayerCode: '' };
    await loadPlayers();
  } catch (err) {
    playerError.value = err.message;
    mergeResult.value = { error: err.message };
  } finally {
    loadingPlayers.value = false;
  }
}
async function deletePlayer(player) {
  if (player.activeGames.length > 0) {
    alert(`Cannot delete: player still has ${player.activeGames.length} active game(s).`);
    return;
  }
  if (!confirm(`Permanently delete ${player.playerCode}?\n\nThis will remove ${player.gameCount} game record(s). This action cannot be undone.`)) return;
  playerError.value = '';
  loadingPlayers.value = true;
  try {
    await adminFetch(`/api/admin/players/${encodeURIComponent(player.playerCode)}`, { method: 'DELETE' });
    players.value = players.value.filter(p => p.playerCode !== player.playerCode);
  } catch (err) {
    playerError.value = err.message;
  } finally {
    loadingPlayers.value = false;
  }
}

// ── Heresy Bots ──────────────────────────────────────────────────────────
// All bot endpoints are proxied through the heresy-server's
// /api/admin/bots/* routes — the browser only ever holds ADMIN_PASSWORD; the
// server forwards each call to the bot-manager's REST API with its own
// ADMIN_API_KEY. Persona overrides and per-game cost ceiling are sent in the
// spawn body per the locked v1.1.0 spec.
async function openBots() {
  tab.value = 'bots';
  if (!bots.value.length) await loadBots();
}
async function loadBots() {
  botError.value = '';
  loadingBots.value = true;
  try {
    bots.value = await adminFetch('/api/admin/bots');
  } catch (err) {
    botError.value = err.message;
  } finally {
    loadingBots.value = false;
  }
}
function toggleBotsPolling() {
  botsPolling.value = !botsPolling.value;
  if (botsPolling.value) {
    if (botsPollTimer) clearInterval(botsPollTimer);
    botsPollTimer = setInterval(loadBots, 3000);
  } else if (botsPollTimer) {
    clearInterval(botsPollTimer); botsPollTimer = null;
  }
}
async function spawnBot() {
  botError.value = '';
  loadingBots.value = true;
  try {
    const rawName = String(spawnForm.value.name || '').trim();
    const body = {
      conclaveCode: String(spawnForm.value.conclaveCode || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8),
      name: (rawName || pickBotName()).slice(0, 20),
      seatHint: spawnForm.value.seatHint != null && spawnForm.value.seatHint !== '' ? Number(spawnForm.value.seatHint) : null,
      costCeiling: Number(spawnForm.value.costCeiling) > 0 ? Number(spawnForm.value.costCeiling) : null,
      personaOverrides: spawnForm.value.personaOverrides || null
    };
    if (!body.conclaveCode) throw new Error('Conclave code is required');
    const data = await adminFetch('/api/admin/bots', { method: 'POST', body: JSON.stringify(body) });
    lastSpawnResult.value = data;
    await loadBots();
  } catch (err) {
    botError.value = err.message;
  } finally {
    loadingBots.value = false;
  }
}
async function despawnBot(bot) {
  if (!confirm(`Despawn bot ${bot.botId} (conclave ${bot.conclaveCode})?`)) return;
  botError.value = '';
  try {
    await adminFetch(`/api/admin/bots/${encodeURIComponent(bot.botId)}`, { method: 'DELETE' });
    if (selectedBot.value?.botId === bot.botId) selectedBot.value = null;
    await loadBots();
  } catch (err) {
    botError.value = err.message;
  }
}
async function selectBot(id) {
  botError.value = '';
  try {
    selectedBot.value = await adminFetch(`/api/admin/bots/${encodeURIComponent(id)}`);
    await loadBotNotes(id);
  } catch (err) {
    botError.value = err.message;
  }
}
async function loadBotNotes(id) {
  try {
    botNotes.value = await adminFetch(`/api/admin/bots/${encodeURIComponent(id)}/notes`);
  } catch (err) {
    botNotes.value = { error: err.message };
  }
}
async function saveBotNote() {
  if (!selectedBot.value || !noteForm.value.key) return;
  botError.value = '';
  try {
    await adminFetch(`/api/admin/bots/${encodeURIComponent(selectedBot.value.botId)}/notes`, {
      method: 'POST',
      body: JSON.stringify({ key: noteForm.value.key, value: noteForm.value.value })
    });
    noteForm.value = { key:'', value:'' };
    await loadBotNotes(selectedBot.value.botId);
  } catch (err) {
    botError.value = err.message;
  }
}
// ── Simulator tab ────────────────────────────────────────────────────────
// Standalone balance-check runner: build a composition (preset or custom —
// same picker semantics as LobbyView's host-only composition card, but not
// tied to a live conclave, so a "target roster size" stands in for the
// player count a real lobby would otherwise supply) and POST it to
// /api/admin/simulate. No cooldown here — the server enforces its own
// (higher) cap on this path but doesn't rate-limit it per Phase 2.
const simPresetCounts = Array.from({ length: rules.MAX_PLAYERS - rules.MIN_PLAYERS + 1 }, (_, i) => rules.MIN_PLAYERS + i);
const simMode = ref('preset');
const simPresetCount = ref(5);
const simTargetCount = ref(5);
const simCustomRoster = ref([]);
const simConfirmedWarnings = ref([]);
const simGamesCount = ref(200);
const simBusy = ref(false);
const simError = ref('');
const simResult = ref(null);

const simRolesByFaction = computed(() => {
  const loy = [], her = [];
  for (const [, r] of validRoles) {
    if (r.faction === 'loyalist') loy.push(r);
    else her.push(r);
  }
  return { loyalist: loy, heretic: her };
});
function simCountInRoster(id) { return simCustomRoster.value.filter(x => x === id).length; }
const simRosterFull = computed(() => simCustomRoster.value.length >= simTargetCount.value);
const simFactionCounts = computed(() => {
  let loyalist = 0, heretic = 0, citizen = 0;
  for (const id of simCustomRoster.value) {
    const r = validRoles.get(id);
    if (!r) continue;
    if (id === 'imperial-citizen') citizen++;
    else if (r.faction === 'heretic') heretic++;
    else loyalist++;
  }
  return { loyalist, heretic, citizen };
});
function simCanAdd(id) {
  const role = validRoles.get(id);
  if (!role) return false;
  if (simRosterFull.value) return false;
  if (id !== 'imperial-citizen' && simCountInRoster(id) >= 1) return false;
  if (role.faction === 'heretic' && simFactionCounts.value.heretic + 1 > simFactionCounts.value.loyalist) return false;
  return true;
}
function simAddRole(id) { if (simCanAdd(id)) simCustomRoster.value.push(id); }
function simRemoveRole(id) { const idx = simCustomRoster.value.indexOf(id); if (idx !== -1) simCustomRoster.value.splice(idx, 1); }
function simRemoveRoleAt(i) { simCustomRoster.value.splice(i, 1); }
function simClearRoster() { simCustomRoster.value = []; simConfirmedWarnings.value = []; }
function simSeedMinimal() {
  const n = simTargetCount.value;
  if (n < 5) return;
  const base = ['murderer', 'interrogator'];
  while (base.length < n) base.push('imperial-citizen');
  simCustomRoster.value = base;
  simConfirmedWarnings.value = [];
}
function simRoleDisplay(id) { return validRoles.get(id)?.displayName || id; }
function simRoleFaction(id) { return validRoles.get(id)?.faction || ''; }
function setSimMode(mode) {
  if (simMode.value === mode) return;
  simMode.value = mode;
  simConfirmedWarnings.value = [];
  simResult.value = null;
  simError.value = '';
}
watch(simTargetCount, () => { simConfirmedWarnings.value = []; });

const simLocalValidation = computed(() => {
  if (simMode.value === 'preset') return { ok: true, errors: [], warnings: [] };
  return validateComposition({
    roster: simCustomRoster.value,
    playerCount: simTargetCount.value,
    confirmedWarnings: simConfirmedWarnings.value,
    validRoles,
    hardRules,
    source: 'custom'
  });
});
const simLocalHardErrors = computed(() => simLocalValidation.value.errors.filter(e => e.kind === 'hard'));
const simLocalWarnings = computed(() => simLocalValidation.value.warnings);
const simCompositionValid = computed(() => {
  if (simMode.value === 'preset') return simPresetCounts.includes(simPresetCount.value);
  return simLocalValidation.value.ok;
});
function simAcknowledgeAll() {
  simConfirmedWarnings.value = Array.from(new Set([...simConfirmedWarnings.value, ...simLocalWarnings.value.map(w => w.rule)]));
}

function buildSimComposition() {
  if (simMode.value === 'preset') {
    return { source: 'preset', presetId: simPresetCount.value + 'p' };
  }
  return { source: 'custom', roster: [...simCustomRoster.value], confirmedWarnings: [...simConfirmedWarnings.value] };
}

async function runAdminSimulation() {
  simError.value = '';
  simBusy.value = true;
  try {
    const games = Math.min(500, Math.max(1, Math.round(Number(simGamesCount.value) || 200)));
    simResult.value = await adminFetch('/api/admin/simulate', {
      method: 'POST',
      body: JSON.stringify({ composition: buildSimComposition(), games })
    });
  } catch (err) {
    simError.value = err.details?.length
      ? [err.message, ...err.details.map(d => d.message)].join(' — ')
      : err.message;
    simResult.value = null;
  } finally {
    simBusy.value = false;
  }
}

async function copyJson(value) {
  await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
}
function pretty(value) {
  return JSON.stringify(value || [], null, 2);
}
function parsePayload(value) {
  if (!value || typeof value !== 'string') return value || {};
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
}
function formatDrift(value) {
  const drift = Number(value);
  return Number.isFinite(drift) ? drift.toFixed(1) : '0.0';
}
function formatDate(value) {
  if (!value) return '-';
  const numeric = Number(value);
  return new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000).toLocaleString();
}

// roundActionStatus tracks whether a bot has submitted its night action /
// day vote for the CURRENT round — unlike `lastAction` (a noisy free-text
// trace overwritten by every routine state tick), this field only changes
// on a real submit/pass/reject/error and is what admins should trust to
// answer "did this bot act?".
const ROUND_ACTION_LABELS = {
  pending: 'Pending', submitted: 'Submitted', passed: 'Passed',
  rejected: 'Rejected', error: 'Error', 'n/a': 'N/A'
};
function roundActionLabel(bot) {
  return ROUND_ACTION_LABELS[bot?.roundActionStatus] || bot?.roundActionStatus || '-';
}
function roundActionBadgeClass(bot) {
  const status = bot?.roundActionStatus;
  if (status === 'submitted') return 'badge-active';
  if (status === 'pending') return 'badge-pending';
  if (status === 'passed') return 'badge-passive';
  if (status === 'rejected' || status === 'error') return 'badge-rejected';
  return 'badge-na';
}
function roundActionTitle(bot) {
  const d = bot?.roundActionDetail;
  if (!d) return bot?.phase === 'night' ? 'Night action for this round' : 'Vote for this round';
  if (d.verb) return `${d.verb}${d.target ? ' -> ' + d.target : ''}`;
  if (d.target) return `target: ${d.target}${d.justification ? ' — ' + d.justification : ''}`;
  return d.reason || JSON.stringify(d);
}

if (authenticated.value) loadOverview();
</script>

<style scoped>
.admin-shell{min-height:100vh;background:#101312;color:#e7e3d5;padding:24px;font-family:Inter,system-ui,sans-serif}.login-panel,.control-room{max-width:1500px;margin:0 auto}.login-panel{width:min(440px,100%);margin-top:12vh;background:#171a16;border:1px solid #34372f;padding:28px}.login-panel span,.topbar span,.detail-head span{color:#b69a5c;font-size:11px;font-weight:800;letter-spacing:.16em}.login-panel h1,.topbar h1,.detail-head h2{margin:6px 0 18px;font-family:Cinzel,serif}.login-panel form{display:grid;gap:14px}label{display:grid;gap:7px;font-size:11px;font-weight:800;text-transform:uppercase;color:#aaa99d}input,select{background:#0d0f0d;border:1px solid #3a3c34;color:#e7e3d5;padding:9px;border-radius:2px}button{background:#8f7543;border:1px solid #b99c62;color:#0b0c0a;padding:9px 12px;text-transform:uppercase;font-size:10px;font-weight:800;letter-spacing:.1em;cursor:pointer}button.danger{background:#7a2a25;border-color:#a8463d;color:#fff}button:disabled{opacity:.5}.error{border:1px solid #70352f;background:#321916;color:#d99b95;padding:10px}.topbar,.detail-head,.actions{display:flex;align-items:center;justify-content:space-between;gap:12px}.actions{justify-content:flex-end}.metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:20px 0}.metrics div,.detail,.logs,.cell-list button{background:#171a16;border:1px solid #34372f}.metrics div{padding:14px}.metrics span,.facts span{display:block;color:#8f9287;font-size:10px;text-transform:uppercase;letter-spacing:.12em}.metrics strong{display:block;margin-top:5px;font-size:24px}.tabs{display:flex;gap:8px;margin-bottom:14px}.tabs .active,.cell-list .selected{background:#2b271b;color:#dfc27c;border-color:#b69a5c}.layout{display:grid;grid-template-columns:300px minmax(0,1fr);gap:14px}.cell-list{display:grid;align-content:start;gap:8px}.cell-list button{text-align:left;color:#e7e3d5;padding:14px}.cell-list strong,.cell-list span,.cell-list small{display:block}.cell-list span{margin-top:4px;color:#c8c0aa}.cell-list small{margin-top:5px;color:#8f9287}.detail,.logs{padding:18px;min-width:0}.facts{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:16px 0}.facts span{background:#0d0f0d;border:1px solid #2c3028;padding:10px}.facts strong{display:block;color:#e7e3d5;margin-top:4px;text-transform:none;letter-spacing:0}.table-wrap{overflow:auto;border:1px solid #34372f}table{width:100%;border-collapse:collapse;min-width:900px}th,td{border-bottom:1px solid #2c3028;padding:9px;text-align:left;vertical-align:top}th{color:#b69a5c;font-size:10px;text-transform:uppercase;letter-spacing:.12em;background:#11130f}td code{display:block;margin-top:4px;color:#8f9287;font-size:10px}.checks{display:grid;grid-template-columns:repeat(2,minmax(90px,1fr));gap:6px}.checks label{display:flex;align-items:center;gap:5px;text-transform:none;font-weight:600;letter-spacing:0}.checks input{width:auto}.columns{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}pre,.scroll-list{max-height:360px;overflow:auto;background:#0b0d0b;border:1px solid #2c3028;color:#d9d7cc;padding:12px;font-size:12px;line-height:1.5}.scroll-list p{border-bottom:1px solid #252820;margin:0;padding:9px 0;white-space:pre-wrap}.scroll-list span{display:block;color:#8f9287;font-size:10px;margin-bottom:4px}.badge-passive{display:inline-block;background:#5a3e1f;color:#f0c674;border:1px solid #8f6d3a;padding:2px 6px;font-size:9px;font-weight:700;letter-spacing:.12em;border-radius:2px;white-space:nowrap}.badge-active{display:inline-block;background:#1f3a25;color:#74c68a;border:1px solid #3a6d4a;padding:2px 6px;font-size:9px;font-weight:700;letter-spacing:.12em;border-radius:2px;white-space:nowrap}.badge-pending{display:inline-block;background:#2c2e28;color:#c8c0aa;border:1px solid #4a4c42;padding:2px 6px;font-size:9px;font-weight:700;letter-spacing:.12em;border-radius:2px;white-space:nowrap}.badge-rejected{display:inline-block;background:#3a1c1a;color:#e08a80;border:1px solid #70352f;padding:2px 6px;font-size:9px;font-weight:700;letter-spacing:.12em;border-radius:2px;white-space:nowrap}.badge-na{display:inline-block;background:#1a1c18;color:#6c6f64;border:1px solid #34372f;padding:2px 6px;font-size:9px;font-weight:700;letter-spacing:.12em;border-radius:2px;white-space:nowrap}.warning-banner{background:#3a2a0f;border:1px solid #8f6d3a;color:#f0c674;padding:10px;margin:10px 0;font-size:12px;border-radius:2px}.empty{color:#8f9287}.bot-detail{background:#171a16;border:1px solid #34372f;padding:18px;margin-top:14px}.bot-detail .facts{grid-template-columns:repeat(5,minmax(0,1fr))}.bot-tab-content h4{margin:0 0 10px;font-family:Cinzel,serif;color:#c8c0aa}.bot-tab-content h4 small{font-size:10px;color:#8f9287;font-weight:400}.mem-item{padding:7px 0;border-bottom:1px solid #252820;font-size:12px;line-height:1.5;white-space:pre-wrap}.mem-meta{display:block;color:#8f9287;font-size:10px;margin-bottom:3px}.mem-announce{color:#b69a5c}.mem-intel{color:#c67a5c}.action-detail{font-size:12px}.bot-notes-panel pre{max-height:200px}.bot-notes-panel .columns{gap:20px}@media(max-width:900px){.metrics,.facts,.columns,.layout{grid-template-columns:1fr}.topbar,.detail-head{align-items:flex-start;flex-direction:column}}

/* Simulator tab */
.simulator { max-width: 1100px; }
.sim-tab-hint { color: #8f9287; font-size: 12.5px; line-height: 1.6; margin: -6px 0 18px; max-width: 720px; }
.sim-builder { background: #171a16; border: 1px solid #34372f; padding: 18px; margin-bottom: 16px; }
.sim-builder h3 { margin: 0 0 12px; font-family: Cinzel, serif; color: #c8c0aa; font-size: 15px; }
.sim-mode-toggle { display: flex; gap: 10px; margin-bottom: 14px; }
.sim-mode-toggle button { flex: 1; background: #0d0f0d; border: 1px solid #3a3c34; color: #b7b6aa; }
.sim-mode-toggle button.active { border-color: #b69a5c; color: #dfc27c; background: #241f10; }
.sim-preset-picker { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
.sim-preset-picker label { display: flex; align-items: flex-start; gap: 9px; padding: 11px 12px; border: 1px solid #34372f; background: #0d0f0d; border-radius: 2px; cursor: pointer; margin: 0; }
.sim-preset-picker label.selected { border-color: #b69a5c; background: #241f10; }
.sim-preset-picker label input { flex: 0 0 auto; margin-top: 3px; }
.sim-preset-picker span { display: flex; flex-direction: column; gap: 3px; }
.sim-preset-picker small { color: #8f9287; text-transform: none; font-weight: 500; letter-spacing: 0; }
.sim-target-size { display: inline-flex; flex-direction: column; gap: 6px; width: 160px; margin-bottom: 14px; }
.sim-summary-row { display: flex; flex-wrap: wrap; gap: 10px 20px; padding: 10px 12px; border: 1px solid #34372f; background: #0d0f0d; border-radius: 2px; margin-bottom: 14px; font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: #8f9287; }
.sim-summary-row strong { display: block; margin-top: 3px; font-size: 15px; color: #e7e3d5; text-transform: none; letter-spacing: 0; }
.sim-summary-row strong.loy { color: #9fbf8a; }
.sim-summary-row strong.her { color: #d58c75; }
.sim-summary-row strong.bad { text-decoration: underline; text-decoration-color: #d58c75; }
.sim-faction-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 14px; }
.sim-faction-group h4 { margin: 0 0 8px; font-family: Cinzel, serif; font-size: 12.5px; letter-spacing: .05em; color: #dfc27c; }
.sim-faction-group ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.sim-faction-group li { display: flex; align-items: center; justify-content: space-between; gap: 8px; border: 1px solid #2a2c25; background: #0c0e0c; border-radius: 2px; padding: 8px 10px; font-size: 12.5px; }
.sim-faction-group li.selected { border-color: #4a4434; background: #11100a; }
.sim-count-controls { display: flex; align-items: center; gap: 7px; }
.sim-count-controls button { width: 22px; height: 22px; padding: 0; border: 1px solid #43463d; background: #171916; color: #e7e3d5; font: 700 13px Inter; line-height: 1; }
.sim-count-controls strong { min-width: 12px; text-align: center; font-size: 12px; }
.sim-roster-preview { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 0; }
.sim-chip { display: inline-flex; align-items: center; gap: 5px; padding: 5px 9px; border: 1px solid #43463d; background: #171916; color: #e7e3d5; font-size: 11px; border-radius: 2px; cursor: pointer; }
.sim-chip.loyalist { border-color: #43503a; }
.sim-chip.heretic { border-color: #5a3a36; color: #e2b3ac; }
.sim-warnings p, .sim-hard-errors p { margin: 4px 0; font-size: 12px; }
.sim-warnings span.acked { opacity: .55; }
.sim-warnings button { margin-top: 8px; }
.sim-run { display: flex; align-items: flex-end; gap: 14px; margin-bottom: 6px; }
.sim-run label { width: 120px; }

/* Players tab */
.players { max-width: 1100px; }
.merge-form { background: #171a16; border: 1px solid #34372f; padding: 18px; margin-bottom: 16px; }
.merge-form h3 { margin: 0 0 6px; font-family: Cinzel, serif; color: #c8c0aa; font-size: 15px; }
.form-hint { color: #8f9287; font-size: 12px; margin: 0 0 12px; }
.merge-inputs { display: grid; grid-template-columns: 1fr 1fr auto; gap: 12px; align-items: flex-end; margin-bottom: 12px; }
.merge-inputs label { margin: 0; }
.merge-inputs button { margin: 0; }
.merge-form .ok { border: 1px solid #3a6d4a; background: #0d1f16; color: #74c68a; }
.merge-form .error { border: 1px solid #70352f; background: #321916; color: #d99b95; }
.players-list { background: #171a16; border: 1px solid #34372f; padding: 18px; }
.players-list h3 { margin: 0 0 14px; font-family: Cinzel, serif; color: #c8c0aa; font-size: 15px; }
.players-list tr.has-active { background: #0d0f0d; }
.players-list .game-codes { display: block; font-size: 10px; color: #8f9287; margin-top: 2px; }
</style>
