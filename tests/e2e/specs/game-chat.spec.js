import { expect, test } from '@playwright/test';
import { HeresySocketClient } from '../helpers/socketClient.js';

const BASE_URL = process.env.E2E_SERVER_URL || 'http://127.0.0.1:4100';

test('players create a game and public chat is persisted', async () => {
  const stamp = Date.now();
  const host = new HeresySocketClient({
    baseUrl: BASE_URL,
    name: 'Host',
    playerCode: `E2EHOST${stamp}`
  });
  const guest = new HeresySocketClient({
    baseUrl: BASE_URL,
    name: 'Guest',
    playerCode: `E2EGUEST${stamp}`
  });

  try {
    await Promise.all([host.connect(), guest.connect()]);
    const created = await host.emit('game:create', { name: host.name, mode: 'live' });
    const gameCode = created.code;
    expect(gameCode).toBeTruthy();
    await guest.emit('game:join', { code: gameCode, name: guest.name });

    await host.emit('chat:send', { code: gameCode, channel: 'public', body: 'Trust is a weapon.' });
    await guest.waitFor(() => guest.messages.some(message => message.body === 'Trust is a weapon.'), {
      description: 'broadcast public message'
    });

    const history = await guest.emit('chat:history', { code: gameCode, channel: 'public' });
    const messages = history.messages ?? history;
    const persisted = messages.find(message => message.body === 'Trust is a weapon.');
    expect(persisted).toBeTruthy();
    expect(persisted.id).toBeGreaterThan(0);
  } finally {
    host.disconnect();
    guest.disconnect();
  }
});
