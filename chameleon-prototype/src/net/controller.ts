import { SEND_HZ, wsUrl, type ControllerPacket, type GamePacket } from './protocol';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $('status');
const statusText = $('statusText');
const knob = $('knob');
const pad = $('pad');
const bubble = $('bubble');
const readout = $('readout');
const enableBtn = $<HTMLButtonElement>('enable');
const shiftBtn = $<HTMLButtonElement>('shift');
const sentEl = $('sent');
const shiftLabel = $('shiftLabel');
const shiftSub = $('shiftSub');
const realmEl = $('realm');

const state = { a: 0, b: 0, g: 0, jx: 0, jy: 0, tilt: false };
let ws: WebSocket | null = null;
let seq = 0;
let sent = 0;
let games = 0;
let retry = 500;

function setStatus() {
    const open = ws?.readyState === WebSocket.OPEN;
    statusEl.className = `pill ${open ? (games > 0 ? 'linked' : 'waiting') : ''}`;
    statusText.textContent = open ? (games > 0 ? `LINKED TO ${games} GAME${games > 1 ? 'S' : ''}` : 'WAITING FOR GAME') : 'OFFLINE';
}

function connect() {
    ws = new WebSocket(wsUrl('controller'));
    ws.onopen = () => {
        retry = 500;
        setStatus();
    };
    ws.onmessage = (e) => {
        try {
            const m = JSON.parse(String(e.data));
            if (m.t === 'presence') games = m.games;
            else if (m.t === 'game') applyGame(m as Extract<GamePacket, { t: 'game' }>);
            else if (m.t === 'haptic') navigator.vibrate?.((m as Extract<GamePacket, { t: 'haptic' }>).ms);
        } catch {
            /* ignore */
        }
        setStatus();
    };
    ws.onclose = () => {
        setStatus();
        setTimeout(connect, retry);
        retry = Math.min(8000, retry * 2);
    };
    ws.onerror = () => ws?.close();
}

/** The phone mirrors the game: realm colours, what the big button does right now, the tempo. */
function applyGame(m: Extract<GamePacket, { t: 'game' }>) {
    const root = document.documentElement.style;
    root.setProperty('--accent', m.accent);
    root.setProperty('--accent2', m.accent2);
    root.setProperty('--realm-bg', m.bg);
    root.setProperty('--beat', `${(60 / Math.max(30, m.bpm)).toFixed(3)}s`);
    // Pale accents (the noir SHADOW LENS skin) need dark button text to stay readable.
    const n = parseInt(m.accent.slice(1), 16);
    const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    root.setProperty('--btn-ink', lum > 0.7 ? '#07040f' : '#ffffff');
    root.setProperty('--btn-shadow', lum > 0.7 ? '0 1px 0 #fff8' : '0 2px 6px #000a');
    document.body.dataset.mode = m.mode;
    document.body.dataset.realm = m.realm;
    shiftLabel.textContent = m.label;
    shiftSub.textContent = m.sub;
    realmEl.textContent = `${m.realm === 'SHADOW_ALCHEMY' ? '☾ SHADOW' : '☉ SOLAR'} · ${m.theme.replace('_', ' ')} · ${m.bpm} BPM`;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', m.bg);
}

function send(p: ControllerPacket) {
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(p));
    sent++;
    if (sent % 10 === 0 || p.t === 'action') sentEl.textContent = `${sent} PACKETS`;
}

// ---- tilt ----
function onOrientation(e: DeviceOrientationEvent) {
    if (e.beta === null || e.gamma === null) return;
    state.a = e.alpha ?? 0;
    state.b = e.beta;
    state.g = e.gamma;
    state.tilt = true;
    const bx = Math.max(-1, Math.min(1, state.g / 45));
    const by = Math.max(-1, Math.min(1, state.b / 45));
    bubble.style.transform = `translate(${bx * 70}px, ${by * 70}px)`;
    readout.textContent = `β ${state.b.toFixed(0)}° · γ ${state.g.toFixed(0)}°`;
}
window.addEventListener('deviceorientation', onOrientation);
enableBtn.addEventListener('click', async () => {
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    try {
        if (typeof DOE.requestPermission === 'function') await DOE.requestPermission();
        enableBtn.textContent = 'TILT ON';
    } catch {
        enableBtn.textContent = 'TILT BLOCKED';
    }
});

// ---- joystick ----
let padId: number | null = null;
function padMove(e: PointerEvent) {
    const r = pad.getBoundingClientRect();
    let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const len = Math.hypot(x, y);
    if (len > 1) {
        x /= len;
        y /= len;
    }
    state.jx = x;
    state.jy = y;
    knob.style.transform = `translate(${x * (r.width * 0.32)}px, ${y * (r.height * 0.32)}px)`;
}
pad.addEventListener('pointerdown', (e) => {
    padId = e.pointerId;
    pad.setPointerCapture(e.pointerId);
    padMove(e);
});
pad.addEventListener('pointermove', (e) => e.pointerId === padId && padMove(e));
const padEnd = (e: PointerEvent) => {
    if (e.pointerId !== padId) return;
    padId = null;
    state.jx = state.jy = 0;
    knob.style.transform = '';
};
pad.addEventListener('pointerup', padEnd);
pad.addEventListener('pointercancel', padEnd);

// ---- big button ----
shiftBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    shiftBtn.classList.add('pressed');
    send({ t: 'action', seq: ++seq });
    navigator.vibrate?.(25);
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) shiftBtn.addEventListener(ev, () => shiftBtn.classList.remove('pressed'));

setInterval(() => send({ t: 'state', ...state }), 1000 / SEND_HZ);
connect();
setStatus();
