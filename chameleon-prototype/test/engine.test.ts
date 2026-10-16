import { describe, expect, it } from 'vitest';
import { ARENA_H, ARENA_W, COIN_LIFE, World } from '../src/engine/World';
import { Bot } from '../src/engine/Bot';
import { THEME_BPM } from '../src/engine/BeatClock';
import { JackpotCardsDraft } from '../src/engine/easter-eggs/JackpotCardsDraft';
import { coinTier, comboLabel, GRAND_AT } from '../src/engine/easter-eggs/PortfolioCameos';
import { Rng } from '../src/engine/rng';
import { PowerUpKind, Realm, Theme, type GameEvent, type InputFrame } from '../src/engine/types';

const idle: InputFrame = { moveX: 0, moveY: 0, aim: 0, shift: false };
const shift: InputFrame = { ...idle, shift: true };

function run(w: World, seconds: number, input: InputFrame = idle): GameEvent[] {
    const out: GameEvent[] = [];
    for (let i = 0; i < Math.round(seconds * 60); i++) {
        w.step(input);
        out.push(...w.drainEvents());
    }
    return out;
}

describe('dual-realm core', () => {
    it('SPACE shifts realms, with a cooldown and an on-beat combo', () => {
        const w = new World(7);
        w.clock.beats = 4 - w.clock.bpm / 3600; // the next 1/60 s step lands exactly on beat 4
        w.step(shift);
        const ev = w.drainEvents().find((e) => e.type === 'SHIFT');
        expect(w.player.realm).toBe(Realm.SHADOW_ALCHEMY);
        expect(ev && ev.type === 'SHIFT' && ev.perfect).toBe(true);
        w.step(shift); // still cooling down
        expect(w.player.realm).toBe(Realm.SHADOW_ALCHEMY);
        expect(w.drainEvents().some((e) => e.type === 'SHIFT_DENIED')).toBe(true);
    });

    it('walls only block entities of their realm', () => {
        const w = new World(1);
        const wall = w.walls.find((x) => x.realm === Realm.SOLAR_ORDER)!;
        w.player.x = wall.x + wall.w / 2;
        w.player.y = wall.y - 40;
        run(w, 1, { ...idle, moveY: 1 });
        expect(w.player.y).toBeLessThan(wall.y); // blocked in SOLAR
        w.player.shiftCd = 0;
        w.step(shift);
        run(w, 1, { ...idle, moveY: 1 });
        expect(w.player.y).toBeGreaterThan(wall.y + wall.h); // walked through in SHADOW
    });

    it('luring an enemy into the opposite realm rune transmutes it and chains across realms', () => {
        const w = new World(3);
        const spawned = w.spawnChainDemo();
        expect(spawned).toBe(8);
        const ev = run(w, 1.5);
        const blasts = ev.filter((e) => e.type === 'EXPLOSION');
        expect(blasts.some((e) => e.type === 'EXPLOSION' && e.transmute)).toBe(true);
        expect(Math.max(...blasts.map((e) => (e.type === 'EXPLOSION' ? e.chain : 0)))).toBeGreaterThanOrEqual(4);
        const killedRealms = new Set(ev.flatMap((e) => (e.type === 'ENEMY_KILLED' ? [e.realm] : [])));
        expect(killedRealms.size).toBe(2);
    });

    it('a cleared wave asks for the Jackpot Cards draft', () => {
        const w = new World(5);
        w.startWave();
        const ev = run(w, 0.1);
        expect(ev.some((e) => e.type === 'WAVE_START')).toBe(true);
        for (let i = 0; i < 200 && !w.drainEvents().length; i++);
        // kill everything instantly
        for (let t = 0; t < 600; t++) {
            for (const e of w.enemies) if (e.active) w.damageEnemy(e, 99, 0, 0, false);
            w.step(idle);
            if (w.events.some((e) => e.type === 'JACKPOT_TRIGGER')) break;
        }
        expect(w.drainEvents().some((e) => e.type === 'JACKPOT_TRIGGER')).toBe(true);
    });
});

