import { Application, Container, Graphics, Sprite, type FederatedPointerEvent } from 'pixi.js';
import gsap from 'gsap';
import { FSM } from './core/FSM';
import { World, ARENA_H, ARENA_W } from './engine/World';
import { Bot } from './engine/Bot';
import { Rng } from './engine/rng';
import { PowerUpKind, Realm, Theme, THEME_INFO, THEME_ORDER, otherRealm, type GameEvent, type InputFrame, type Theme as ThemeT } from './engine/types';
import { POWERUP_INFO, comboLabel, COIN_TIERS } from './engine/easter-eggs/PortfolioCameos';
import { DraftState } from './engine/easter-eggs/JackpotCardsDraft';
import { SUIT_INFO } from './engine/Upgrades';
import { bakeTextures } from './view/TextureFactory';
import { makeArenaBaker } from './view/ArenaMotifs';
import { ArenaView } from './view/ArenaView';
import { HudView } from './view/HudView';
import { drawBackdrop } from './view/Backdrop';
import { DraftView } from './view/DraftView';
import { DraftPresenter } from './view/DraftPresenter';
import { ELEMENT_COLORS, SKINS, SUIT_COLORS, hexCss } from './view/Palette';
import { JuiceManager, type Label } from './juice/JuiceManager';
import { audio } from './juice/ProceduralAudio';
import { ProceduralMusic } from './juice/ProceduralMusic';
import { GyroClient } from './net/GyroClient';
import type { GamePacket } from './net/protocol';

// ---------------------------------------------------------------- 1. renderer + one clock
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? Date.now() % 100000);
const app = new Application();
await app.init({
    resizeTo: window,
    background: 0x05020c,
    resolution: Math.min(window.devicePixelRatio, 2),
    autoDensity: true,
    antialias: true,
    preference: 'webgl',
});
document.getElementById('boot')?.remove();
document.body.appendChild(app.canvas);
gsap.ticker.remove(gsap.updateRoot);
app.ticker.add((t) => gsap.updateRoot(t.lastTime / 1000));

const tex = bakeTextures(app.renderer);
const world = new World(seed);
const arena = new ArenaView(tex, world, makeArenaBaker(app.renderer));
const juice = new JuiceManager(tex.glow);
arena.world.addChild(juice.particleLayer, juice.labelLayer);
const hud = new HudView(tex);
const draftView = new DraftView(tex);
const draft = new DraftPresenter(draftView, new Rng(seed ^ 0x5eed), audio, (s) => world.tiers[s]);
const music = new ProceduralMusic(audio);
const flyLayer = new Container();
const vignette = new Sprite(tex.vignette);
const backdrop = new Graphics();
app.stage.addChild(arena, backdrop, vignette, flyLayer, hud, draftView, hud.overlay);
const touchFirst = matchMedia('(pointer: coarse)').matches;
hud.setTouch(touchFirst);
draft.touch = touchFirst;

let arenaScale = 1;
/** On-screen rect of the arena (after the portrait rotation). */
const arenaRect = { x: 0, y: 0, w: 0, h: 0 };
/** Touch-first device (phones/tablets); desktop windows never get the rotate lock. */
const touchDevice = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(hover: hover)').matches);
let rotateLock = false;
function layout() {
    const { width: w, height: h } = app.screen;
    hud.layout(w, h);
    // Portrait phones: rotate the arena 90° so its long axis runs top-to-bottom and fills the
    // screen. Input is rotated to match (toArena), so "up" on screen is always up.
    const portrait = w / h < 0.85;
    arena.rotation = portrait ? Math.PI / 2 : 0;
    juice.setOrientation(arena.rotation);
    const availH = h - hud.topH - hud.bottomH - (portrait ? 8 : 16);
    const onW0 = portrait ? ARENA_H : ARENA_W;
    const onH0 = portrait ? ARENA_W : ARENA_H;
    arenaScale = Math.min((w - (portrait ? 16 : 24)) / onW0, availH / onH0);
    const onW = onW0 * arenaScale;
    const onH = onH0 * arenaScale;
    Object.assign(arenaRect, { x: (w - onW) / 2, y: hud.topH + (portrait ? 4 : 8) + (availH - onH) / 2, w: onW, h: onH });
    arena.scale.set(arenaScale);
    // With rotation +90°, arena-local (0,0) lands at the rect's top-RIGHT corner.
    arena.position.set(portrait ? arenaRect.x + onW : arenaRect.x, arenaRect.y);
    vignette.width = w;
    vignette.height = h;
    draftView.layout(w, h);
    drawBackdrop(backdrop, w, h, arenaRect, hud.topH, hud.bottomH);
    rotateLock = touchDevice && window.innerWidth > window.innerHeight && window.innerHeight < 520;
    document.body.classList.toggle('rotate-lock', rotateLock);
}
app.renderer.on('resize', layout);
layout();

// ---------------------------------------------------------------- 2. phone bridge
const gyro = new GyroClient();
gyro.connect();
gyro.onAction = () => {
    if (demo !== 'off') stopDemo();
    else primaryAction();
};
fetch('/gyro-info')
    .then((r) => (r.ok ? r.json() : null))
    .then((info: { urls?: string[] } | null) => hud.setPhoneUrl(info?.urls?.[0] ?? `${location.origin}/controller.html`))
    .catch(() => hud.setPhoneUrl(''));

