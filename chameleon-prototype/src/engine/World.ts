/**
 * The Alchemist's Parallel Clock: pure simulation.
 * No pixi.js, no gsap, no DOM. Fixed-step (`step(dt)`), seeded, pooled, unit-testable.
 * The view reads the public arrays every frame and reacts to `events`.
 */
import { Rng } from './rng';
import { BeatClock, GOOD_WINDOW, PERFECT_WINDOW, THEME_BPM } from './BeatClock';
import {
    Element,
    PowerUpKind,
    Realm,
    Theme,
    otherRealm,
    type GameEvent,
    type InputFrame,
} from './types';
import { deriveStats, emptyTiers, type PlayerStats, type UpgradeTiers } from './Upgrades';
import {
    FROG_HOP_TIME,
    FROG_REST,
    GRAND_AT,
    POWERUP_DROP_CHANCE,
    POWERUP_INFO,
    coinTier,
    frogNextTarget,
    type FrogState,
} from './easter-eggs/PortfolioCameos';

export const ARENA_W = 1200;
export const ARENA_H = 580;
export const ECHO_SECONDS = 5;
export const STEP = 1 / 60;
const ECHO_SAMPLES = ECHO_SECONDS * 60;
const PLAYER_R = 16;
export const LENS_HALF_ANGLE = 0.5;
export const LENS_RANGE = 430;

export const MAX_ENEMIES = 48;
export const MAX_COINS = 96;
export const MAX_BLASTS = 64;
export const MAX_ECHOES = 3;
export const MAX_POWERUPS = 4;
/** Uncollected coins fade out after this many seconds, so the arena never fills with gold. */
export const COIN_LIFE = 9;
// ---- difficulty (arcade tension from wave 1)
export const ENEMY_SPEED_MUL = 1.4;
export const SPAWN_RATE_MUL = 1.45;
/** Enemies dropped in at once when a wave starts, converging from the edges. */
export const OPENING_BURST = 5;
/** Same-realm enrage lunge: range, telegraph, speed multiplier, duration, cooldown. */
export const LUNGE_RANGE = 160;
export const LUNGE_WINDUP = 0.25;
export const LUNGE_MUL = 1.6;
export const LUNGE_TIME = 0.55;
export const LUNGE_CD = 1.5;
/** A shift outside the GOOD window locks shifting for this long. */
export const MISTIME_LOCK = 1.25;
/** Shield regen waits this long after a hit. */
export const SHIELD_DELAY = 4;
/** A cascade of at least this many blasts auto-collects every coin on the floor. */
export const VACUUM_CHAIN = 3;

export type WallRealm = Realm | 'BOTH';

export interface Wall {
    x: number;
    y: number;
    w: number;
    h: number;
    realm: WallRealm;
}

export interface Hazard {
    x: number;
    y: number;
    r: number;
    realm: Realm;
    /** SHADOW_LENS: shadow hazards are invisible unless inside the lens cone. */
    revealed: boolean;
}

export interface Enemy {
    active: boolean;
    id: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    realm: Realm;
    hp: number;
    maxHp: number;
    r: number;
    speed: number;
    brute: boolean;
    flash: number;
    revealed: boolean;
    spawnT: number;
    contactCd: number;
    /** Lunge telegraph seconds left (> 0 = winding up; the view shakes and reddens it). */
    windup: number;
    /** Lunge seconds left, along (lungeX, lungeY). */
    lunge: number;
    lungeCd: number;
    lungeX: number;
    lungeY: number;
}

export interface Coin {
    active: boolean;
    x: number;
    y: number;
    vx: number;
    vy: number;
    age: number;
    /** Swept up by a finished chain: flies to the player until collected. */
    homing: boolean;
}

interface Blast {
    active: boolean;
    x: number;
    y: number;
    radius: number;
    delay: number;
    depth: number;
    chainId: number;
    transmute: boolean;
}

export interface Echo {
    active: boolean;
    realm: Realm;
    /** xy pairs, chronological. */
    path: Float32Array;
    len: number;
    t: number;
    x: number;
    y: number;
}

export interface Switch {
    x: number;
    y: number;
    held: boolean;
}

export interface Catalyst {
    element: Element;
    realm: Realm;
    x: number;
    y: number;
    collected: boolean;
}

export interface PowerUp {
    active: boolean;
    kind: PowerUpKind;
    x: number;
    y: number;
    age: number;
}

export interface Player {
    x: number;
    y: number;
    vx: number;
    vy: number;
    facing: number;
    realm: Realm;
    hp: number;
    shield: number;
    invuln: number;
    shiftCd: number;
    crown: number;
    alive: boolean;
}

export class World {
    readonly rng: Rng;
    theme: Theme = Theme.PARALLEL_SYNC;
    tiers: UpgradeTiers = emptyTiers();
    stats: PlayerStats = deriveStats(this.tiers);

    time = 0;
    readonly clock = new BeatClock(THEME_BPM.PARALLEL_SYNC);
    score = 0;
    wave = 0;
    combo = 0;
    bestCombo = 0;
    /** Longest cascade this run (for the results card). */
    bestChain = 0;
    /** Enemies lured onto the other realm's runes (drives the first-wave tutorial). */
    lureKills = 0;
    coinStreak = 0;
    coinStreakT = 0;
    totalCoins = 0;
    /** Coins inside the current Golden Coins Link (0..GRAND_AT). */
    linkCoins = 0;
    instability = 0;
    catalystCount = 0;
    lensAngle = 0;
    lensFlareCd = 0;
    switchCd = 0;
    paused = false;
    gameOver = false;
    /** Debug: ignore all player damage (pitch demos / e2e staging). */
    god = false;

