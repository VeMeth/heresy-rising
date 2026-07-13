import { io } from '../../../heresy-client/node_modules/socket.io-client/build/esm/index.js';

export class HeresySocketClient {
  constructor({ baseUrl, playerCode, name }) {
    this.baseUrl = baseUrl;
    this.playerCode = playerCode;
    this.name = name;
    this.state = null;
    this.messages = [];
    this.events = [];
    this.socket = io(baseUrl, {
      autoConnect: false,
      transports: ['websocket'],
      auth: playerCode ? { playerCode } : undefined
    });

    for (const event of ['game:state', 'phase:updated', 'vote:state', 'game:ended']) {
      this.socket.on(event, payload => {
        if (event === 'game:state' || event === 'phase:updated') this.state = payload?.state ?? payload;
        this.events.push({ event, payload });
      });
    }
    this.socket.on('chat:message', payload => {
      const message = payload?.message ?? payload;
      this.messages.push(message);
      this.events.push({ event: 'chat:message', payload: message });
    });
  }

  async connect() {
    if (this.socket.connected) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out connecting ${this.name}`)), 5_000);
      this.socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.once('connect_error', error => {
        clearTimeout(timer);
        reject(error);
      });
      this.socket.connect();
    });
  }

  emit(event, payload = {}) {
    return new Promise((resolve, reject) => {
      this.socket.timeout(5_000).emit(event, { playerCode: this.playerCode, ...payload }, (error, acknowledgement) => {
        if (error) return reject(new Error(`${event}: acknowledgement timeout`));
        if (!acknowledgement?.ok) return reject(new Error(`${event}: ${acknowledgement?.error || 'failed'}`));
        const { ok, ...data } = acknowledgement;
        resolve(acknowledgement.data ?? data);
      });
    });
  }

  waitFor(predicate, { timeout = 10_000, description = 'condition' } = {}) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const check = () => {
        if (predicate()) return resolve();
        if (Date.now() - startedAt >= timeout) return reject(new Error(`Timed out waiting for ${description}`));
        setTimeout(check, 25);
      };
      check();
    });
  }

  disconnect() {
    this.socket.disconnect();
  }
}