// ---------------------------------------------------------------- 3. flow FSM
type State = 'TITLE' | 'PLAYING' | 'DRAFT' | 'GAME_OVER' | 'ERROR';
type Event = 'START' | 'DRAFT' | 'RESUME' | 'DIE' | 'RESTART' | 'RECOVER' | 'TIMEOUT' | 'TITLE';
let draftReason = '';
let titleIdle = 0;
/** Title screen idles into the self-playing demo after this many seconds. */
const ATTRACT_AFTER = 15;

const flow = new FSM<State, Event>(
    {
        TITLE: {
            on: { START: 'PLAYING' },
            enter() {
                titleIdle = 0;
                world.restart(false);
                world.paused = true;
                hud.showTitle(true);
                hud.hideCenter();
            },
            exit() {
                hud.showTitle(false);
                world.paused = false;
                world.startWave(); // the title already introduced the preset: just the WAVE popup
            },
        },
        PLAYING: { on: { DRAFT: 'DRAFT', DIE: 'GAME_OVER', TITLE: 'TITLE' } },
        DRAFT: {
            on: { RESUME: 'PLAYING', TIMEOUT: 'PLAYING', TITLE: 'TITLE' },
            timeoutMs: 45_000, // nobody gets stuck in a menu during a pitch
            timeoutEvent: 'TIMEOUT',
            enter(ctx) {
                world.paused = true;
                draft.open((suit) => {
                    if (suit) {
                        const tiers = { ...world.tiers, [suit]: world.tiers[suit] + 1 };
                        world.applyTiers(tiers);
                        juice.label(world.player.x, world.player.y - 40, `${SUIT_INFO[suit].glyph} ${SUIT_INFO[suit].name} UP`, SUIT_COLORS[suit], 1.3, 1.4);
                    }
                    ctx.send('RESUME');
                });
            },
            exit() {
                draft.abort(); // no-op when the draft finished normally
                world.paused = false;
                if (world.pendingSpawns < 0) world.startWave();
                draftView.visible = false;
            },
        },
        GAME_OVER: {
            on: { RESTART: 'PLAYING', TITLE: 'TITLE' },
            enter() {
                let best = 0;
                try {
                    best = Number(localStorage.getItem('apc.best') ?? 0) || 0;
                    if (world.score > best) localStorage.setItem('apc.best', String(world.score));
                } catch {
                    /* private mode: no best score, the card still shows */
                }
                hud.showResults({
                    score: world.score,
                    wave: world.wave,
                    bestChain: world.bestChain,
                    bestCombo: world.bestCombo,
                    coins: world.totalCoins,
                    tiers: { ...world.tiers },
                    theme: world.theme,
                    best: Math.max(best, world.score),
                    newBest: world.score > best && world.score > 0,
                });
                audio.fanfare();
            },
            exit() {
                hud.hideResults();
                world.restart();
            },
        },
        ERROR: {
            on: { RECOVER: 'PLAYING' },
            enter(ctx) {
                setTimeout(() => ctx.send('RECOVER'), 500);
            },
        },
    },
    'TITLE',
    'ERROR',
);

function openDraft(reason: string) {
    draftReason = reason;
    if (flow.send('DRAFT')) audio.powerup();
}

// ---------------------------------------------------------------- 4. attract mode + guided tour
type DemoMode = 'off' | 'attract' | 'tour';
let demo: DemoMode = 'off';
let demoT = 0;
let demoStep = 0;
let demoCaption = '';
let demoDraftT = 0;
let demoTheme: ThemeT = Theme.PARALLEL_SYNC;
const bot = new Bot();
const ATTRACT_LENGTH = 90;

/** The 60-second scripted tour: every feature, captioned, while the bot plays. */
const TOUR: { at: number; caption?: string; run?: () => void }[] = [
    { at: 0, caption: 'Two realms, one clock. SPACE shifts realm — on the beat (the ring round the alchemist closes) it is PERFECT.', run: () => setTheme(Theme.PARALLEL_SYNC) },
    { at: 4, run: () => world.spawnChainDemo() },
    { at: 7, caption: 'Foes only dodge runes of THEIR realm. Lure them onto the OTHER realm’s runes: they transmute and chain across both realms.', run: () => world.spawnChainDemo() },
    { at: 14, caption: 'Preset 2 · CHAIN OVERLOAD — same engine, new skin, new tempo, new rules. Instability raises the multiplier; shift to vent.', run: () => setTheme(Theme.CHAIN_OVERLOAD) },
    { at: 17, run: () => world.spawnChainDemo() },
    { at: 21, caption: 'Preset 3 · ALCHEMY CRAFT — gather IGNIS, AQUA and AETHER across both realms to transmute the whole arena.', run: () => setTheme(Theme.ALCHEMY_CRAFT) },
    { at: 23, run: () => world.spawnChainDemo() },
    { at: 26, run: () => world.transmute() },
    { at: 28, caption: 'Preset 4 · TIME ECHO — every shift leaves a 5-second replay of you that fights alongside you.', run: () => setTheme(Theme.TIME_ECHO) },
    { at: 31, run: () => world.spawnChainDemo() },
    { at: 35, caption: 'Preset 5 · SHADOW LENS — aim with the mouse or a phone’s tilt; the lens reveals and burns what hides in the dark.', run: () => setTheme(Theme.SHADOW_LENS) },
    { at: 38, run: () => world.spawnChainDemo() },
    {
        at: 42,
        caption: 'Golden Coins Link: 20 coins hit GRAND and open Jackpot Cards. Match 3 of a suit for a permanent perk.',
        run: () => {
            setTheme(Theme.PARALLEL_SYNC);
            for (let i = 0; i < 20; i++) world.spawnCoin(world.player.x, world.player.y);
        },
    },
    {
        at: 52,
        caption: 'Portfolio cameos: the Shining Crown, a Red Seven cash bomb and a coin-hunting frog familiar.',
        run: () => {
            world.activatePowerUp(PowerUpKind.SHINING_CROWN);
            world.activatePowerUp(PowerUpKind.FROG_FAMILIAR);
            world.spawnChainDemo();
            world.activatePowerUp(PowerUpKind.RED_SEVEN_BOMB);
        },
    },
    { at: 60, run: () => stopDemo() },
];

