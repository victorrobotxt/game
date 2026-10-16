#!/usr/bin/env bash
# Amusnet Hackathon – 5-minute bootstrap: Vite + TypeScript + PixiJS v8 + GSAP + Howler
# Usage: bash hackathon-setup.sh [project-name]
set -euo pipefail
NAME="${1:-amusnet-game}"

npm create vite@latest "$NAME" -- --template vanilla-ts --no-interactive
cd "$NAME"
npm install
npm install pixi.js gsap howler
npm install -D @types/howler

# Strip the Vite demo
rm -rf src/counter.ts src/style.css src/assets public/vite.svg
mkdir -p src/core src/logic src/view src/audio public/assets public/audio test

cat > index.html <<'__AMUSNET_EOF__'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
    <title>Amusnet Hackathon</title>
  </head>
  <body>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
__AMUSNET_EOF__

cat > src/core/FSM.ts <<'__AMUSNET_EOF__'
/**
 * Table-driven finite state machine that cannot be soft-locked by input spam.
 *
 * Guarantees:
 *  1. Events not listed in the current state's `on` table are IGNORED (never queued).
 *  2. Async work started in a state can only move the machine while that state is still
 *     current: ctx.send() is bound to an epoch, stale completions are dropped.
 *  3. Leaving a state aborts ctx.signal, so its in-flight work can bail out early.
 *  4. Every state may declare a watchdog (timeoutMs + timeoutEvent).
 *  5. A throw/reject in enter() routes to `errorState` instead of freezing.
 *  6. send() from exit() or a listener is dropped (no half-finished transitions).
 */
export interface StateContext<E extends string> {
    readonly signal: AbortSignal;
    send(event: E): void;
}

export interface StateDef<S extends string, E extends string> {
    on: Partial<Record<E, S>>;
    enter?(ctx: StateContext<E>): void | Promise<void>;
    exit?(): void;
    timeoutMs?: number;
    timeoutEvent?: E;
}

export type Listener<S extends string, E extends string> = (to: S, from: S, event: E | 'FORCE') => void;

export class FSM<S extends string, E extends string> {
    private readonly states: Record<S, StateDef<S, E>>;
    private readonly errorState: S;
    private readonly listeners = new Set<Listener<S, E>>();
    private current: S;
    private epoch = 0;
    private abort = new AbortController();
    private watchdog?: ReturnType<typeof setTimeout>;
    private transitioning = false;

    constructor(states: Record<S, StateDef<S, E>>, initial: S, errorState: S) {
        this.states = states;
        this.errorState = errorState;
        this.current = initial;
        this.enter(initial);
    }

    get state(): S {
        return this.current;
    }

    /** Use this to enable/disable UI (buttons, cursor) - never duplicate the table in views. */
    can(event: E): boolean {
        return !this.transitioning && this.states[this.current].on[event] !== undefined;
    }

    /** Returns true if the event caused a transition. Safe to call any number of times. */
    send(event: E): boolean {
        if (this.transitioning) return false;
        const to = this.states[this.current].on[event];
        if (to === undefined) return false;
        this.transition(to, event);
        return true;
    }

    /** Escape hatch for errors / server resync. Bypasses the table. */
    force(to: S): void {
        if (this.transitioning) return;
        this.transition(to, 'FORCE');
    }

    onChange(listener: Listener<S, E>): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private transition(to: S, event: E | 'FORCE') {
        const from = this.current;
        this.transitioning = true;
        try {
            clearTimeout(this.watchdog);
            this.abort.abort();
            this.states[from].exit?.();
        } catch (err) {
            console.error(`[FSM] exit(${from}) threw`, err);
        }
        this.current = to;
        try {
            this.listeners.forEach((l) => l(to, from, event));
        } catch (err) {
            console.error('[FSM] listener threw', err);
        }
        this.transitioning = false;
        this.enter(to);
    }

