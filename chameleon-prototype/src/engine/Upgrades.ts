import { Suit } from './types';

/** Permanent roguelike tiers, one per card suit. */
export type UpgradeTiers = Record<Suit, number>;

export const SUIT_INFO: Record<Suit, { glyph: string; name: string; perk: string }> = {
    CLUBS: { glyph: '♣', name: 'CLUBS', perk: '+Speed  −Shift cooldown' },
    DIAMONDS: { glyph: '♦', name: 'DIAMONDS', perk: '+Coin magnet  +Score ×' },
    HEARTS: { glyph: '♥', name: 'HEARTS', perk: '+Max HP  +Shield regen' },
    SPADES: { glyph: '♠', name: 'SPADES', perk: '+Blast radius  +Crit' },
};

export const emptyTiers = (): UpgradeTiers => ({ CLUBS: 0, DIAMONDS: 0, HEARTS: 0, SPADES: 0 });

export interface PlayerStats {
    speed: number;
    shiftCooldown: number;
    magnetRadius: number;
    scoreMul: number;
    maxHp: number;
    shieldMax: number;
    shieldRegenPerSec: number;
    blastRadius: number;
    critChance: number;
    critMul: number;
}

export function deriveStats(t: UpgradeTiers): PlayerStats {
    return {
        speed: 250 * (1 + 0.12 * t.CLUBS),
        shiftCooldown: 0.42 * Math.pow(0.85, t.CLUBS),
        magnetRadius: 70 + 35 * t.DIAMONDS,
        scoreMul: 1 + 0.25 * t.DIAMONDS,
        maxHp: 5 + t.HEARTS,
        shieldMax: 1 + Math.floor(t.HEARTS / 2),
        shieldRegenPerSec: 1 / 8 + 0.06 * t.HEARTS,
        blastRadius: 95 * (1 + 0.18 * t.SPADES),
        critChance: 0.1 + 0.08 * t.SPADES,
        critMul: 1.5 + 0.5 * t.SPADES,
    };
}
