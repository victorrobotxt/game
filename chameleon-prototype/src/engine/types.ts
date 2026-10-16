/** Pure engine types. Nothing in src/engine may import pixi.js, gsap or touch the DOM. */

export const Realm = {
    SOLAR_ORDER: 'SOLAR_ORDER',
    SHADOW_ALCHEMY: 'SHADOW_ALCHEMY',
} as const;
export type Realm = (typeof Realm)[keyof typeof Realm];

export const otherRealm = (r: Realm): Realm => (r === Realm.SOLAR_ORDER ? Realm.SHADOW_ALCHEMY : Realm.SOLAR_ORDER);

export const Theme = {
    PARALLEL_SYNC: 'PARALLEL_SYNC',
    CHAIN_OVERLOAD: 'CHAIN_OVERLOAD',
    ALCHEMY_CRAFT: 'ALCHEMY_CRAFT',
    TIME_ECHO: 'TIME_ECHO',
    SHADOW_LENS: 'SHADOW_LENS',
} as const;
export type Theme = (typeof Theme)[keyof typeof Theme];

/** Keys 1–5 map onto this order. */
export const THEME_ORDER: readonly Theme[] = [
    Theme.PARALLEL_SYNC,
    Theme.CHAIN_OVERLOAD,
    Theme.ALCHEMY_CRAFT,
    Theme.TIME_ECHO,
    Theme.SHADOW_LENS,
];

export const THEME_INFO: Record<Theme, { title: string; tagline: string; hint: string }> = {
    PARALLEL_SYNC: {
        title: 'PARALLEL SYNC',
        tagline: 'Two Worlds, One Clock',
        hint: 'SPACE on the beat to shift realms. Lure foes into the OTHER realm’s runes.',
    },
    CHAIN_OVERLOAD: {
        title: 'CHAIN OVERLOAD',
        tagline: 'Critical Mass',
        hint: 'Instability builds your multiplier. Shift to vent before it hits 100%.',
    },
    ALCHEMY_CRAFT: {
        title: 'ALCHEMY CRAFT',
        tagline: 'Secrets of Alchemy',
        hint: 'Collect IGNIS, AQUA and AETHER across both realms to transmute the arena.',
    },
    TIME_ECHO: {
        title: 'TIME ECHO',
        tagline: 'Borrowed Time',
        hint: 'Each shift leaves a 5s echo of you. Hold both switches at once for a SYNC burst.',
    },
    SHADOW_LENS: {
        title: 'SHADOW LENS',
        tagline: 'Hidden in Plain Sight',
        hint: 'Aim the lens (mouse / phone tilt) to reveal and burn the hidden. SPACE = flare.',
    },
};

export interface Vec2 {
    x: number;
    y: number;
}

export interface InputFrame {
    /** -1..1 */
    moveX: number;
    moveY: number;
    /** Lens / aim direction in radians (world space). */
    aim: number;
    /** Edge-triggered: true for exactly one step. */
    shift: boolean;
}

export const Element = { IGNIS: 'IGNIS', AQUA: 'AQUA', AETHER: 'AETHER' } as const;
export type Element = (typeof Element)[keyof typeof Element];

export const PowerUpKind = {
    SHINING_CROWN: 'SHINING_CROWN',
    RED_SEVEN_BOMB: 'RED_SEVEN_BOMB',
    FROG_FAMILIAR: 'FROG_FAMILIAR',
} as const;
export type PowerUpKind = (typeof PowerUpKind)[keyof typeof PowerUpKind];

export const Suit = { CLUBS: 'CLUBS', DIAMONDS: 'DIAMONDS', HEARTS: 'HEARTS', SPADES: 'SPADES' } as const;
export type Suit = (typeof Suit)[keyof typeof Suit];
export const SUITS: readonly Suit[] = [Suit.CLUBS, Suit.DIAMONDS, Suit.HEARTS, Suit.SPADES];

export type GameEvent =
    | { type: 'SHIFT'; realm: Realm; perfect: boolean; combo: number; x: number; y: number; radius: number }
    | { type: 'SHIFT_DENIED' }
    | { type: 'MISTIMED'; x: number; y: number; lock: number }
    | { type: 'ENEMY_TELEGRAPH'; x: number; y: number }
    | { type: 'EXPLOSION'; x: number; y: number; radius: number; depth: number; chain: number; chainId: number; transmute: boolean }
    | { type: 'ENEMY_HIT'; x: number; y: number; dmg: number; crit: boolean }
    | { type: 'ENEMY_KILLED'; x: number; y: number; realm: Realm; score: number; depth: number }
    | { type: 'COIN'; x: number; y: number; streak: number; total: number }
    | { type: 'COIN_TIER'; tier: number }
    | { type: 'PLAYER_HURT'; hp: number }
    | { type: 'WAVE_START'; wave: number }
    | { type: 'WAVE_CLEAR'; wave: number }
    | { type: 'JACKPOT_TRIGGER'; reason: 'WAVE_CLEAR' | 'GRAND' | 'DEBUG' }
    | { type: 'CATALYST'; element: Element; count: number }
    | { type: 'TRANSMUTE'; x: number; y: number }
    | { type: 'POWERUP'; kind: PowerUpKind; x: number; y: number }
    | { type: 'CASH_BOMB'; chain: number }
    | { type: 'CHAIN_END'; chain: number; x: number; y: number }
    | { type: 'ECHO_SPAWN'; realm: Realm }
    | { type: 'VENT'; amount: number; bonus: number; x: number; y: number }
    | { type: 'OVERLOAD'; x: number; y: number }
    | { type: 'SWITCH_SYNC'; x: number; y: number }
    | { type: 'LENS_FLARE'; x: number; y: number; angle: number }
    | { type: 'FROG_HOP'; x: number; y: number }
    | { type: 'GAME_OVER'; score: number };