    private enter(state: S) {
        const epoch = ++this.epoch;
        this.abort = new AbortController();
        const def = this.states[state];
        const ctx: StateContext<E> = {
            signal: this.abort.signal,
            send: (e) => {
                if (epoch === this.epoch) this.send(e);
            },
        };
        if (def.timeoutMs !== undefined && def.timeoutEvent !== undefined) {
            const ev = def.timeoutEvent;
            this.watchdog = setTimeout(() => {
                console.warn(`[FSM] watchdog fired in ${state}`);
                ctx.send(ev);
            }, def.timeoutMs);
        }
        try {
            const result = def.enter?.(ctx);
            if (result instanceof Promise) result.catch((err) => this.fail(epoch, state, err));
        } catch (err) {
            this.fail(epoch, state, err);
        }
    }

    private fail(epoch: number, state: S, err: unknown) {
        if (epoch !== this.epoch) return; // state already left; nothing to recover
        console.error(`[FSM] enter(${state}) failed`, err);
        if (state !== this.errorState) this.force(this.errorState);
    }
}
__AMUSNET_EOF__

cat > src/core/CommandQueue.ts <<'__AMUSNET_EOF__'
import gsap from 'gsap';

/**
 * Handed to every presentation command. Commands MUST await animations through
 * ctx.play()/ctx.wait() so that skip() can fast-forward them.
 *
 * Rule: skipping means "jump to the final visual state", never "don't run".
 * A skipped command still executes; its tweens just complete instantly.
 */
export class CommandContext {
    private readonly abort = new AbortController();
    private readonly anims = new Set<gsap.core.Animation>();
    readonly speed: number;

    constructor(speed: number) {
        this.speed = speed;
    }

    get skipped(): boolean {
        return this.abort.signal.aborted;
    }

    /** Hook non-GSAP cleanup (Howler sounds, particles) to skip. */
    get signal(): AbortSignal {
        return this.abort.signal;
    }

    /** Await a tween/timeline. On skip it is jumped to its end - never kill()ed, which would hang the promise. */
    play(anim: gsap.core.Animation): Promise<void> {
        anim.timeScale(anim.timeScale() * this.speed);
        if (this.skipped) {
            anim.totalProgress(1);
            return Promise.resolve();
        }
        this.anims.add(anim);
        return new Promise<void>((resolve) => {
            const done = () => {
                this.anims.delete(anim);
                this.abort.signal.removeEventListener('abort', done);
                resolve();
            };
            this.abort.signal.addEventListener('abort', done);
            anim.then(done); // .then() keeps the tween's own onComplete intact
        });
    }

    /** Skippable delay that respects gsap.globalTimeline pause (e.g. pause popup). */
    wait(seconds: number): Promise<void> {
        return this.play(gsap.delayedCall(seconds, () => {}));
    }

    skip(): void {
        if (this.skipped) return;
        const running = [...this.anims];
        this.abort.abort();
        for (const anim of running) anim.totalProgress(1);
    }
}

export type Command = (ctx: CommandContext) => void | Promise<void>;

export interface CommandOptions {
    /** Non-skippable commands ignore skip()/fastForward() (e.g. a mandatory big-win minimum). */
    skippable?: boolean;
    /** Watchdog: a command that hangs longer than this is force-skipped and the queue moves on. */
    timeoutMs?: number;
}

interface Entry {
    name: string;
    run: Command;
    skippable: boolean;
    timeoutMs: number;
}

export class CommandQueue {
    private readonly entries: Entry[] = [];
    private current: Entry | null = null;
    private ctx: CommandContext | null = null;
    private draining: Promise<void> | null = null;
    private fastForwarding = false;
    private generation = 0;
    /** Turbo mode: multiplies the timeScale of everything played via ctx.play(). */
    speed = 1;

    add(name: string, run: Command, opts: CommandOptions = {}): this {
        this.entries.push({ name, run, skippable: opts.skippable ?? true, timeoutMs: opts.timeoutMs ?? 10_000 });
        return this;
    }

