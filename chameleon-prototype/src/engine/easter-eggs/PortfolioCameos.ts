/**
 * Pure rules for the portfolio nods: the 4-tier "Golden Coins Link" progressive bar and
 * the three cameo power-ups. The World calls into these; the view only reads the results.
 */
import { PowerUpKind } from '../types';

export const COIN_TIERS = [
    { name: 'MINI', at: 5, color: 0x6fe3ff },
    { name: 'MINOR', at: 10, color: 0x7dff8a },
    { name: 'MAJOR', at: 15, color: 0xff7ad9 },
    { name: 'GRAND', at: 20, color: 0xffd34d },
] as const;

export const GRAND_AT = COIN_TIERS[COIN_TIERS.length - 1].at;

/** Index of the highest tier reached (-1 = none) for a coin count inside the current link. */
export function coinTier(count: number): number {
    let tier = -1;
    for (let i = 0; i < COIN_TIERS.length; i++) if (count >= COIN_TIERS[i].at) tier = i;
    return tier;
}

export const POWERUP_INFO: Record<PowerUpKind, { title: string; subtitle: string; duration: number; color: number }> = {
    SHINING_CROWN: { title: 'SHINING CROWN', subtitle: 'Invulnerable · 2× score', duration: 6, color: 0xffd34d },
    RED_SEVEN_BOMB: { title: 'CASH BOMB', subtitle: 'Lucky sevens detonate', duration: 0, color: 0xff3048 },
    FROG_FAMILIAR: { title: 'FROG FAMILIAR', subtitle: 'Hops for coins & switches', duration: 20, color: 0x5dff7a },
};

export const POWERUP_DROP_CHANCE = 0.07;

/** Odometer label for the Cash Bomb popup, e.g. "27 ETERNAL COMBO!". */
export function comboLabel(n: number): string {
    if (n >= 20) return `${n} ETERNAL COMBO!`;
    if (n >= 10) return `${n} BURNING COMBO!`;
    return `${n} HOT COMBO!`;
}

export interface FrogState {
    active: boolean;
    x: number;
    y: number;
    /** 0..1 progress of the current hop; height = sin(pi * t). */
    hop: number;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    rest: number;
    life: number;
}

export const FROG_HOP_TIME = 0.32;
export const FROG_HOP_DIST = 80;
export const FROG_REST = 0.12;

/** Pick the frog's next landing spot: furthest-from-player coin, else an unheld switch, else heel. */
export function frogNextTarget(
    frog: FrogState,
    player: { x: number; y: number },
    coins: readonly { active: boolean; x: number; y: number }[],
    switches: readonly { x: number; y: number; held: boolean }[],
    magnetRadius: number,
): { x: number; y: number } {
    let best: { x: number; y: number } | null = null;
    let bestD = 0;
    for (const c of coins) {
        if (!c.active) continue;
        const dp = Math.hypot(c.x - player.x, c.y - player.y);
        if (dp <= magnetRadius) continue;
        if (dp > bestD) {
            bestD = dp;
            best = c;
        }
    }
    if (!best) for (const s of switches) if (!s.held) best = s;
    const target = best ?? { x: player.x - 40, y: player.y + 30 };
    const dx = target.x - frog.x;
    const dy = target.y - frog.y;
    const d = Math.hypot(dx, dy);
    if (d <= FROG_HOP_DIST) return { x: target.x, y: target.y };
    return { x: frog.x + (dx / d) * FROG_HOP_DIST, y: frog.y + (dy / d) * FROG_HOP_DIST };
}