function startDemo(mode: Exclude<DemoMode, 'off'>) {
    if (demo !== 'off') stopDemo();
    if (flow.state !== 'TITLE') flow.send('TITLE');
    demoTheme = world.theme;
    demo = mode;
    demoT = 0;
    demoStep = 0;
    demoCaption = mode === 'attract' ? 'The alchemist plays itself: luring foes onto the other realm’s runes and shifting on the beat.' : '';
    flow.send('START');
    world.god = true;
}

function stopDemo() {
    if (demo === 'off') return;
    demo = 'off';
    world.god = false;
    hud.setDemo('off', '');
    flow.send('TITLE');
    if (world.theme !== demoTheme) setTheme(demoTheme);
    titleIdle = 0;
}

function updateDemo(dt: number) {
    if (demo === 'off') return;
    demoT += dt;
    if (demo === 'tour') {
        while (demoStep < TOUR.length && demoT >= TOUR[demoStep].at) {
            const step = TOUR[demoStep++];
            if (step.caption) demoCaption = step.caption;
            step.run?.();
            if ((demo as DemoMode) === 'off') return; // the step ended the tour
        }
    } else if (demoT > ATTRACT_LENGTH) {
        stopDemo();
        return;
    }
    // The bot plays the draft like a person: two picks, then slam-stop, then skip.
    if (flow.state === 'DRAFT') {
        demoDraftT += dt;
        if (demoDraftT > 0.7) {
            demoDraftT = 0;
            const m = draft.model;
            if (draft.state === DraftState.PICKING && m && m.flips < 2) {
                const down = m.revealed.flatMap((r, i) => (r ? [] : [i]));
                draft.tapCard(down[Math.floor(Math.random() * down.length)]);
            } else draft.primary();
        }
    } else if (flow.state === 'GAME_OVER') flow.send('RESTART');
    hud.setDemo(demo, demoCaption);
}

// ---------------------------------------------------------------- 5. input funnel
const keys = new Set<string>();
let shiftQueued = false;
let pointerAim: { x: number; y: number } | null = null;
let lensSource: 'mouse' | 'gyro' | 'keys' | 'touch' | 'bot' = 'mouse';
let calm = params.get('calm') === '1' || (params.get('calm') !== '0' && matchMedia('(prefers-reduced-motion: reduce)').matches);

function primaryAction() {
    audio.unlock();
    titleIdle = 0;
    switch (flow.state) {
        case 'TITLE':
            flow.send('START');
            break;
        case 'PLAYING':
            shiftQueued = true; // consumed by exactly one world.step
            break;
        case 'DRAFT':
            draft.primary();
            break;
        case 'GAME_OVER':
            flow.send('RESTART');
            break;
    }
}

function setTheme(theme: ThemeT) {
    if (world.theme === theme) return;
    world.setTheme(theme);
    arena.setSkin(theme);
    hud.showThemeBanner(theme);
    audio.ui();
    audio.musicSweep();
    arena.shockwave(world.player.x, world.player.y, 260, SKINS[theme][world.player.realm].accent, 0.6, 8);
}
hud.onTheme = (t) => {
    audio.unlock();
    if (demo !== 'off') return stopDemo();
    setTheme(t);
};

function setCalm(on: boolean) {
    calm = on;
    juice.calm = on;
    arena.flashScale = on ? 0.3 : 1;
    hud.setStatus(audio.muted, calm);
}
setCalm(calm);

function toTitle() {
    if (flow.state === 'TITLE') return;
    flow.send('TITLE');
}

