/* ---------- חיבור לשרת (WebSocket) ---------- */
// המודול הזה רק מעביר הודעות: הוא לא יודע מה אומרת כל הודעה. כל תכונה רושמת מטפל להודעות שלה עם onMessage.
// מטפלים של אותו סוג רצים לפי סדר ההרשמה (ההרשמות נעשות ב-main.js).
import { state, bus } from './state.js';
import { offlineEl } from './dom.js';

const handlers = new Map();

export function onMessage(type, fn) {
  if (!handlers.has(type)) handlers.set(type, []);
  handlers.get(type).push(fn);
}

function handle(m) {
  for (const fn of handlers.get(m.t) || []) fn(m);
}

export function send(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) { state.ws.send(JSON.stringify(msg)); return true; }
  return false;
}

export function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  state.ws = ws;
  ws.onopen = () => { state.connected = true; offlineEl.hidden = true; bus.emit('connected'); };
  ws.onmessage = (e) => { try { handle(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onclose = () => {
    state.connected = false;
    if (state.quitting) return;
    offlineEl.hidden = false;
    setTimeout(connect, 1500);
  };
  ws.onerror = () => ws.close();
}