    /** Drain the queue. Calling it again while draining returns the same promise. */
    run(): Promise<void> {
        return (this.draining ??= this.drain());
    }

    get busy(): boolean {
        return this.draining !== null;
    }

    /** Fast-forward the current command only. */
    skip(): void {
        if (this.current?.skippable) this.ctx?.skip();
    }

    /** Fast-forward the current command and every queued one to their end states. */
    fastForward(): void {
        this.fastForwarding = true;
        this.skip();
    }

    /** Hard reset (screen change, server resync). An in-flight drain() exits without touching new state. */
    clear(): void {
        this.generation++;
        this.entries.length = 0;
        this.ctx?.skip();
        this.ctx = null;
        this.current = null;
        this.draining = null;
        this.fastForwarding = false;
    }

    private async drain(): Promise<void> {
        const generation = this.generation;
        try {
            while (this.entries.length && generation === this.generation) {
                const entry = this.entries.shift()!;
                const ctx = new CommandContext(this.speed);
                this.current = entry;
                this.ctx = ctx;
                if (this.fastForwarding && entry.skippable) ctx.skip();
                await this.execute(entry, ctx);
            }
        } finally {
            if (generation === this.generation) {
                this.current = null;
                this.ctx = null;
                this.draining = null;
                this.fastForwarding = false;
            }
        }
    }

    private async execute(entry: Entry, ctx: CommandContext): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const watchdog = new Promise<void>((resolve) => {
            timer = setTimeout(() => {
                console.warn(`[CommandQueue] "${entry.name}" timed out - forcing`);
                ctx.skip();
                resolve();
            }, entry.timeoutMs);
        });
        try {
            await Promise.race([Promise.resolve().then(() => entry.run(ctx)), watchdog]);
        } catch (err) {
            console.error(`[CommandQueue] "${entry.name}" threw`, err);
            ctx.skip();
        } finally {
            clearTimeout(timer);
        }
    }
}
__AMUSNET_EOF__

cat > src/logic/SlotModel.ts <<'__AMUSNET_EOF__'
/**
 * Pure game logic: no PixiJS, no GSAP, no DOM. Unit-testable and server-swappable.
 * The view only ever receives the *result* and animates towards it.
 */
export const SYMBOLS = ['🍒', '🍋', '🔔', '⭐', '7️⃣'] as const;
export const REELS = 3;
export const ROWS = 3;

export interface SpinResult {
    /** grid[reel][row] = symbol index */
    grid: number[][];
    /** Rows that pay */
    winningRows: number[];
    win: number;
}

export class SlotModel {
    balance = 1000;
    bet = 10;

    canSpin(): boolean {
        return this.balance >= this.bet;
    }

    /** Stand-in for the RGS/server call. Balance is committed here, before any animation. */
    async spin(signal: AbortSignal): Promise<SpinResult> {
        if (!this.canSpin()) throw new Error('Insufficient balance');
        this.balance -= this.bet;
        await new Promise((r) => setTimeout(r, 150 + Math.random() * 250)); // fake latency
        signal.throwIfAborted();

        const grid = Array.from({ length: REELS }, () =>
            Array.from({ length: ROWS }, () => Math.floor(Math.random() * SYMBOLS.length)),
        );
        const winningRows: number[] = [];
        for (let row = 0; row < ROWS; row++) {
            if (grid.every((reel) => reel[row] === grid[0][row])) winningRows.push(row);
        }
        const win = winningRows.length * this.bet * 5;
        this.balance += win;
        return { grid, winningRows, win };
    }
}
__AMUSNET_EOF__

cat > src/view/ReelsView.ts <<'__AMUSNET_EOF__'
import { Container, Graphics, Text, type Ticker } from 'pixi.js';
import gsap from 'gsap';
import { REELS, ROWS, SYMBOLS } from '../logic/SlotModel';

