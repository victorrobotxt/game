import { ARENA_H, ARENA_W, LENS_RANGE, type World } from './World';
import { Realm, Theme, type InputFrame } from './types';

/**
 * Attract-mode autopilot. Pure: reads the World, returns an InputFrame, so it is unit-testable
 * and plays through exactly the same input path a human does.
 *
 * It plays the game's own trick: stand behind a rune of the OTHER realm so the chasing pack
 * walks across it, keep away from enemies that share its realm, hoover coins, and shift on the beat.
 */
export class Bot {
    private readonly out: InputFrame = { moveX: 0, moveY: 0, aim: 0, shift: false };
    private retarget = 0;
    private runeIdx = 0;
    private lastScore = 0;
    /** Seconds without scoring; after a few the bot stops luring and hunts with on-beat shifts. */
    private stall = 0;

    think(world: World, dt = 1 / 60): InputFrame {
        const p = world.player;
        const out = this.out;
        out.shift = false;
        let fx = 0;
        let fy = 0;

        if (world.score !== this.lastScore) {
            this.lastScore = world.score;
            this.stall = 0;
        } else this.stall += dt;
        const hunt = this.stall > 5;
        let prey: { x: number; y: number } | null = null;

        // 1. Pick a lure rune: the one whose realm differs from most nearby enemies.
        this.retarget -= dt;
        let cx = 0;
        let cy = 0;
        let n = 0;
        let solar = 0;
        for (const e of world.enemies) {
            if (!e.active) continue;
            cx += e.x;
            cy += e.y;
            n++;
            if (e.realm === Realm.SOLAR_ORDER) solar++;
        }
        if (n > 0) {
            cx /= n;
            cy /= n;
            if (this.retarget <= 0) {
                this.retarget = 2.5;
                const lureRealm = solar * 2 >= n ? Realm.SHADOW_ALCHEMY : Realm.SOLAR_ORDER;
                let best = Infinity;
                world.hazards.forEach((h, i) => {
                    if (h.realm !== lureRealm) return;
                    const d = Math.hypot(h.x - p.x, h.y - p.y);
                    if (d < best) {
                        best = d;
                        this.runeIdx = i;
                    }
                });
            }
            if (hunt) {
                // A perfect shift damages enemies of the realm you land in: walk up to a ghost and shift.
                let best = Infinity;
                for (const e of world.enemies) {
                    if (!e.active) continue;
                    const d = Math.hypot(e.x - p.x, e.y - p.y);
                    if (d < best) {
                        best = d;
                        prey = e;
                    }
                }
            }
            const h = world.hazards[this.runeIdx];
            // Stand on the far side of the rune from the pack, so their path crosses it.
            const ax = h.x - cx;
            const ay = h.y - cy;
            const al = Math.hypot(ax, ay) || 1;
            const tx = prey ? prey.x : clamp(h.x + (ax / al) * (h.r + 70), 40, ARENA_W - 40);
            const ty = prey ? prey.y : clamp(h.y + (ay / al) * (h.r + 70), 40, ARENA_H - 40);
            const dx = tx - p.x;
            const dy = ty - p.y;
            const dl = Math.hypot(dx, dy);
            if (dl > 12) {
                fx += (dx / dl) * Math.min(1, dl / 60);
                fy += (dy / dl) * Math.min(1, dl / 60);
            } else {
                // Arrived: circle slowly so the pack keeps streaming over the rune.
                fx += -ay / al * 0.4;
                fy += ax / al * 0.4;
            }
        } else {
            // Idle between waves: drift back to the centre.
            fx += (ARENA_W / 2 - p.x) / 300;
            fy += (ARENA_H / 2 - p.y) / 300;
        }

        // 2. Repel from enemies that can touch us and from our own realm's runes.
        let threat = 0;
        for (const e of world.enemies) {
            if (!e.active) continue;
            const shared = world.theme === Theme.SHADOW_LENS ? e.realm === Realm.SOLAR_ORDER || e.revealed : e.realm === p.realm;
            if (!shared) continue;
            const dx = p.x - e.x;
            const dy = p.y - e.y;
            const d = Math.hypot(dx, dy) || 1;
            if (d < 110) {
                const f = (1 - d / 110) * 2.2;
                fx += (dx / d) * f;
                fy += (dy / d) * f;
            }
            if (d < 80) threat++;
        }
        for (const h of world.hazards) {
            if (h.realm !== p.realm || world.theme === Theme.SHADOW_LENS) continue;
            const dx = p.x - h.x;
            const dy = p.y - h.y;
            const d = Math.hypot(dx, dy) || 1;
            if (d < h.r + 40) {
                fx += (dx / d) * 2;
                fy += (dy / d) * 2;
            }
        }

        // 3. Coins and power-ups close by.
        for (const c of world.coins) {
            if (!c.active) continue;
            const dx = c.x - p.x;
            const dy = c.y - p.y;
            const d = Math.hypot(dx, dy) || 1;
            if (d < 160) {
                fx += (dx / d) * 0.5;
                fy += (dy / d) * 0.5;
            }
        }
        for (const u of world.powerups) {
            if (!u.active) continue;
            const dx = u.x - p.x;
            const dy = u.y - p.y;
            const d = Math.hypot(dx, dy) || 1;
            fx += (dx / d) * 0.8;
            fy += (dy / d) * 0.8;
        }

        const fl = Math.hypot(fx, fy);
        out.moveX = fl > 1 ? fx / fl : fx;
        out.moveY = fl > 1 ? fy / fl : fy;

        // 4. Aim the lens at the nearest shadow enemy; otherwise look where we walk.
        let aimD = Infinity;
        out.aim = p.facing;
        for (const e of world.enemies) {
            if (!e.active) continue;
            const d = Math.hypot(e.x - p.x, e.y - p.y);
            if (d < aimD && d < LENS_RANGE) {
                aimD = d;
                out.aim = Math.atan2(e.y - p.y, e.x - p.x);
            }
        }

        // 5. Shift only on the beat (it is the skill the demo is showing off).
        const onBeat = world.clock.error() < 0.05;
        if (onBeat) {
            if (world.theme === Theme.SHADOW_LENS) out.shift = world.lensFlareCd <= 0 && aimD < LENS_RANGE * 0.8;
            else {
                const preyNear = prey !== null && Math.hypot(prey.x - p.x, prey.y - p.y) < 90;
                out.shift = p.shiftCd <= 0 && (threat > 0 || preyNear || (world.clock.beats % 8 < 1 && n > 0));
            }
        }
        return out;
    }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