    readonly player: Player;
    readonly walls: Wall[] = [];
    readonly hazards: Hazard[] = [];
    readonly enemies: Enemy[] = [];
    readonly coins: Coin[] = [];
    readonly blasts: Blast[] = [];
    readonly echoes: Echo[] = [];
    readonly switches: Switch[] = [];
    readonly catalysts: Catalyst[] = [];
    readonly powerups: PowerUp[] = [];
    readonly frog: FrogState = { active: false, x: 0, y: 0, hop: 1, fromX: 0, fromY: 0, toX: 0, toY: 0, rest: 0, life: 0 };

    /** Drained by the view each frame. */
    events: GameEvent[] = [];

    private spawnQueue = 0;
    private spawnTimer = 0;
    /** Seconds since the player was last hurt (shield regen waits SHIELD_DELAY). */
    sinceHurt = 99;
    private nextEnemyId = 1;
    private nextChainId = 1;
    private readonly chainCounts = new Map<number, number>();
    private readonly cashBombChains = new Set<number>();
    private readonly trail = new Float32Array(ECHO_SAMPLES * 2);
    private trailHead = 0;
    private trailLen = 0;

    constructor(seed = 1) {
        this.rng = new Rng(seed);
        this.player = {
            x: ARENA_W / 2,
            y: ARENA_H / 2,
            vx: 0,
            vy: 0,
            facing: 0,
            realm: Realm.SOLAR_ORDER,
            hp: this.stats.maxHp,
            shield: this.stats.shieldMax,
            invuln: 0,
            shiftCd: 0,
            crown: 0,
            alive: true,
        };
        for (let i = 0; i < MAX_ENEMIES; i++)
            this.enemies.push({
                active: false, id: 0, x: 0, y: 0, vx: 0, vy: 0, realm: Realm.SOLAR_ORDER, hp: 0, maxHp: 0,
                r: 19, speed: 0, brute: false, flash: 0, revealed: false, spawnT: 0, contactCd: 0,
                windup: 0, lunge: 0, lungeCd: 0, lungeX: 0, lungeY: 0,
            });
        for (let i = 0; i < MAX_COINS; i++) this.coins.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, age: 0, homing: false });
        for (let i = 0; i < MAX_BLASTS; i++)
            this.blasts.push({ active: false, x: 0, y: 0, radius: 0, delay: 0, depth: 0, chainId: 0, transmute: false });
        for (let i = 0; i < MAX_ECHOES; i++)
            this.echoes.push({ active: false, realm: Realm.SOLAR_ORDER, path: new Float32Array(ECHO_SAMPLES * 2), len: 0, t: 0, x: 0, y: 0 });
        for (let i = 0; i < MAX_POWERUPS; i++) this.powerups.push({ active: false, kind: PowerUpKind.SHINING_CROWN, x: 0, y: 0, age: 0 });
        this.buildArena();
        this.setTheme(Theme.PARALLEL_SYNC);
    }

    // ------------------------------------------------------------------ setup

    private buildArena() {
        const W = ARENA_W;
        const H = ARENA_H;
        // Mirrored layout so both realms feel fair. Solar walls are horizontal bars, shadow walls vertical.
        this.walls.push(
            { x: W * 0.22, y: H * 0.2, w: 150, h: 22, realm: Realm.SOLAR_ORDER },
            { x: W * 0.78 - 150, y: H * 0.8 - 22, w: 150, h: 22, realm: Realm.SOLAR_ORDER },
            { x: W * 0.5 - 80, y: H * 0.12, w: 160, h: 20, realm: Realm.SOLAR_ORDER },
            { x: W * 0.34, y: H * 0.56, w: 22, h: 150, realm: Realm.SHADOW_ALCHEMY },
            { x: W * 0.66 - 22, y: H * 0.3 - 30, w: 22, h: 150, realm: Realm.SHADOW_ALCHEMY },
            { x: W * 0.5 - 80, y: H * 0.88 - 20, w: 160, h: 20, realm: Realm.SHADOW_ALCHEMY },
            { x: W * 0.08, y: H * 0.5 - 30, w: 44, h: 60, realm: 'BOTH' },
            { x: W * 0.92 - 44, y: H * 0.5 - 30, w: 44, h: 60, realm: 'BOTH' },
        );
        const spots: [number, number, Realm][] = [
            [0.18, 0.72, Realm.SOLAR_ORDER],
            [0.82, 0.28, Realm.SOLAR_ORDER],
            [0.5, 0.36, Realm.SOLAR_ORDER],
            [0.18, 0.32, Realm.SHADOW_ALCHEMY],
            [0.82, 0.68, Realm.SHADOW_ALCHEMY],
            [0.5, 0.66, Realm.SHADOW_ALCHEMY],
        ];
        for (const [fx, fy, realm] of spots)
            this.hazards.push({ x: W * fx, y: H * fy, r: 40 + this.rng.range(0, 10), realm, revealed: true });
        this.switches.push({ x: W * 0.3, y: H * 0.42, held: false }, { x: W * 0.7, y: H * 0.58, held: false });
        this.catalysts.push(
            { element: Element.IGNIS, realm: Realm.SOLAR_ORDER, x: W * 0.12, y: H * 0.14, collected: false },
            { element: Element.AQUA, realm: Realm.SHADOW_ALCHEMY, x: W * 0.88, y: H * 0.86, collected: false },
            { element: Element.AETHER, realm: Realm.SHADOW_ALCHEMY, x: W * 0.62, y: H * 0.14, collected: false },
        );
    }

    setTheme(theme: Theme) {
        this.theme = theme;
        this.clock.bpm = THEME_BPM[theme];
        this.instability = 0;
        for (const e of this.echoes) e.active = false;
        if (theme === Theme.SHADOW_LENS && this.player.realm !== Realm.SOLAR_ORDER) this.player.realm = Realm.SOLAR_ORDER;
        if (theme === Theme.ALCHEMY_CRAFT) this.resetCatalysts();
        for (const h of this.hazards) h.revealed = theme !== Theme.SHADOW_LENS || h.realm === Realm.SOLAR_ORDER;
    }

    applyTiers(tiers: UpgradeTiers) {
        const oldMax = this.stats.maxHp;
        this.tiers = { ...tiers };
        this.stats = deriveStats(this.tiers);
        this.player.hp = Math.min(this.stats.maxHp, this.player.hp + (this.stats.maxHp - oldMax) + 1);
    }

    startWave() {
        this.wave++;
        this.spawnQueue = 5 + this.wave * 2;
        this.spawnTimer = 0.6;
        this.emit({ type: 'WAVE_START', wave: this.wave });
        // Opening burst: several foes converge from all four edges at once.
        const burst = Math.min(OPENING_BURST, this.spawnQueue);
        for (let i = 0; i < burst; i++) this.spawnFromEdge(i % 4);
        this.spawnQueue -= burst;
    }

    get activeEnemies(): number {
        let n = 0;
        for (const e of this.enemies) if (e.active) n++;
        return n;
    }

    get pendingSpawns(): number {
        return this.spawnQueue;
    }

    /** Score multiplier shown on the HUD. */
    get multiplier(): number {
        let m = this.stats.scoreMul;
        if (this.player.crown > 0) m *= 2;
        if (this.theme === Theme.CHAIN_OVERLOAD) m *= 1 + Math.floor(this.instability / 20) * 0.5;
        return m;
    }

    /** 0..1 position inside the current beat (one clock for both realms). */
    get beatPhase(): number {
        return this.clock.phase;
    }

    // ------------------------------------------------------------------ step

    step(input: InputFrame, dt = STEP) {
        if (this.paused || this.gameOver) return;
        this.time += dt;
        this.clock.advance(dt);
        const p = this.player;
        this.lensAngle = input.aim;

        if (input.shift) this.tryShift();
        this.movePlayer(input, dt);
        this.recordTrail();
        this.updateTimers(dt);
        this.updateSpawns(dt);
        this.updateEnemies(dt);
        this.updateBlasts(dt);
        this.updateCoins(dt);
        this.updateEchoes(dt);
        this.updateSwitches(dt);
        this.updateThemeRules(dt);
        this.updatePowerUps(dt);
        this.updateFrog(dt);

        if (this.wave > 0 && this.spawnQueue === 0 && this.activeEnemies === 0 && !this.anyBlastPending()) {
            this.emit({ type: 'WAVE_CLEAR', wave: this.wave });
            this.emit({ type: 'JACKPOT_TRIGGER', reason: 'WAVE_CLEAR' });
            this.spawnQueue = -1; // wait for startWave()
        }
        if (p.hp <= 0 && p.alive) {
            p.alive = false;
            this.gameOver = true;
            this.emit({ type: 'GAME_OVER', score: this.score });
        }
    }

    private emit(e: GameEvent) {
        this.events.push(e);
    }

    drainEvents(): GameEvent[] {
        const out = this.events;
        this.events = [];
        return out;
    }

    // ------------------------------------------------------------------ player

    /** Distance in seconds to the nearest beat. */
    beatError(): number {
        return this.clock.error();
    }

    tryShift(): boolean {
        const p = this.player;
        if (this.theme === Theme.SHADOW_LENS) return this.lensFlare();
        if (p.shiftCd > 0) {
            this.emit({ type: 'SHIFT_DENIED' });
            return false;
        }
        const from = p.realm;
        p.realm = otherRealm(p.realm);
        p.shiftCd = this.stats.shiftCooldown;
        const err = this.beatError();
        const perfect = err <= PERFECT_WINDOW;
        const mistimed = err > GOOD_WINDOW;
        if (mistimed) p.shiftCd = MISTIME_LOCK; // panic-mashing gets you trapped
        this.combo = perfect ? this.combo + 1 : 0;
        this.bestCombo = Math.max(this.bestCombo, this.combo);
        const radius = 150 + (perfect ? 50 + Math.min(this.combo, 8) * 6 : 0);
        this.emit({ type: 'SHIFT', realm: p.realm, perfect, combo: this.combo, x: p.x, y: p.y, radius });
        if (mistimed) this.emit({ type: 'MISTIMED', x: p.x, y: p.y, lock: MISTIME_LOCK });

        for (const e of this.enemies) {
            if (!e.active) continue;
            const dx = e.x - p.x;
            const dy = e.y - p.y;
            const d = Math.hypot(dx, dy) || 1;
            if (d > radius) continue;
            const push = (1 - d / radius) * 520;
            e.vx += (dx / d) * push;
            e.vy += (dy / d) * push;
            if (perfect && e.realm === p.realm && d < radius * 0.6) this.damageEnemy(e, 1, 0, this.newChain(), false);
        }

        if (this.theme === Theme.TIME_ECHO) this.spawnEcho(from);
        if (this.theme === Theme.CHAIN_OVERLOAD && this.instability > 5) {
            const amount = this.instability;
            const bonus = Math.round(amount * 12 * this.multiplier);
            this.score += bonus;
            this.emit({ type: 'VENT', amount, bonus, x: p.x, y: p.y });
            this.queueBlast(p.x, p.y, 80 + amount * 2.2, 0, 0, this.newChain(), false);
            this.instability = 0;
        }
        this.resolveWalls(p, PLAYER_R, p.realm);
        return true;
    }

    private lensFlare(): boolean {
        if (this.lensFlareCd > 0) {
            this.emit({ type: 'SHIFT_DENIED' });
            return false;
        }
        const p = this.player;
        this.lensFlareCd = this.stats.shiftCooldown * 1.5;
        this.emit({ type: 'LENS_FLARE', x: p.x, y: p.y, angle: this.lensAngle });
        const chain = this.newChain();
        for (const e of this.enemies) if (e.active && this.inLens(e.x, e.y)) this.damageEnemy(e, 2, 0, chain, false);
        return true;
    }

    inLens(x: number, y: number): boolean {
        const p = this.player;
        const dx = x - p.x;
        const dy = y - p.y;
        const d = Math.hypot(dx, dy);
        if (d > LENS_RANGE) return false;
        if (d < 30) return true;
        let a = Math.atan2(dy, dx) - this.lensAngle;
        a = Math.atan2(Math.sin(a), Math.cos(a));
        return Math.abs(a) <= LENS_HALF_ANGLE;
    }

    private movePlayer(input: InputFrame, dt: number) {
        const p = this.player;
        let mx = input.moveX;
        let my = input.moveY;
        const len = Math.hypot(mx, my);
        if (len > 1) {
            mx /= len;
            my /= len;
        }
        const target = this.stats.speed;
        const k = 1 - Math.exp(-dt * 14);
        p.vx += (mx * target - p.vx) * k;
        p.vy += (my * target - p.vy) * k;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (len > 0.1) p.facing = Math.atan2(my, mx);
        p.x = Math.max(PLAYER_R, Math.min(ARENA_W - PLAYER_R, p.x));
        p.y = Math.max(PLAYER_R, Math.min(ARENA_H - PLAYER_R, p.y));
        this.resolveWalls(p, PLAYER_R, p.realm);
    }

    private recordTrail() {
        const p = this.player;
        this.trail[this.trailHead * 2] = p.x;
        this.trail[this.trailHead * 2 + 1] = p.y;
        this.trailHead = (this.trailHead + 1) % ECHO_SAMPLES;
        this.trailLen = Math.min(ECHO_SAMPLES, this.trailLen + 1);
    }

    private spawnEcho(realm: Realm) {
        let slot = this.echoes.find((e) => !e.active);
        if (!slot) {
            // Recycle the oldest (furthest along).
            slot = this.echoes.reduce((a, b) => (a.t / a.len > b.t / b.len ? a : b));
        }
        const n = this.trailLen;
        const start = (this.trailHead - n + ECHO_SAMPLES) % ECHO_SAMPLES;
        for (let i = 0; i < n; i++) {
            const j = (start + i) % ECHO_SAMPLES;
            slot.path[i * 2] = this.trail[j * 2];
            slot.path[i * 2 + 1] = this.trail[j * 2 + 1];
        }
        slot.active = n > 1;
        slot.len = n;
        slot.t = 0;
        slot.realm = realm;
        slot.x = slot.path[0];
        slot.y = slot.path[1];
        if (slot.active) this.emit({ type: 'ECHO_SPAWN', realm });
    }

    hurtPlayer(dmg: number) {
        const p = this.player;
        if (p.invuln > 0 || p.crown > 0 || !p.alive || this.god) return;
        if (p.shield >= 1) {
            p.shield -= 1;
        } else {
            p.hp = Math.max(0, p.hp - dmg);
        }
        p.invuln = 0.9;
        this.sinceHurt = 0;
        this.combo = 0;
        this.emit({ type: 'PLAYER_HURT', hp: p.hp });
    }

    private updateTimers(dt: number) {
        const p = this.player;
        p.shiftCd = Math.max(0, p.shiftCd - dt);
        p.invuln = Math.max(0, p.invuln - dt);
        p.crown = Math.max(0, p.crown - dt);
        this.lensFlareCd = Math.max(0, this.lensFlareCd - dt);
        this.switchCd = Math.max(0, this.switchCd - dt);
        this.sinceHurt += dt;
        if (this.sinceHurt > SHIELD_DELAY) p.shield = Math.min(this.stats.shieldMax, p.shield + this.stats.shieldRegenPerSec * dt);
        this.coinStreakT -= dt;
        if (this.coinStreakT <= 0) this.coinStreak = 0;
    }

    // ------------------------------------------------------------------ enemies

    private updateSpawns(dt: number) {
        if (this.spawnQueue <= 0) return;
        this.spawnTimer -= dt;
        if (this.spawnTimer > 0) return;
        this.spawnTimer = Math.max(0.25, 0.9 - this.wave * 0.05) / SPAWN_RATE_MUL;
        this.spawnQueue--;
        this.spawnFromEdge(this.rng.int(4));
    }

    private spawnFromEdge(edge: number) {
        const x = edge === 0 ? 20 : edge === 1 ? ARENA_W - 20 : this.rng.range(40, ARENA_W - 40);
        const y = edge === 2 ? 20 : edge === 3 ? ARENA_H - 20 : this.rng.range(40, ARENA_H - 40);
        const realm = this.rng.next() < 0.5 ? Realm.SOLAR_ORDER : Realm.SHADOW_ALCHEMY;
        this.spawnEnemy(x, y, realm, this.wave >= 3 && this.rng.next() < 0.2);
    }

    spawnEnemy(x: number, y: number, realm: Realm, brute = false): Enemy | null {
        const e = this.enemies.find((en) => !en.active);
        if (!e) return null;
        e.active = true;
        e.id = this.nextEnemyId++;
        e.x = x;
        e.y = y;
        e.vx = 0;
        e.vy = 0;
        e.realm = realm;
        e.brute = brute;
        e.maxHp = e.hp = brute ? 4 : 1 + Math.floor(this.wave / 4);
        e.r = brute ? 30 : 19; // big enough to read instantly against the floor runes
        e.speed = ((brute ? 55 : 80) + Math.min(this.wave, 10) * 6 + this.rng.range(-8, 8)) * ENEMY_SPEED_MUL;
        e.windup = e.lunge = 0;
        e.lungeCd = 1;
        e.flash = 0;
        e.revealed = true;
        e.spawnT = 0;
        e.contactCd = 0;
        return e;
    }

    private updateEnemies(dt: number) {
        const p = this.player;
        const lens = this.theme === Theme.SHADOW_LENS;
        for (const e of this.enemies) {
            if (!e.active) continue;
            e.spawnT += dt;
            e.flash = Math.max(0, e.flash - dt * 4);
            e.contactCd = Math.max(0, e.contactCd - dt);
            e.revealed = !lens || e.realm === Realm.SOLAR_ORDER || this.inLens(e.x, e.y);

            // Seek the player in either realm; avoid only hazards of the enemy's OWN realm,
            // so they can be lured straight into the other realm's runes.
            const dx = p.x - e.x;
            const dy = p.y - e.y;
            const d = Math.hypot(dx, dy) || 1;
            let ax = (dx / d) * e.speed;
            let ay = (dy / d) * e.speed;
            for (const h of this.hazards) {
                if (h.realm !== e.realm) continue;
                const hx = e.x - h.x;
                const hy = e.y - h.y;
                const hd = Math.hypot(hx, hy) || 1;
                const avoid = h.r + e.r + 26;
                if (hd < avoid) {
                    const f = (1 - hd / avoid) * e.speed * 2.4;
                    ax += (hx / hd) * f;
                    ay += (hy / hd) * f;
                }
            }
            for (const o of this.enemies) {
                if (o === e || !o.active) continue;
                const sx = e.x - o.x;
                const sy = e.y - o.y;
                const sd = sx * sx + sy * sy;
                const min = e.r + o.r + 4;
                if (sd < min * min && sd > 0.01) {
                    const s = Math.sqrt(sd);
                    ax += (sx / s) * 60;
                    ay += (sy / s) * 60;
                }
            }
            // Same-realm enrage: close in, telegraph, then lunge. Shifting realm cancels the windup.
            e.lungeCd = Math.max(0, e.lungeCd - dt);
            const canHurt = lens ? e.realm === Realm.SOLAR_ORDER || e.revealed : e.realm === p.realm;
            let snap = 3;
            if (e.lunge > 0) {
                e.lunge -= dt;
                ax = e.lungeX * e.speed * LUNGE_MUL;
                ay = e.lungeY * e.speed * LUNGE_MUL;
                snap = 14;
            } else if (e.windup > 0) {
                if (!canHurt) e.windup = 0;
                else {
                    e.windup -= dt;
                    ax *= 0.15;
                    ay *= 0.15;
                    snap = 10;
                    if (e.windup <= 0) {
                        e.lunge = LUNGE_TIME;
                        e.lungeX = dx / d;
                        e.lungeY = dy / d;
                    }
                }
            } else if (canHurt && e.lungeCd <= 0 && e.spawnT > 0.5 && d < LUNGE_RANGE) {
                e.windup = LUNGE_WINDUP;
                e.lungeCd = LUNGE_CD + LUNGE_WINDUP + LUNGE_TIME;
                this.emit({ type: 'ENEMY_TELEGRAPH', x: e.x, y: e.y });
            }
            const k = 1 - Math.exp(-dt * snap);
            e.vx += (ax - e.vx) * k;
            e.vy += (ay - e.vy) * k;
            e.x += e.vx * dt;
            e.y += e.vy * dt;
            e.x = Math.max(e.r, Math.min(ARENA_W - e.r, e.x));
            e.y = Math.max(e.r, Math.min(ARENA_H - e.r, e.y));
            this.resolveWalls(e, e.r, e.realm);

            if (lens && e.realm === Realm.SHADOW_ALCHEMY && e.revealed) {
                e.hp -= dt * 0.9; // the lens burns what it reveals
                e.flash = Math.max(e.flash, 0.3);
                if (e.hp <= 0) {
                    this.killEnemy(e, 0, this.newChain(), false);
                    continue;
                }
            }

            // Transmutation: an enemy stepping into the OPPOSITE realm's rune detonates.
            for (const h of this.hazards) {
                if (h.realm === e.realm) continue;
                if ((e.x - h.x) ** 2 + (e.y - h.y) ** 2 < (h.r * 0.8) ** 2) {
                    this.lureKills++;
                    this.killEnemy(e, 0, this.newChain(), true);
                    break;
                }
            }
            if (!e.active) continue;

            // Contact damage only inside a shared realm (ghosts pass through you).
            const sharedRealm = lens ? e.realm === Realm.SOLAR_ORDER || e.revealed : e.realm === p.realm;
            if (sharedRealm && e.contactCd <= 0 && (e.x - p.x) ** 2 + (e.y - p.y) ** 2 < (e.r + PLAYER_R) ** 2) {
                e.contactCd = 0.6;
                this.hurtPlayer(1);
            }
            // Echoes fight alongside you in the realm they were recorded in.
            for (const echo of this.echoes) {
                if (!echo.active || echo.realm !== e.realm) continue;
                if ((e.x - echo.x) ** 2 + (e.y - echo.y) ** 2 < (e.r + PLAYER_R) ** 2 && e.contactCd <= 0) {
                    e.contactCd = 0.35;
                    this.damageEnemy(e, 1, 0, this.newChain(), false);
                    if (!e.active) break;
                }
            }
        }
        for (const h of this.hazards) {
            if (lens && h.realm === Realm.SHADOW_ALCHEMY) h.revealed = this.inLens(h.x, h.y);
            if (!h.revealed && !lens) h.revealed = true;
            if (h.realm === p.realm && !lens && p.invuln <= 0 && (p.x - h.x) ** 2 + (p.y - h.y) ** 2 < (h.r * 0.7) ** 2)
                this.hurtPlayer(1);
        }
    }

    private resolveWalls(ent: { x: number; y: number }, r: number, realm: Realm) {
        for (const w of this.walls) {
            if (w.realm !== 'BOTH' && w.realm !== realm) continue;
            const cx = Math.max(w.x, Math.min(ent.x, w.x + w.w));
            const cy = Math.max(w.y, Math.min(ent.y, w.y + w.h));
            let dx = ent.x - cx;
            let dy = ent.y - cy;
            const d2 = dx * dx + dy * dy;
            if (d2 >= r * r) continue;
            if (d2 < 1e-6) {
                // Centre inside the wall (e.g. right after a realm shift): eject along the shortest axis.
                const left = ent.x - w.x;
                const right = w.x + w.w - ent.x;
                const top = ent.y - w.y;
                const bottom = w.y + w.h - ent.y;
                const m = Math.min(left, right, top, bottom);
                if (m === left) ent.x = w.x - r;
                else if (m === right) ent.x = w.x + w.w + r;
                else if (m === top) ent.y = w.y - r;
                else ent.y = w.y + w.h + r;
                continue;
            }
            const d = Math.sqrt(d2);
            dx /= d;
            dy /= d;
            ent.x = cx + dx * r;
            ent.y = cy + dy * r;
        }
    }

    private newChain(): number {
        const id = this.nextChainId++;
        this.chainCounts.set(id, 0);
        return id;
    }

    damageEnemy(e: Enemy, dmg: number, depth: number, chainId: number, transmute: boolean) {
        if (!e.active) return;
        const crit = this.rng.next() < this.stats.critChance;
        const amount = crit ? dmg * this.stats.critMul : dmg;
        e.hp -= amount;
        e.flash = 1;
        this.emit({ type: 'ENEMY_HIT', x: e.x, y: e.y, dmg: Math.round(amount * 10) / 10, crit });
        if (e.hp <= 0) this.killEnemy(e, depth, chainId, transmute);
    }

    private killEnemy(e: Enemy, depth: number, chainId: number, transmute: boolean) {
        if (!e.active) return;
        e.active = false;
        const pts = Math.round(100 * (1 + depth) * (e.brute ? 3 : 1) * this.multiplier);
        this.score += pts;
        if (this.theme === Theme.CHAIN_OVERLOAD) this.instability = Math.min(100, this.instability + 4);
        this.emit({ type: 'ENEMY_KILLED', x: e.x, y: e.y, realm: e.realm, score: pts, depth });
        const drops = e.brute ? 4 : 1 + (this.rng.next() < 0.35 ? 1 : 0);
        for (let i = 0; i < drops; i++) this.spawnCoin(e.x, e.y);
        if (this.rng.next() < POWERUP_DROP_CHANCE) this.spawnPowerUp(this.rng.pick(Object.values(PowerUpKind)), e.x, e.y);
        // Every death detonates: this is what cascades a chain reaction across realms.
        this.queueBlast(e.x, e.y, this.stats.blastRadius * (e.brute ? 1.4 : 1), 0.085, depth + 1, chainId, transmute);
    }

    private queueBlast(x: number, y: number, radius: number, delay: number, depth: number, chainId: number, transmute: boolean) {
        const b = this.blasts.find((bl) => !bl.active);
        if (!b) return;
        b.active = true;
        b.x = x;
        b.y = y;
        b.radius = radius;
        b.delay = delay;
        b.depth = depth;
        b.chainId = chainId;
        b.transmute = transmute;
    }

    private anyBlastPending(): boolean {
        for (const b of this.blasts) if (b.active) return true;
        return false;
    }

    private updateBlasts(dt: number) {
        for (const b of this.blasts) {
            if (!b.active) continue;
            b.delay -= dt;
            if (b.delay > 0) continue;
            b.active = false;
            const chain = (this.chainCounts.get(b.chainId) ?? 0) + 1;
            this.chainCounts.set(b.chainId, chain);
            this.emit({ type: 'EXPLOSION', x: b.x, y: b.y, radius: b.radius, depth: b.depth, chain, chainId: b.chainId, transmute: b.transmute });
            for (const e of this.enemies) {
                if (!e.active) continue;
                if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 < (b.radius + e.r) ** 2) this.damageEnemy(e, 2, b.depth, b.chainId, b.transmute);
            }
            this.bestChain = Math.max(this.bestChain, chain);
            if (!this.blasts.some((o) => o.active && o.chainId === b.chainId)) {
                // Cascade finished. A real chain sweeps the floor's coins to you.
                if (chain >= VACUUM_CHAIN) {
                    for (const c of this.coins) if (c.active) c.homing = true;
                    this.emit({ type: 'CHAIN_END', chain, x: b.x, y: b.y });
                }
                if (this.cashBombChains.delete(b.chainId)) this.emit({ type: 'CASH_BOMB', chain });
            }
        }
        if (this.chainCounts.size > 256) {
            // Keep the map bounded; finished chains are irrelevant.
            const live = new Set(this.blasts.filter((b) => b.active).map((b) => b.chainId));
            for (const id of this.chainCounts.keys()) if (!live.has(id)) this.chainCounts.delete(id);
        }
    }

    /** Debug / e2e: guaranteed chain reaction. Places a pack of mixed-realm enemies on an opposite-realm rune. */
    spawnChainDemo(): number {
        const h = this.hazards.find((hz) => hz.realm === Realm.SHADOW_ALCHEMY) ?? this.hazards[0];
        const lure = otherRealm(h.realm);
        let spawned = 0;
        if (this.spawnEnemy(h.x, h.y, lure)) spawned++;
        for (let i = 0; i < 7; i++) {
            const a = (i / 7) * Math.PI * 2;
            const r = 55 + (i % 2) * 40;
            if (this.spawnEnemy(h.x + Math.cos(a) * r, h.y + Math.sin(a) * r, i % 2 ? Realm.SOLAR_ORDER : Realm.SHADOW_ALCHEMY)) spawned++;
        }
        return spawned;
    }

    // ------------------------------------------------------------------ coins / pickups

    spawnCoin(x: number, y: number) {
        const c = this.coins.find((co) => !co.active);
        if (!c) return;
        const a = this.rng.range(0, Math.PI * 2);
        const s = this.rng.range(60, 180);
        c.active = true;
        c.x = x;
        c.y = y;
        c.vx = Math.cos(a) * s;
        c.vy = Math.sin(a) * s;
        c.age = 0;
        c.homing = false;
    }

    private collectCoin(c: Coin) {
        c.active = false;
        this.coinStreak++;
        this.coinStreakT = 1.4;
        this.totalCoins++;
        const before = coinTier(this.linkCoins);
        this.linkCoins++;
        this.score += Math.round(25 * this.multiplier);
        this.emit({ type: 'COIN', x: c.x, y: c.y, streak: this.coinStreak, total: this.linkCoins });
        const after = coinTier(this.linkCoins);
        if (after > before) this.emit({ type: 'COIN_TIER', tier: after });
        if (this.linkCoins >= GRAND_AT) {
            this.linkCoins = 0;
            this.emit({ type: 'JACKPOT_TRIGGER', reason: 'GRAND' });
        }
    }

    private updateCoins(dt: number) {
        const p = this.player;
        const mag = this.stats.magnetRadius;
        for (const c of this.coins) {
            if (!c.active) continue;
            c.age += dt;
            if (c.age > COIN_LIFE && !c.homing) {
                c.active = false;
                continue;
            }
            const dx = p.x - c.x;
            const dy = p.y - c.y;
            const d = Math.hypot(dx, dy) || 1;
            if (c.homing && c.age > 0.3) {
                // Steer the velocity itself (not a force), so a coin can never fall into orbit.
                const speed = Math.min(1100, 300 + (c.age - 0.3) * 1600);
                const k = 1 - Math.exp(-dt * 12);
                c.vx += ((dx / d) * speed - c.vx) * k;
                c.vy += ((dy / d) * speed - c.vy) * k;
                c.x += c.vx * dt;
                c.y += c.vy * dt;
                if (Math.hypot(p.x - c.x, p.y - c.y) < PLAYER_R + 14) this.collectCoin(c);
                continue;
            } else if (d < mag && c.age > 0.25) {
                const pull = 900 * (1 - d / mag) + 200;
                c.vx += (dx / d) * pull * dt;
                c.vy += (dy / d) * pull * dt;
            }
            c.vx *= Math.exp(-dt * 3);
            c.vy *= Math.exp(-dt * 3);
            c.x = Math.max(8, Math.min(ARENA_W - 8, c.x + c.vx * dt));
            c.y = Math.max(8, Math.min(ARENA_H - 8, c.y + c.vy * dt));
            if (d < PLAYER_R + 10 && c.age > 0.15) this.collectCoin(c);
            else if (this.frog.active && (this.frog.x - c.x) ** 2 + (this.frog.y - c.y) ** 2 < 24 * 24) this.collectCoin(c);
        }
    }

    spawnPowerUp(kind: PowerUpKind, x: number, y: number) {
        const pu = this.powerups.find((u) => !u.active);
        if (!pu) return;
        pu.active = true;
        pu.kind = kind;
        pu.x = Math.max(30, Math.min(ARENA_W - 30, x));
        pu.y = Math.max(30, Math.min(ARENA_H - 30, y));
        pu.age = 0;
    }

    private updatePowerUps(dt: number) {
        const p = this.player;
        for (const pu of this.powerups) {
            if (!pu.active) continue;
            pu.age += dt;
            if (pu.age > 14) {
                pu.active = false;
                continue;
            }
            if ((pu.x - p.x) ** 2 + (pu.y - p.y) ** 2 < 30 * 30) {
                pu.active = false;
                this.activatePowerUp(pu.kind);
            }
        }
    }

    activatePowerUp(kind: PowerUpKind) {
        const p = this.player;
        this.emit({ type: 'POWERUP', kind, x: p.x, y: p.y });
        if (kind === PowerUpKind.SHINING_CROWN) {
            p.crown = POWERUP_INFO.SHINING_CROWN.duration;
        } else if (kind === PowerUpKind.RED_SEVEN_BOMB) {
            const chain = this.newChain();
            this.cashBombChains.add(chain);
            this.queueBlast(p.x, p.y, 220, 0.05, 0, chain, true);
            let k = 0;
            for (const e of this.enemies) {
                if (!e.active || (e.x - p.x) ** 2 + (e.y - p.y) ** 2 > 420 * 420) continue;
                this.queueBlast(e.x, e.y, this.stats.blastRadius, 0.12 + k++ * 0.06, 1, chain, true);
            }
        } else {
            const f = this.frog;
            f.active = true;
            f.life = POWERUP_INFO.FROG_FAMILIAR.duration;
            f.x = f.fromX = f.toX = p.x - 30;
            f.y = f.fromY = f.toY = p.y + 20;
            f.hop = 1;
            f.rest = 0;
        }
    }

    private updateFrog(dt: number) {
        const f = this.frog;
        if (!f.active) return;
        f.life -= dt;
        if (f.life <= 0) {
            f.active = false;
            return;
        }
        if (f.hop < 1) {
            f.hop = Math.min(1, f.hop + dt / FROG_HOP_TIME);
            const t = f.hop;
            f.x = f.fromX + (f.toX - f.fromX) * t;
            f.y = f.fromY + (f.toY - f.fromY) * t;
            if (f.hop >= 1) {
                f.rest = FROG_REST;
                this.emit({ type: 'FROG_HOP', x: f.x, y: f.y });
            }
            return;
        }
        f.rest -= dt;
        if (f.rest > 0) return;
        const next = frogNextTarget(f, this.player, this.coins, this.switches, this.stats.magnetRadius);
        f.fromX = f.x;
        f.fromY = f.y;
        f.toX = next.x;
        f.toY = next.y;
        f.hop = 0;
    }

    // ------------------------------------------------------------------ theme rules

    private updateEchoes(dt: number) {
        for (const e of this.echoes) {
            if (!e.active) continue;
            e.t += dt * 60;
            const i = Math.floor(e.t);
            if (i >= e.len) {
                e.active = false;
                continue;
            }
            e.x = e.path[i * 2];
            e.y = e.path[i * 2 + 1];
        }
    }

    private updateSwitches(_dt: number) {
        if (this.theme !== Theme.TIME_ECHO && this.theme !== Theme.PARALLEL_SYNC) {
            for (const s of this.switches) s.held = false;
            return;
        }
        const p = this.player;
        const f = this.frog;
        for (const s of this.switches) {
            const r2 = 30 * 30;
            s.held = (p.x - s.x) ** 2 + (p.y - s.y) ** 2 < r2 || (f.active && (f.x - s.x) ** 2 + (f.y - s.y) ** 2 < r2);
            if (!s.held) for (const e of this.echoes) if (e.active && (e.x - s.x) ** 2 + (e.y - s.y) ** 2 < r2) s.held = true;
        }
        if (this.switchCd <= 0 && this.switches.every((s) => s.held)) {
            this.switchCd = 6;
            const chain = this.newChain();
            for (const s of this.switches) {
                this.emit({ type: 'SWITCH_SYNC', x: s.x, y: s.y });
                this.queueBlast(s.x, s.y, 170, 0, 0, chain, false);
                for (let i = 0; i < 5; i++) this.spawnCoin(s.x, s.y);
            }
            this.score += Math.round(500 * this.multiplier);
        }
    }

    private resetCatalysts() {
        this.catalystCount = 0;
        for (const c of this.catalysts) c.collected = false;
    }

    private updateThemeRules(dt: number) {
        const p = this.player;
        if (this.theme === Theme.CHAIN_OVERLOAD) {
            this.instability = Math.min(100, this.instability + dt * 5.5);
            if (this.instability >= 100) {
                this.instability = 0;
                this.emit({ type: 'OVERLOAD', x: p.x, y: p.y });
                this.queueBlast(p.x, p.y, 260, 0, 0, this.newChain(), false);
                // Greed punishes through shields and crowns.
                p.invuln = 0;
                p.crown = 0;
                p.shield = 0;
                this.hurtPlayer(2);
            }
        } else if (this.theme === Theme.ALCHEMY_CRAFT) {
            for (const c of this.catalysts) {
                if (c.collected || c.realm !== p.realm) continue;
                if ((c.x - p.x) ** 2 + (c.y - p.y) ** 2 < 32 * 32) {
                    c.collected = true;
                    this.catalystCount++;
                    this.emit({ type: 'CATALYST', element: c.element, count: this.catalystCount });
                }
            }
            if (this.catalystCount >= 3) this.transmute();
        }
    }

    /** ALCHEMY_CRAFT finisher: every enemy becomes a blast. */
    transmute() {
        const p = this.player;
        this.emit({ type: 'TRANSMUTE', x: p.x, y: p.y });
        const chain = this.newChain();
        let k = 0;
        for (const e of this.enemies) {
            if (!e.active) continue;
            this.queueBlast(e.x, e.y, this.stats.blastRadius, 0.05 + k++ * 0.04, 1, chain, true);
        }
        this.score += Math.round(1000 * this.multiplier);
        this.resetCatalysts();
        // Move catalysts so the next craft is a new route.
        for (const c of this.catalysts) {
            c.x = this.rng.range(60, ARENA_W - 60);
            c.y = this.rng.range(60, ARENA_H - 60);
            this.resolveWalls(c, 24, c.realm);
        }
    }

    /** Fresh run. `begin = false` leaves the arena empty (title screen / attract reset). */
    restart(begin = true) {
        const p = this.player;
        this.tiers = emptyTiers();
        this.stats = deriveStats(this.tiers);
        Object.assign(p, {
            x: ARENA_W / 2, y: ARENA_H / 2, vx: 0, vy: 0, realm: Realm.SOLAR_ORDER, hp: this.stats.maxHp,
            shield: this.stats.shieldMax, invuln: 1, shiftCd: 0, crown: 0, alive: true,
        });
        for (const e of this.enemies) e.active = false;
        for (const c of this.coins) c.active = false;
        for (const b of this.blasts) b.active = false;
        for (const e of this.echoes) e.active = false;
        for (const u of this.powerups) u.active = false;
        this.frog.active = false;
        this.score = this.wave = this.combo = this.linkCoins = this.totalCoins = this.instability = 0;
        this.bestCombo = this.bestChain = this.lureKills = 0;
        this.sinceHurt = 99;
        this.coinStreak = 0;
        this.gameOver = false;
        this.spawnQueue = 0;
        this.time = 0;
        this.events = [];
        this.setTheme(this.theme);
        if (begin) this.startWave();
    }
}