window.addEventListener('keydown', (e) => {
    audio.unlock();
    keys.add(e.code);
    if (e.repeat) return; // held keys never auto-fire actions
    titleIdle = 0;
    if (demo !== 'off') {
        // Any key hands control back to a human.
        if (e.code === 'Space') e.preventDefault();
        stopDemo();
        return;
    }
    if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        primaryAction();
    } else if (e.code >= 'Digit1' && e.code <= 'Digit5') {
        setTheme(THEME_ORDER[Number(e.code.slice(5)) - 1]);
    } else if (e.code === 'KeyJ') {
        if (flow.state === 'PLAYING') openDraft('DEBUG');
    } else if (e.code === 'KeyM') {
        audio.setMuted(!audio.muted);
        hud.setStatus(audio.muted, calm);
    } else if (e.code === 'KeyC') {
        setCalm(!calm);
    } else if (e.code === 'KeyT') {
        startDemo('tour');
    } else if (e.code === 'Escape') {
        toTitle();
    } else if (e.code === 'KeyR' && flow.state === 'GAME_OVER') {
        flow.send('RESTART');
    }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

// iOS / mobile browsers: no selection handles, copy callout, context menu, pinch or bounce.
for (const ev of ['contextmenu', 'selectstart', 'dragstart', 'gesturestart'] as const) window.addEventListener(ev, (e) => e.preventDefault());
for (const ev of ['touchstart', 'touchmove'] as const) app.canvas.addEventListener(ev, (e) => e.preventDefault(), { passive: false });

/*
 * Touch, tracked strictly by pointerId:
 *   thumb 1 (first finger on the arena)  -> floating joystick anchored where it landed
 *   any other finger while thumb 1 is down -> SPACE (shift / slam-stop / skip) on pointerdown,
 *                                             never touching thumb 1's movement
 *   a quick tap with thumb 1 alone          -> SPACE
 * The mouse keeps aiming the lens.
 */
const JOY_R = 56;
let movePointerId: number | null = null;
const joyOrigin = { x: 0, y: 0 };
const joyNow = { x: 0, y: 0 };
let joyStart = 0;
let joyTravel = 0;
const joystick = new Graphics();
joystick.eventMode = 'none';
app.stage.addChild(joystick);
app.stage.eventMode = 'static';
app.stage.hitArea = app.screen;
app.stage.on('pointermove', (e: FederatedPointerEvent) => {
    if (e.pointerType === 'touch') {
        if (e.pointerId !== movePointerId) return;
        joyTravel += Math.abs(e.global.x - joyNow.x) + Math.abs(e.global.y - joyNow.y);
        joyNow.x = e.global.x;
        joyNow.y = e.global.y;
        // Floating stick: dragging past the rim drags the origin along.
        const dx = joyNow.x - joyOrigin.x;
        const dy = joyNow.y - joyOrigin.y;
        const d = Math.hypot(dx, dy);
        if (d > JOY_R) {
            joyOrigin.x = joyNow.x - (dx / d) * JOY_R;
            joyOrigin.y = joyNow.y - (dy / d) * JOY_R;
        }
        return;
    }
    pointerAim = arena.world.toLocal(e.global);
});
app.stage.on('pointerdown', (e: FederatedPointerEvent) => {
    audio.unlock();
    titleIdle = 0;
    if (demo !== 'off') return stopDemo();
    if (e.pointerType !== 'touch' || e.target !== app.stage) return; // buttons and cards handle themselves
    if (movePointerId === null) {
        movePointerId = e.pointerId;
        joyOrigin.x = joyNow.x = e.global.x;
        joyOrigin.y = joyNow.y = e.global.y;
        joyStart = performance.now();
        joyTravel = 0;
    } else if (e.pointerId !== movePointerId) primaryAction(); // second thumb
});
// Releases are watched on window (native pointerId == federated pointerId), so a finger lifted
// anywhere, or cancelled by the OS, is always seen.
const release = (e: PointerEvent) => {
    if (e.pointerId !== movePointerId) return; // finger 2 lifting never stops finger 1
    if (performance.now() - joyStart < 220 && joyTravel < 14) primaryAction();
    movePointerId = null;
};
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);

function drawJoystick() {
    const g = joystick;
    g.clear();
    if (movePointerId === null || performance.now() - joyStart < 90) return;
    const accent = arena.pal.accent;
    g.circle(joyOrigin.x, joyOrigin.y, JOY_R).fill({ color: 0xffffff, alpha: 0.06 }).stroke({ width: 2, color: accent, alpha: 0.45 });
    g.circle(joyOrigin.x, joyOrigin.y, 6).fill({ color: accent, alpha: 0.4 });
    g.circle(joyNow.x, joyNow.y, 22).fill({ color: accent, alpha: 0.35 }).stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
}

/** Screen-space direction -> arena-space direction (the arena is rotated 90° on portrait phones). */
function toArena(x: number, y: number): { x: number; y: number } {
    const r = arena.rotation;
    if (r === 0) return { x, y };
    const c = Math.cos(-r);
    const s = Math.sin(-r);
    return { x: x * c - y * s, y: x * s + y * c };
}

const input: InputFrame = { moveX: 0, moveY: 0, aim: 0, shift: false };
function readInput(): InputFrame {
    if (demo !== 'off') {
        const b = bot.think(world);
        lensSource = 'bot';
        shiftQueued = false;
        return b;
    }
    const k = (c: string) => (keys.has(c) ? 1 : 0);
    // Everything below is in SCREEN space (up = up on screen), then rotated into the arena.
    let mx = k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft') + gyro.jx;
    let my = k('KeyS') + k('ArrowDown') - k('KeyW') - k('ArrowUp') + gyro.jy;
    let joy = false;
    if (movePointerId !== null) {
        const dx = (joyNow.x - joyOrigin.x) / JOY_R;
        const dy = (joyNow.y - joyOrigin.y) / JOY_R;
        const d = Math.hypot(dx, dy);
        if (d > 0.15) {
            const m = Math.min(1, d);
            mx += (dx / d) * m;
            my += (dy / d) * m;
            joy = true;
        }
    }
    const mv = toArena(mx, my);
    input.moveX = mv.x;
    input.moveY = mv.y;
    const p = world.player;
    if (gyro.steering) {
        input.aim = gyro.angle - arena.rotation;
        lensSource = 'gyro';
    } else if (joy) {
        input.aim = Math.atan2(mv.y, mv.x);
        lensSource = 'touch';
    } else if (pointerAim) {
        input.aim = Math.atan2(pointerAim.y - p.y, pointerAim.x - p.x);
        lensSource = 'mouse';
    } else if (Math.hypot(p.vx, p.vy) > 20) {
        input.aim = p.facing;
        lensSource = 'keys';
    }
    input.shift = shiftQueued;
    shiftQueued = false;
    return input;
}