const CELL = 120;

/**
 * Presentation only. Knows how to *show* a state, never decides it.
 * Every animated method returns a gsap Animation so commands can ctx.play() it (and skip it).
 */
export class ReelsView extends Container {
    private readonly cells: Text[][] = [];
    private readonly highlights: Graphics[] = [];
    private readonly spinning: boolean[] = Array(REELS).fill(false);
    private flickerAcc = 0;

    constructor() {
        super();
        const frame = new Graphics().roundRect(-10, -10, REELS * CELL + 20, ROWS * CELL + 20, 16).fill(0x1b1035);
        this.addChild(frame);

        for (let row = 0; row < ROWS; row++) {
            const hl = new Graphics().roundRect(0, row * CELL + 4, REELS * CELL, CELL - 8, 12).fill(0xffd34d);
            hl.alpha = 0;
            this.highlights.push(hl);
            this.addChild(hl);
        }

        for (let reel = 0; reel < REELS; reel++) {
            const column: Text[] = [];
            for (let row = 0; row < ROWS; row++) {
                const t = new Text({ text: SYMBOLS[0], style: { fontSize: 72 } });
                t.anchor.set(0.5);
                t.position.set(reel * CELL + CELL / 2, row * CELL + CELL / 2);
                column.push(t);
                this.addChild(t);
            }
            this.cells.push(column);
        }
        this.pivot.set((REELS * CELL) / 2, (ROWS * CELL) / 2);
    }

    /** Called from app.ticker - cheap per-frame work only, no allocations. */
    update(ticker: Ticker) {
        this.flickerAcc += ticker.deltaMS;
        if (this.flickerAcc < 60) return;
        this.flickerAcc = 0;
        for (let reel = 0; reel < REELS; reel++) {
            if (!this.spinning[reel]) continue;
            for (const cell of this.cells[reel]) cell.text = SYMBOLS[(Math.random() * SYMBOLS.length) | 0];
        }
    }

    startSpin() {
        this.spinning.fill(true);
        this.highlights.forEach((h) => (h.alpha = 0));
    }

    /** Stops one reel on its final symbols. Final state is applied synchronously; the tween is only juice. */
    stopReel(reel: number, symbols: number[]): gsap.core.Animation {
        this.spinning[reel] = false;
        const column = this.cells[reel];
        column.forEach((cell, row) => (cell.text = SYMBOLS[symbols[row]]));
        return gsap.fromTo(
            column.map((c) => c.scale),
            { x: 1.25, y: 0.75 },
            { x: 1, y: 1, duration: 0.25, ease: 'back.out(3)' },
        );
    }

    showWin(rows: number[]): gsap.core.Animation {
        const targets = rows.map((r) => this.highlights[r]);
        return gsap.fromTo(targets, { alpha: 0 }, { alpha: 0.35, duration: 0.2, repeat: 3, yoyo: true });
    }
}
__AMUSNET_EOF__

cat > src/audio/sfx.ts <<'__AMUSNET_EOF__'
import { Howl, Howler } from 'howler';

/**
 * Thin Howler wrapper. Drop files into public/audio/ and register them here.
 * Prefer one audio sprite (e.g. via `audiosprite`) over many small files.
 */
const sounds: Record<string, Howl> = {};

export function registerSfx(name: string, src: string[]) {
    sounds[name] = new Howl({ src, preload: true });
}

/** Returns a stop() function so skipped commands can cut their audio via ctx.signal. */
export function playSfx(name: string, signal?: AbortSignal): () => void {
    const howl = sounds[name];
    if (!howl) return () => {};
    const id = howl.play();
    const stop = () => howl.stop(id);
    signal?.addEventListener('abort', stop, { once: true });
    return stop;
}

/** Mute on tab blur so the game never plays sound in the background. */
export function bindVisibilityMute() {
    document.addEventListener('visibilitychange', () => Howler.mute(document.hidden));
}
__AMUSNET_EOF__