describe('theme presets', () => {
    it('each preset sets its own tempo without jumping the bar position', () => {
        const w = new World(1);
        run(w, 1.2);
        const pos = w.clock.beats;
        w.setTheme(Theme.CHAIN_OVERLOAD);
        expect(w.clock.bpm).toBe(THEME_BPM.CHAIN_OVERLOAD);
        expect(w.clock.beats).toBe(pos);
        run(w, 1);
        expect(w.clock.beats - pos).toBeCloseTo(124 / 60, 1);
    });

    it('CHAIN_OVERLOAD builds a multiplier and vents on shift', () => {
        const w = new World(2);
        w.setTheme(Theme.CHAIN_OVERLOAD);
        run(w, 8);
        expect(w.instability).toBeGreaterThan(40);
        expect(w.multiplier).toBeGreaterThan(1);
        w.step(shift);
        expect(w.drainEvents().some((e) => e.type === 'VENT')).toBe(true);
        expect(w.instability).toBeLessThan(1);
    });

    it('CHAIN_OVERLOAD punishes greed at 100%', () => {
        const w = new World(2);
        w.setTheme(Theme.CHAIN_OVERLOAD);
        const ev = run(w, 20);
        expect(ev.some((e) => e.type === 'OVERLOAD')).toBe(true);
        expect(w.player.hp).toBeLessThan(w.stats.maxHp);
    });

    it('ALCHEMY_CRAFT: catalysts only collect in their realm, three transmute the arena', () => {
        const w = new World(4);
        w.setTheme(Theme.ALCHEMY_CRAFT);
        w.spawnEnemy(100, 100, Realm.SOLAR_ORDER);
        const events: GameEvent[] = [];
        for (const c of w.catalysts) {
            w.player.x = c.x;
            w.player.y = c.y;
            w.player.realm = c.realm === Realm.SOLAR_ORDER ? Realm.SHADOW_ALCHEMY : Realm.SOLAR_ORDER;
            events.push(...run(w, 0.05));
            expect(c.collected).toBe(false);
            w.player.realm = c.realm;
            events.push(...run(w, 0.05));
        }
        expect(events.filter((e) => e.type === 'CATALYST')).toHaveLength(3);
        expect(events.some((e) => e.type === 'TRANSMUTE')).toBe(true);
        expect(w.catalystCount).toBe(0);
    });

    it('TIME_ECHO replays the last 5s of movement in the realm you left', () => {
        const w = new World(6);
        w.setTheme(Theme.TIME_ECHO);
        run(w, 2, { ...idle, moveX: 1 });
        const startX = w.player.x;
        w.step(shift);
        const echo = w.echoes.find((e) => e.active)!;
        expect(echo.realm).toBe(Realm.SOLAR_ORDER);
        expect(echo.len).toBeGreaterThan(100);
        expect(echo.x).toBeLessThan(startX - 200);
        run(w, 1);
        expect(echo.x).toBeGreaterThan(echo.path[0]);
    });

    it('TIME_ECHO: an echo on one switch + you on the other = SYNC', () => {
        const w = new World(6);
        w.setTheme(Theme.TIME_ECHO);
        const [a, b] = w.switches;
        w.player.x = a.x;
        w.player.y = a.y;
        run(w, 1);
        w.step(shift);
        w.player.x = b.x;
        w.player.y = b.y;
        const ev = run(w, 0.2);
        expect(ev.some((e) => e.type === 'SWITCH_SYNC')).toBe(true);
    });

    it('SHADOW_LENS reveals only what the cone points at', () => {
        const w = new World(8);
        w.setTheme(Theme.SHADOW_LENS);
        const h = w.hazards.find((x) => x.realm === Realm.SHADOW_ALCHEMY)!;
        w.player.x = h.x - 150;
        w.player.y = h.y;
        w.step({ ...idle, aim: Math.PI }); // pointing away
        expect(h.revealed).toBe(false);
        w.step({ ...idle, aim: 0 }); // pointing at it
        expect(h.revealed).toBe(true);
        expect(w.player.realm).toBe(Realm.SOLAR_ORDER);
    });
});