// ---------------------------------------------------------------- 6. event -> juice
function flyCoin(x: number, y: number) {
    const start = arena.world.toGlobal({ x, y });
    const end = hud.coinTarget;
    const s = flyPool.find((f) => !f.visible);
    if (!s) return;
    s.visible = true;
    s.position.copyFrom(start);
    s.scale.set(arenaScale * 0.9);
    const ctrl = { x: (start.x + end.x) / 2 + (Math.random() - 0.5) * 300, y: Math.min(start.y, end.y) - 120 };
    const o = { t: 0 };
    gsap.to(o, {
        t: 1,
        duration: 0.55 + Math.random() * 0.15,
        ease: 'power2.in',
        onUpdate: () => {
            const t = o.t;
            const u = 1 - t;
            s.x = u * u * start.x + 2 * u * t * ctrl.x + t * t * end.x;
            s.y = u * u * start.y + 2 * u * t * ctrl.y + t * t * end.y;
            s.rotation = t * 6;
        },
        onComplete: () => void (s.visible = false),
    });
}
const flyPool: Sprite[] = [];
for (let i = 0; i < 24; i++) {
    const s = new Sprite(tex.coin);
    s.anchor.set(0.5);
    s.visible = false;
    flyPool.push(s);
    flyLayer.addChild(s);
}

function haptic(ms: number | number[]) {
    if (demo === 'off') gyro.send({ t: 'haptic', ms });
}

let shiftsThisRun = 0;
const chainLabels = new Map<number, Label>();
function handle(e: GameEvent, now: number) {
    const pal = arena.palOf(world.player.realm);
    switch (e.type) {
        case 'SHIFT': {
            shiftsThisRun++;
            const col = arena.palOf(e.realm).accent;
            arena.shockwave(e.x, e.y, e.radius, col, 0.5, e.perfect ? 10 : 6);
            arena.shockwave(e.x, e.y, e.radius * 0.6, 0xffffff, 0.35, 3);
            arena.flash(e.x, e.y, 180, col, 0.3);
            juice.ring(e.x, e.y, e.radius * 0.5, e.perfect ? 32 : 18, col);
            juice.addTrauma(e.perfect ? 0.35 : 0.2);
            if (e.perfect) juice.label(e.x, e.y - 36, e.combo > 1 ? `PERFECT ×${e.combo}` : 'PERFECT', col, 1.1);
            audio.shift(e.perfect, e.realm === Realm.SHADOW_ALCHEMY);
            audio.musicSweep();
            if (e.perfect) haptic(15);
            break;
        }
        case 'SHIFT_DENIED':
            audio.denied();
            break;
        case 'MISTIMED':
            juice.label(e.x, e.y - 40, 'MISTIMED!', 0xff4d6d, 1, 0.9);
            audio.mistimed();
            haptic(40);
            break;
        case 'ENEMY_TELEGRAPH':
            break; // drawn by the arena (shudder + warning arrow)
        case 'EXPLOSION': {
            const col = e.transmute ? 0xffffff : e.depth % 2 ? 0xff8a2e : 0xb98cff;
            // Overlapping additive flashes saturate to white fast: later links in a chain flash softer.
            const intensity = 0.55 / Math.sqrt(Math.max(1, e.chain / 2));
            arena.flash(e.x, e.y, e.radius * 1.2, e.transmute ? 0xffd34d : col, 0.4, intensity);
            arena.shockwave(e.x, e.y, e.radius, e.transmute ? 0xffd34d : col, 0.45, 7);
            juice.burst(e.x, e.y, 10, e.transmute ? 0xffd34d : col, 340, 0.7, 0.5);
            juice.burst(e.x, e.y, 4, 0xffffff, 220, 0.4, 0.3);
            juice.addTrauma(0.12 + Math.min(0.3, e.chain * 0.04));
            if (e.chain >= 2) {
                juice.hitStop(now);
                const text = `CHAIN ×${e.chain}`;
                const color = e.chain >= 8 ? 0xffd34d : e.chain >= 4 ? 0xff9a3d : 0xffffff;
                const size = 1 + Math.min(0.9, e.chain * 0.07);
                const live = chainLabels.get(e.chainId);
                if (!live || !juice.relabel(live, text, color, size)) {
                    const l = juice.label(e.x, e.y - 30, text, color, size);
                    if (l) chainLabels.set(e.chainId, l);
                }
                if (chainLabels.size > 24) for (const [id, l] of chainLabels) if (!juice.labels.active.has(l)) chainLabels.delete(id);
            } else if (e.transmute) juice.label(e.x, e.y - 20, 'TRANSMUTED!', 0xffd34d, 1);
            audio.explosion(e.radius / 150, e.chain);
            break;
        }
        case 'CHAIN_END':
            if (world.coins.some((c) => c.active)) juice.label(world.player.x, world.player.y + 34, 'COINS INBOUND', 0xffd34d, 0.8, 0.8);
            break;
        case 'ENEMY_HIT':
            juice.burst(e.x, e.y, 4, e.crit ? 0xffd34d : 0xffffff, 160, 0.3, 0.3);
            if (e.crit) juice.label(e.x, e.y - 14, `CRIT ${e.dmg}`, 0xffd34d, 0.8, 0.6);
            audio.hit();
            break;
        case 'ENEMY_KILLED':
            if (e.depth === 0) juice.label(e.x + 18, e.y + 22, `+${e.score}`, arena.palOf(e.realm).accent, 0.75, 0.7);
            break;
        case 'COIN':
            flyCoin(e.x, e.y);
            juice.burst(e.x, e.y, 3, 0xffd34d, 120, 0.3, 0.3);
            audio.coin(e.streak);
            break;
        case 'COIN_TIER': {
            const tier = COIN_TIERS[e.tier];
            hud.popCenter(tier.name, 'GOLDEN COINS LINK', tier.color);
            audio.powerup();
            haptic([30, 30, 30]);
            break;
        }
        case 'PLAYER_HURT':
            juice.addTrauma(0.5);
            juice.burst(world.player.x, world.player.y, 16, 0xff4d6d, 260, 0.5, 0.5);
            arena.flash(world.player.x, world.player.y, 120, 0xff3048, 0.25);
            audio.hurt();
            haptic([70, 40, 70]);
            break;
        case 'WAVE_START':
            hud.popCenter(`WAVE ${e.wave}`, THEME_INFO[world.theme].tagline, pal.accent);
            break;
        case 'WAVE_CLEAR':
            juice.label(world.player.x, world.player.y - 50, 'WAVE CLEAR', 0x7dff8a, 1.4, 1.2);
            break;
        case 'JACKPOT_TRIGGER':
            if (demo === 'tour' && e.reason === 'WAVE_CLEAR') {
                setTimeout(() => world.pendingSpawns < 0 && world.startWave(), 900); // the tour keeps moving
                break;
            }
            setTimeout(() => {
                if (flow.state === 'PLAYING') openDraft(e.reason);
            }, e.reason === 'WAVE_CLEAR' ? 900 : 300);
            break;
        case 'CATALYST':
            juice.label(world.player.x, world.player.y - 40, `${e.element} ${e.count}/3`, ELEMENT_COLORS[e.element], 1.1);
            juice.burst(world.player.x, world.player.y, 20, ELEMENT_COLORS[e.element], 220, 0.6, 0.5);
            audio.powerup();
            break;
        case 'TRANSMUTE':
            hud.popCenter('TRANSMUTATION', 'IGNIS + AQUA + AETHER', 0xe9d8ff);
            arena.shockwave(e.x, e.y, 900, 0xffffff, 1.0, 14);
            juice.addTrauma(0.7);
            audio.fanfare();
            break;
        case 'POWERUP': {
            const info = POWERUP_INFO[e.kind];
            if (e.kind !== PowerUpKind.RED_SEVEN_BOMB) hud.popCenter(info.title, info.subtitle, info.color);
            juice.ring(e.x, e.y, 120, 28, info.color);
            audio.powerup();
            break;
        }
        case 'CASH_BOMB':
            hud.odometer(e.chain, comboLabel, 'CASH BOMB', 0xff3048);
            juice.addTrauma(0.6);
            break;
        case 'ECHO_SPAWN':
            juice.label(world.player.x, world.player.y - 30, 'ECHO', arena.palOf(e.realm).accent, 0.8, 0.6);
            break;
        case 'VENT':
            juice.label(e.x, e.y - 40, `VENT +${e.bonus}`, 0xffd34d, 1.2, 1);
            juice.burst(e.x, e.y, 30, 0xff8a2e, 420, 0.8, 0.6);
            break;
        case 'OVERLOAD':
            hud.popCenter('OVERLOAD!', 'critical mass reached', 0xff3048);
            juice.addTrauma(0.9);
            break;
        case 'SWITCH_SYNC':
            juice.label(e.x, e.y - 30, 'SYNC!', 0x7dff8a, 1.3);
            audio.powerup();
            break;
        case 'LENS_FLARE':
            arena.flash(e.x + Math.cos(e.angle) * 200, e.y + Math.sin(e.angle) * 200, 320, 0xb98cff, 0.3);
            audio.shift(false, true);
            juice.addTrauma(0.15);
            break;
        case 'FROG_HOP':
            juice.burst(e.x, e.y + 6, 3, 0x9dffb0, 80, 0.3, 0.25);
            break;
        case 'GAME_OVER':
            flow.send('DIE');
            break;
    }
}