cat > src/main.ts <<'__AMUSNET_EOF__'
import { Application, BitmapText, Container, Graphics, Text } from 'pixi.js';
import gsap from 'gsap';
import { FSM } from './core/FSM';
import { CommandQueue } from './core/CommandQueue';
import { REELS, SlotModel, type SpinResult } from './logic/SlotModel';
import { ReelsView } from './view/ReelsView';
import { bindVisibilityMute } from './audio/sfx';

// ---------- 1. Renderer + single clock ----------
const app = new Application();
await app.init({
    resizeTo: window,
    background: 0x0d0820,
    resolution: Math.min(window.devicePixelRatio, 2), // cap DPR: 3x phones melt otherwise
    autoDensity: true,
});
document.body.style.margin = '0';
document.body.appendChild(app.canvas);

// Drive GSAP from Pixi's ticker: one rAF, tweens and render always land on the same frame.
gsap.ticker.remove(gsap.updateRoot);
app.ticker.add((t) => gsap.updateRoot(t.lastTime / 1000));
bindVisibilityMute();

// ---------- 2. Logic / presentation / controller ----------
const model = new SlotModel();
const queue = new CommandQueue();
const reels = new ReelsView();
const winText = new BitmapText({ text: '', style: { fontFamily: 'Arial', fontSize: 48, fill: 0xffd34d } });
winText.anchor.set(0.5);
const balanceText = new BitmapText({ text: '', style: { fontFamily: 'Arial', fontSize: 28, fill: 0xffffff } });
balanceText.anchor.set(0.5);

const button = new Container();
const buttonBg = new Graphics().roundRect(-110, -36, 220, 72, 36).fill(0x7b3cff);
const buttonLabel = new Text({ text: 'SPIN', style: { fontSize: 32, fill: 0xffffff, fontWeight: 'bold' } });
buttonLabel.anchor.set(0.5);
button.addChild(buttonBg, buttonLabel);
button.eventMode = 'static';
button.cursor = 'pointer';

app.stage.addChild(reels, winText, balanceText, button);
app.ticker.add((t) => reels.update(t));

function layout() {
    const { width, height } = app.screen;
    const scale = Math.min(width / 480, height / 720, 1.5);
    reels.position.set(width / 2, height * 0.42);
    reels.scale.set(scale);
    winText.position.set(width / 2, height * 0.42 + 230 * scale);
    balanceText.position.set(width / 2, 30);
    button.position.set(width / 2, height - 70);
}
app.renderer.on('resize', layout);
layout();

function showBalance() {
    balanceText.text = `BALANCE ${model.balance}`;
}
showBalance();

// ---------- 3. The game flow FSM ----------
type State = 'IDLE' | 'SPINNING' | 'PRESENTING' | 'ERROR';
type Event = 'SPIN' | 'RESULT' | 'DONE' | 'TIMEOUT' | 'RECOVER';

let result: SpinResult | null = null;
let slam: () => void = () => {};
let slamRequested = false;