describe('portfolio cameos', () => {
    it('coin link tiers MINI/MINOR/MAJOR/GRAND', () => {
        expect([0, 5, 9, 10, 15, 20].map(coinTier)).toEqual([-1, 0, 0, 1, 2, 3]);
        expect(GRAND_AT).toBe(20);
        expect(comboLabel(27)).toBe('27 ETERNAL COMBO!');
    });

    it('collecting 20 golden coins triggers the draft', () => {
        const w = new World(9);
        const ev: GameEvent[] = [];
        for (let i = 0; i < 20; i++) {
            w.spawnCoin(w.player.x, w.player.y);
            ev.push(...run(w, 0.3));
        }
        expect(ev.filter((e) => e.type === 'COIN_TIER').map((e) => (e.type === 'COIN_TIER' ? e.tier : -1))).toEqual([0, 1, 2, 3]);
        expect(ev.some((e) => e.type === 'JACKPOT_TRIGGER' && e.reason === 'GRAND')).toBe(true);
        expect(w.linkCoins).toBe(0);
    });

    it('Shining Crown blocks damage; Cash Bomb reports a combo; Frog hops', () => {
        const w = new World(10);
        w.activatePowerUp(PowerUpKind.SHINING_CROWN);
        const e = w.spawnEnemy(w.player.x, w.player.y, Realm.SOLAR_ORDER)!;
        e.speed = 0;
        run(w, 1);
        expect(w.player.hp).toBe(w.stats.maxHp);
        expect(w.multiplier).toBe(2);

        for (let i = 0; i < 6; i++) w.spawnEnemy(w.player.x + 60 + i * 30, w.player.y, Realm.SHADOW_ALCHEMY);
        w.activatePowerUp(PowerUpKind.RED_SEVEN_BOMB);
        const ev = run(w, 2);
        const bomb = ev.find((x) => x.type === 'CASH_BOMB');
        expect(bomb && bomb.type === 'CASH_BOMB' && bomb.chain).toBeGreaterThan(3);

        w.activatePowerUp(PowerUpKind.FROG_FAMILIAR);
        w.spawnCoin(ARENA_W - 40, ARENA_H - 40);
        const hops = run(w, 3).filter((x) => x.type === 'FROG_HOP');
        expect(hops.length).toBeGreaterThan(3);
    });
});

describe('coins and attract mode', () => {
    it('uncollected coins expire, and a finished chain vacuums the floor', () => {
        const w = new World(11);
        w.spawnCoin(40, 40);
        run(w, COIN_LIFE + 0.2);
        expect(w.coins.some((c) => c.active)).toBe(false);

        const far = new World(12);
        far.player.x = 80;
        far.player.y = ARENA_H / 2;
        far.god = true;
        far.spawnChainDemo();
        const ev = run(far, 3);
        const end = ev.find((e) => e.type === 'CHAIN_END');
        expect(end && end.type === 'CHAIN_END' && end.chain).toBeGreaterThanOrEqual(3);
        expect(far.bestChain).toBeGreaterThanOrEqual(3);
        expect(far.totalCoins).toBeGreaterThan(0); // pulled across the arena
        expect(far.lureKills).toBeGreaterThan(0);
    });

    it('the attract-mode bot plays a wave on its own: lures, shifts on the beat, scores', () => {
        const w = new World(21);
        w.god = true;
        w.startWave();
        const bot = new Bot();
        const ev: GameEvent[] = [];
        for (let i = 0; i < 60 * 60; i++) {
            w.step(bot.think(w));
            ev.push(...w.drainEvents());
        }
        const shifts = ev.filter((e) => e.type === 'SHIFT');
        expect(shifts.length).toBeGreaterThan(3);
        expect(shifts.every((e) => e.type === 'SHIFT' && e.perfect)).toBe(true);
        expect(w.score).toBeGreaterThan(500);
        expect(ev.some((e) => e.type === 'WAVE_CLEAR')).toBe(true);
    });
});

describe('Jackpot Cards draft model', () => {
    it('deals 4 suits x 3 and always finds a triple within 9 flips', () => {
        for (let seed = 1; seed < 200; seed++) {
            const d = new JackpotCardsDraft(new Rng(seed));
            expect(d.cards).toHaveLength(12);
            const plan = d.autoRevealPlan();
            expect(plan.length).toBeLessThanOrEqual(9);
            expect(d.matched).not.toBeNull();
            expect(plan[plan.length - 1].matched).toBe(d.matched);
            expect(d.flip(11)).toBeNull(); // locked after a match
        }
    });

    it('rejects double flips', () => {
        const d = new JackpotCardsDraft(new Rng(1));
        expect(d.flip(0)).not.toBeNull();
        expect(d.flip(0)).toBeNull();
        expect(d.flips).toBe(1);
    });
});