// ---------------------------------------------------------------- 7. first-wave coach
/** Teaches the core trick in the first ~20 s. Once per page load; never in demo mode. */
let tutorialDone = params.get('tutorial') === '0';
let tutorialTipT = 0;
function updateCoach(dt: number) {
    let tip: string | null = null;
    if (!tutorialDone && demo === 'off' && flow.state === 'PLAYING' && world.theme !== Theme.SHADOW_LENS) {
        if (world.wave > 2) tutorialDone = true;
        else if (shiftsThisRun === 0) tip = `${touchFirst ? 'TAP' : 'SPACE'} shifts realm. Do it as the ring round you closes = PERFECT`;
        else if (world.lureKills === 0) {
            const hot = Math.max(0, ...arena.runeDanger);
            tip = hot > 0.35
                ? 'That rune is flashing: lead the foe right across it!'
                : 'Foes only dodge runes of their OWN realm. Lead them over the OTHER realm’s runes (☉ ↔ ☾) and they explode';
        } else if (world.bestCombo < 2 && (tutorialTipT += dt) < 10) tip = 'Transmuted! Now shift on the beat twice in a row for a PERFECT combo';
        else tutorialDone = true;
    }
    arena.teach = tip !== null;
    hud.setCoach(tip);
}

// ---------------------------------------------------------------- 8. phone mirror
let lastPhone = '';
let lastPhoneAt = 0;
function updatePhone(now: number) {
    if (now - lastPhoneAt < 120) return;
    const realm = world.player.realm;
    const skin = SKINS[world.theme];
    const lens = world.theme === Theme.SHADOW_LENS;
    let mode: Extract<GamePacket, { t: 'game' }>['mode'];
    let label: string;
    let sub: string;
    if (demo !== 'off') [mode, label, sub] = ['demo', 'PLAY', 'take over from the demo'];
    else if (flow.state === 'TITLE') [mode, label, sub] = ['title', 'START', 'tap to play'];
    else if (flow.state === 'DRAFT') [mode, label, sub] = ['draft', draft.state === DraftState.PICKING ? 'SLAM STOP' : 'SKIP', 'jackpot cards'];
    else if (flow.state === 'GAME_OVER') [mode, label, sub] = ['over', 'REWIND', 'play again'];
    else [mode, label, sub] = ['play', lens ? 'LENS FLARE' : 'SHIFT REALM', lens ? 'burn what the lens sees' : 'on the beat'];
    const packet: GamePacket = {
        t: 'game',
        mode,
        label,
        sub,
        theme: world.theme,
        realm,
        accent: hexCss(skin[realm].accent),
        accent2: hexCss(skin[otherRealm(realm)].accent),
        bg: hexCss(skin[realm].bg),
        bpm: world.clock.bpm,
    };
    const json = JSON.stringify(packet);
    if (json === lastPhone && now - lastPhoneAt < 3000) return;
    lastPhone = json;
    lastPhoneAt = now;
    gyro.send(packet);
}