const fsm = new FSM<State, Event>(
    {
        IDLE: {
            on: { SPIN: 'SPINNING' },
        },
        SPINNING: {
            on: { RESULT: 'PRESENTING', TIMEOUT: 'ERROR' },
            timeoutMs: 8000,
            timeoutEvent: 'TIMEOUT',
            async enter(ctx) {
                winText.text = '';
                reels.startSpin();
                slamRequested = false;
                const slammed = new Promise<void>((r) => {
                    slam = () => {
                        slamRequested = true;
                        r();
                    };
                });
                result = await model.spin(ctx.signal);
                // Minimum spin time for feel - cut short if the player slams.
                await Promise.race([new Promise((r) => setTimeout(r, 700)), slammed]);
                ctx.send('RESULT');
            },
            exit() {
                slam = () => {};
            },
        },
        PRESENTING: {
            on: { DONE: 'IDLE', TIMEOUT: 'IDLE' },
            timeoutMs: 15000,
            timeoutEvent: 'TIMEOUT',
            async enter(ctx) {
                const r = result!;
                for (let reel = 0; reel < REELS; reel++) {
                    queue.add(`stop-reel-${reel}`, async (c) => {
                        await c.play(reels.stopReel(reel, r.grid[reel]));
                        await c.wait(0.12);
                    });
                }
                if (r.win > 0) {
                    queue.add('show-win-lines', (c) => c.play(reels.showWin(r.winningRows)));
                    queue.add('count-up', async (c) => {
                        const counter = { v: 0 };
                        await c.play(
                            gsap.to(counter, {
                                v: r.win,
                                duration: 1.2,
                                ease: 'power1.out',
                                onUpdate: () => (winText.text = `WIN ${Math.round(counter.v)}`),
                            }),
                        );
                        winText.text = `WIN ${r.win}`; // final state set unconditionally
                    });
                }
                queue.add('commit-balance', () => showBalance());
                if (slamRequested) queue.fastForward(); // STOP pressed while spinning: land everything now
                await queue.run();
                ctx.send('DONE');
            },
            exit() {
                queue.clear();
                showBalance();
            },
        },
        ERROR: {
            on: { RECOVER: 'IDLE' },
            enter(ctx) {
                winText.text = 'CONNECTION LOST';
                setTimeout(() => ctx.send('RECOVER'), 1500);
            },
        },
    },
    'IDLE',
    'ERROR',
);

fsm.onChange((to) => {
    buttonLabel.text = to === 'IDLE' ? 'SPIN' : to === 'SPINNING' ? 'STOP' : to === 'PRESENTING' ? 'SKIP' : '...';
    buttonBg.tint = to === 'IDLE' ? 0xffffff : 0xaaaaaa;
});

// ---------- 4. One input funnel: mouse, touch and keyboard all land here ----------
function primaryAction() {
    switch (fsm.state) {
        case 'IDLE':
            if (model.canSpin()) fsm.send('SPIN');
            break;
        case 'SPINNING':
            slam(); // intent flag, not an FSM event: honoured once the result exists
            break;
        case 'PRESENTING':
            queue.fastForward();
            break;
    }
}
button.on('pointertap', primaryAction);
window.addEventListener('keydown', (e) => {
    if (e.repeat) return; // held key must not auto-fire spins
    if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        primaryAction();
    }
});
__AMUSNET_EOF__

cat > test/stress.ts <<'__AMUSNET_EOF__'
import gsap from 'gsap';
import { FSM } from '../src/core/FSM.ts';
import { CommandQueue } from '../src/core/CommandQueue.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name: string, ok: boolean) => { console.log(ok ? 'PASS' : 'FAIL', name); if (!ok) fails++; };

// 1. Spam: 1000 SPINs in one tick -> exactly one transition
{
  let enters = 0;
  const fsm = new FSM<'IDLE' | 'BUSY', 'GO' | 'DONE'>({
    IDLE: { on: { GO: 'BUSY' } },
    BUSY: { on: { DONE: 'IDLE' }, async enter(ctx) { enters++; await sleep(20); ctx.send('DONE'); } },
  }, 'IDLE', 'IDLE');
  let accepted = 0;
  for (let i = 0; i < 1000; i++) if (fsm.send('GO')) accepted++;
  await sleep(40);
  check('spam -> 1 transition, back to IDLE', accepted === 1 && enters === 1 && fsm.state === 'IDLE');
}

// 2. Stale async: state left early, late completion must not move the machine
{
  const fsm = new FSM<'A' | 'B' | 'C', 'toB' | 'toC' | 'late'>({
    A: { on: { toB: 'B' } },
    B: { on: { toC: 'C', late: 'A' }, async enter(ctx) { await sleep(30); ctx.send('late'); } },
    C: { on: { late: 'A' } },
  }, 'A', 'A');
  fsm.send('toB'); fsm.send('toC');
  await sleep(50);
  check('stale ctx.send ignored (stays in C)', fsm.state === 'C');
}

