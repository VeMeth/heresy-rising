import { io } from 'socket.io-client';

// Opens a Socket.IO client to the engine using the bot's playerCode as auth.
// The engine treats bots identically to human sockets — the bot just joins the
// conclave and listens. /api/bots/spawn already reserved the seat, so the
// server's `reconnect()` will succeed.
export function openEngineSocket({ baseUrl, conclaveCode, playerCode, transports = ['websocket'] }) {
  const url = String(baseUrl || '').replace(/\/$/, '');
  const socket = io(url, {
    autoConnect: false,
    transports,
    reconnection: true,
    reconnectionAttempts: 6,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    auth: { playerCode }
  });

  let joinResolver, joinRejecter;
  const joinPromise = new Promise((resolve, reject) => { joinResolver = resolve; joinRejecter = reject; });

  // `once('connect')` then `.connect()` — autoConnect:true can fire connect
  // before our handler installs, leaving the bot's first game:state join stuck
  // indefinitely. The HeresySocketClient helper uses the same shape.
  socket.once('connect', () => {
    socket.timeout(5000).emit('game:state', { code: conclaveCode, playerCode }, (err, ack) => {
      if (err) return joinRejecter(new Error(`game:state timed out: ${err.message || 'no ack'}`));
      if (ack && ack.ok !== false) return joinResolver(ack);
      joinRejecter(new Error(ack?.error || `game:state ack malformed: ${JSON.stringify(ack)?.slice(0,200)}`));
    });
  });
  socket.once('connect_error', (err) => joinRejecter(new Error(`socket connect_error: ${err.message}`)));
  socket.connect();

  return { socket, joinPromise };
}