// ---------------------------------------------------------------- 9. main loop (fixed step sim, free render)
let acc = 0;
let fps = 60;
let frames = 0;
const t0 = performance.now();
app.ticker.add((ticker) => {
    const now = performance.now();
    const dt = Math.min(0.1, ticker.deltaMS / 1000);
    if (rotateLock) return; // short mobile landscape: everything waits behind the rotate overlay
    fps += (1000 / Math.max(1, ticker.deltaMS) - fps) * 0.05;
    frames++;
    const frozen = juice.isFrozen(now);
    if (!frozen) {
        acc += dt;
        let steps = 0;
        while (acc >= 1 / 60 && steps < 4) {
            world.step(readInput());
            acc -= 1 / 60;
            steps++;
            for (const e of world.drainEvents()) handle(e, now);
        }
        if (steps === 4) acc = 0;
    }
    // One clock: it keeps ticking through menus, hit-stop and game over, so the music never stops.
    if (frozen || world.paused || world.gameOver) world.clock.advance(dt);

    if (flow.state === 'TITLE' && demo === 'off') {
        titleIdle += dt;
        if (titleIdle > ATTRACT_AFTER) startDemo('attract');
    }
    updateDemo(dt);
    updateCoach(dt);
    updatePhone(now);

    const intensity = Math.min(1, world.activeEnemies / 14 + world.instability / 120 + (world.combo >= 3 ? 0.2 : 0));
    music.update({
        beats: world.clock.beats,
        bpm: world.clock.bpm,
        theme: world.theme,
        realm: world.player.realm,
        intensity,
        combo: world.combo,
        muffled: flow.state !== 'PLAYING',
    });

    juice.update(dt);
    // Combat popups never sit on top of the preset announcement.
    const banner = hud.bannerRect;
    if (banner) {
        const a = juice.labelLayer.toLocal({ x: banner.x, y: banner.y });
        const b = juice.labelLayer.toLocal({ x: banner.x + banner.w, y: banner.y + banner.h });
        juice.avoid({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y });
    }
    backdrop.tint = arena.pal.accent;
    draftView.tick(dt);
    arena.update(world, dt);
    arena.world.position.set(juice.shakeX, juice.shakeY);
    arena.world.pivot.set(0, 0);
    arena.world.rotation = juice.shakeRot;
    hud.update(world, arena.pal, dt, gyro.status, gyro.angle);
    drawJoystick();
    hud.updateTitle(world.clock.beats, world.clock.bpm, demo === 'off' ? ATTRACT_AFTER - titleIdle : 0);
    hud.fpsText.text = `${Math.round(fps)} FPS · seed ${seed}`;
    hud.fpsText.visible = !hud.compact || params.has('fps'); // phones: no debug text on the arena
});

if (params.has('play')) flow.send('START'); // dev shortcut: skip the title screen