// 3. Throwing enter -> error state, watchdog -> recovery
{
  const fsm = new FSM<'IDLE' | 'BAD' | 'HANG' | 'ERR', 'bad' | 'hang' | 'timeout' | 'ok'>({
    IDLE: { on: { bad: 'BAD', hang: 'HANG' } },
    BAD: { on: {}, async enter() { throw new Error('boom'); } },
    HANG: { on: { timeout: 'IDLE' }, timeoutMs: 30, timeoutEvent: 'timeout', enter() { return new Promise(() => {}); } },
    ERR: { on: { ok: 'IDLE' } },
  }, 'IDLE', 'ERR');
  const origErr = console.error; console.error = () => {};
  fsm.send('bad'); await sleep(5);
  console.error = origErr;
  check('rejected enter -> ERR', fsm.state === 'ERR');
  fsm.send('ok'); fsm.send('hang');
  const origWarn = console.warn; console.warn = () => {};
  await sleep(50); console.warn = origWarn;
  check('hung state -> watchdog back to IDLE', fsm.state === 'IDLE');
}

// 4. Queue: fastForward lands every command at its END value quickly
{
  const q = new CommandQueue();
  const obj = { a: 0, b: 0, c: 0 };
  q.add('a', (c) => c.play(gsap.to(obj, { a: 100, duration: 5 })));
  q.add('b', async (c) => { await c.wait(5); obj.b = 1; });
  q.add('c', (c) => c.play(gsap.to(obj, { c: 7, duration: 5 })));
  const t0 = Date.now();
  const p = q.run();
  await sleep(30);
  q.fastForward(); q.fastForward(); q.skip(); // spam
  await p;
  check(`fastForward -> final state in ${Date.now() - t0}ms`, obj.a === 100 && obj.b === 1 && obj.c === 7 && Date.now() - t0 < 300);
  check('queue idle after drain', !q.busy);
}

// 5. skip() only skips current; non-skippable ignores skip
{
  const q = new CommandQueue();
  const obj = { x: 0, y: 0 };
  q.add('x', (c) => c.play(gsap.to(obj, { x: 1, duration: 5 })));
  q.add('y', (c) => c.play(gsap.to(obj, { y: 1, duration: 0.15 })), { skippable: false });
  const p = q.run();
  await sleep(20); q.skip();
  await sleep(20);
  check('skip() finished current only', obj.x === 1 && obj.y < 1);
  q.fastForward();
  await sleep(20);
  check('non-skippable command keeps running', obj.y < 1);
  await p;
  check('non-skippable completed naturally', obj.y === 1);
}

// 6. Hanging / throwing command -> watchdog, queue continues
{
  const q = new CommandQueue();
  let after = false;
  const w = console.warn, e = console.error; console.warn = () => {}; console.error = () => {};
  q.add('hang', () => new Promise(() => {}), { timeoutMs: 40 });
  q.add('throw', () => { throw new Error('x'); });
  q.add('after', () => { after = true; });
  await q.run();
  console.warn = w; console.error = e;
  check('hung + throwing commands do not block queue', after);
}

// 7. clear() mid-drain, then reuse: no double loops
{
  const q = new CommandQueue();
  let runs = 0;
  q.add('long', (c) => c.wait(5));
  q.add('never', () => { runs += 100; });
  const p1 = q.run();
  await sleep(10); q.clear();
  q.add('next', () => { runs++; });
  await q.run(); await p1;
  check('clear() drops old queue, new run executes once', runs === 1);
}

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
__AMUSNET_EOF__

npm pkg set scripts.test="node --experimental-strip-types --no-warnings test/stress.ts"
npx tsc --noEmit
npm test
echo "Ready: cd $NAME && npm run dev"
