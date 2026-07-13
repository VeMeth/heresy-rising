import { io } from 'socket.io-client';

const PLAYER_CODE = 'heresy-rising:playerCode';
const legacyProfile = (() => { try { return JSON.parse(localStorage.getItem('heresy-rising:profile')); } catch { return null; } })();
let playerCode = localStorage.getItem(PLAYER_CODE) || legacyProfile?.playerCode || `HR-${Array.from(crypto.getRandomValues(new Uint8Array(8)), n => n.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
localStorage.setItem(PLAYER_CODE, playerCode);
export function getPlayerCode() { return playerCode; }

export const socket = io({ autoConnect: false, transports: ['websocket'], auth: cb => cb({ playerCode }) });
export function setPlayerCode(code) { playerCode = code || ''; if (code) localStorage.setItem(PLAYER_CODE, code); socket.auth = { playerCode }; }
export function emitWithAck(event, payload) { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('The server did not answer in time.')), 15000); socket.emit(event, payload, response => { clearTimeout(timer); if (response?.ok === false) reject(new Error(response.error || 'Request rejected')); else resolve(response?.data ?? response); }); }); }
export function ensureConnected() { if (socket.connected) return Promise.resolve(); return new Promise((resolve, reject) => { const timer = setTimeout(() => { cleanup(); reject(new Error('Unable to reach the game server.')); }, 10000); const cleanup = () => { clearTimeout(timer); socket.off('connect', ok); socket.off('connect_error', fail); }; const ok = () => { cleanup(); resolve(); }; const fail = e => { cleanup(); reject(e); }; socket.once('connect', ok); socket.once('connect_error', fail); socket.connect(); }); }