// ---------------------------------------------------------------- 10. debug hook for Playwright / live demos
declare global {
    interface Window {
        __GAME_DEBUG__: ReturnType<typeof makeDebug>;
    }
}
function makeDebug() {
    return {
        snapshot: () => ({
            flow: flow.state,
            draft: draft.state,
            draftFlips: draft.model?.flips ?? 0,
            draftMatched: draft.model?.matched ?? null,
            draftRevealed: draft.model ? draft.model.revealed.flatMap((r, i) => (r ? [i] : [])) : [],
            draftHot: draftView.hot,
            draftReason,
            lastAward: draft.lastAward,
            theme: world.theme,
            bpm: world.clock.bpm,
            beats: world.clock.beats,
            /** ms until the next beat (e2e times its shifts with it: off-beat shifts lock you out). */
            toBeatMs: (1 - world.clock.phase) * world.clock.period * 1000,
            musicNotes: music.scheduled,
            audioReady: audio.ready,
            realm: world.player.realm,
            realmBlend: arena.realmT,
            demo,
            demoCaption,
            rotateLock,
            simTime: world.time,
            touch: { movePointerId, joyX: joyNow.x - joyOrigin.x, joyY: joyNow.y - joyOrigin.y },
            calm,
            muted: audio.muted,
            status: hud.statusLine,
            coach: hud.coachLine,
            title: hud.titleVisible,
            results: hud.resultsVisible,
            runeDanger: Math.max(0, ...arena.runeDanger),
            fps: Math.round(fps),
            frames,
            uptimeMs: Math.round(performance.now() - t0),
            score: world.score,
            wave: world.wave,
            hp: world.player.hp,
            combo: world.combo,
            bestCombo: world.bestCombo,
            bestChain: world.bestChain,
            lureKills: world.lureKills,
            linkCoins: world.linkCoins,
            totalCoins: world.totalCoins,
            tiers: { ...world.tiers },
            player: { x: world.player.x, y: world.player.y },
            lensAngle: world.lensAngle,
            lensSource,
            gyro: { status: gyro.status, packets: gyro.packets, angle: gyro.angle, steering: gyro.steering },
            entities: {
                enemies: world.activeEnemies,
                coins: world.coins.filter((c) => c.active).length,
                /** Coins older than 2.5 s: after a chain's vacuum these should all be gone. */
                oldCoins: world.coins.filter((c) => c.active && c.age > 2.5).length,
                echoes: world.echoes.filter((e) => e.active).length,
                frog: world.frog.active,
            },
            pools: {
                particles: { inUse: juice.particles.inUse, capacity: juice.particles.capacity },
                labels: { inUse: juice.labels.inUse, capacity: juice.labels.capacity },
            },
            renderer: app.renderer.name,
        }),
        setTheme: (i: number) => setTheme(THEME_ORDER[i - 1]),
        triggerDraft: () => openDraft('DEBUG'),
        spawnChain: () => world.spawnChainDemo(),
        spawnPowerUp: (kind: keyof typeof PowerUpKind) => world.activatePowerUp(PowerUpKind[kind]),
        giveCoins: (n: number) => {
            for (let i = 0; i < n; i++) world.spawnCoin(world.player.x, world.player.y);
        },
        dropCoins: (n: number, x: number, y: number) => {
            for (let i = 0; i < n; i++) world.spawnCoin(x, y);
        },
        teleport: (x: number, y: number) => {
            world.player.x = x;
            world.player.y = y;
        },
        godMode: (on: boolean) => {
            world.god = on;
        },
        /** Real damage through the engine (e2e: phone haptics, results card). */
        hurt: (n = 1) => {
            const god = world.god;
            world.god = false;
            for (let i = 0; i < n; i++) {
                world.player.invuln = 0;
                world.player.shield = 0;
                world.player.crown = 0;
                world.hurtPlayer(1);
            }
            world.god = god;
        },
        startDemo: (mode: 'attract' | 'tour') => startDemo(mode),
        /** Player position on screen (e2e: "drag up moves up" on the rotated portrait arena). */
        playerScreen: () => {
            const g = arena.world.toGlobal({ x: world.player.x, y: world.player.y });
            return { x: g.x, y: g.y };
        },
        stopDemo: () => stopDemo(),
        toTitle: () => toTitle(),
        /** Visible overlays (screen rects) + live combat labels, for the e2e overlap check. */
        overlayReport: () => {
            const rects: Record<string, { x: number; y: number; w: number; h: number }> = hud.overlayReport();
            juice.liveLabels().forEach((t, i) => {
                if (t.alpha < 0.05) return;
                const b = t.getBounds();
                rects[`label-${i}:${t.text}`] = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
            });
            return rects;
        },
        layoutReport: () => {
            return { screen: { w: app.screen.width, h: app.screen.height }, arena: { ...arenaRect }, rotated: arena.rotation !== 0, hud: hud.layoutReport(), draft: draftView.layoutReport() };
        },
        hazards: () => world.hazards.map((h) => ({ x: h.x, y: h.y, realm: h.realm, revealed: h.revealed })),
        switches: () => world.switches.map((s) => ({ x: s.x, y: s.y, held: s.held })),
        flipCard: (i: number) => draft.tapCard(i),
        /** Reads back the rendered stage: proves the GPU produced a real, non-blank frame. */
        samplePixels: () => {
            const { pixels, width, height } = app.renderer.extract.pixels({ target: app.stage, resolution: 0.25 });
            const colors = new Set<number>();
            let lit = 0;
            let sr = 0;
            let sg = 0;
            let sb = 0;
            for (let i = 0; i < pixels.length; i += 4) {
                const r = pixels[i];
                const g = pixels[i + 1];
                const b = pixels[i + 2];
                sr += r;
                sg += g;
                sb += b;
                colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
                if (r + g + b > 90) lit++;
            }
            const n = pixels.length / 4;
            return { width, height, uniqueColors: colors.size, litFraction: lit / n, avg: [sr / n, sg / n, sb / n].map(Math.round) };
        },
        /** Which display object would receive a pointer event at (x, y). */
        hitTest: (x: number, y: number) => {
            const path: string[] = [];
            const rb = app.renderer.events.rootBoundary;
            rb.rootTarget ??= app.stage;
            for (let o = rb.hitTest(x, y) as Container | null; o; o = o.parent)
                path.push(`${o.constructor.name}${o.label ? `#${o.label}` : ''}`);
            return path;
        },
        /** Screen-space centres of the theme buttons and draft cards (for real mouse clicks). */
        hitTargets: () => {
            const find = (name: string) => {
                const c = app.stage.getChildByLabel(name, true);
                if (!c) return null;
                const b = c.getBounds();
                return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
            };
            return {
                themes: [1, 2, 3, 4, 5].map((i) => find(`theme-btn-${i}`)),
                cards: Array.from({ length: 12 }, (_, i) => find(`card-${i}`)),
            };
        },
        world,
    };
}
window.__GAME_DEBUG__ = makeDebug();
