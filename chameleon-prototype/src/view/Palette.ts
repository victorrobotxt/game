import type { Realm, Theme } from '../engine/types';

export interface RealmPalette {
    bg: number;
    grid: number;
    gridHot: number;
    wall: number;
    wallEdge: number;
    rune: number;
    enemy: number;
    accent: number;
    cloak: number;
}

type Skin = Record<Realm, RealmPalette>;

const pal = (
    bg: number, grid: number, gridHot: number, wall: number, wallEdge: number,
    rune: number, enemy: number, accent: number, cloak: number,
): RealmPalette => ({ bg, grid, gridHot, wall, wallEdge, rune, enemy, accent, cloak });

/**
 * One skin per theme preset, each with a Solar and a Shadow side, so pressing 1-5 on stage
 * visibly turns the arena into a different game. Pivoting to a new hackathon theme starts here.
 */
export const SKINS: Record<Theme, Skin> = {
    // Two Worlds, One Clock: gold/amber/crimson sundial vs violet/cyan star lattice.
    PARALLEL_SYNC: {
        SOLAR_ORDER: pal(0x1d0d08, 0x6b2a12, 0xffb347, 0xc8641e, 0xffd34d, 0xff4d2e, 0xff5a36, 0xffd34d, 0xffa53a),
        SHADOW_ALCHEMY: pal(0x07061a, 0x2c1a66, 0x3ef0ff, 0x5a2bd6, 0x7ff6ff, 0x9b4dff, 0x45e6ff, 0x3ef0ff, 0x8a5cff),
    },
    // Critical Mass: cold steel reactor with hazard orange vs radioactive green.
    CHAIN_OVERLOAD: {
        SOLAR_ORDER: pal(0x0c1018, 0x2a3442, 0xff6a00, 0xd84a12, 0xffb000, 0xff2a2a, 0xff4a1a, 0xffb000, 0xff7a1a),
        SHADOW_ALCHEMY: pal(0x020d07, 0x0d3d22, 0x7dff3a, 0x1f8a3a, 0xc8ff3a, 0x3aff8a, 0x9dff3a, 0xc8ff3a, 0x4dff7a),
    },
    // Secrets of Alchemy: emerald & gilt vs magenta & teal.
    ALCHEMY_CRAFT: {
        SOLAR_ORDER: pal(0x0a1308, 0x2a3a12, 0xe8c44a, 0x7a8a2a, 0xf2d675, 0xe86a2a, 0xff7a3a, 0xf2d675, 0xd9b84a),
        SHADOW_ALCHEMY: pal(0x0b0618, 0x3a1446, 0xff5ad9, 0x7a2a8a, 0xff9af0, 0x3ad9c8, 0x5afff0, 0xff7ae0, 0xc85aff),
    },
    // Borrowed Time: brass clockwork vs frost.
    TIME_ECHO: {
        SOLAR_ORDER: pal(0x140d05, 0x4a3416, 0xd89a4a, 0xa0642a, 0xf0c080, 0xe05a3a, 0xff8a4a, 0xf0c080, 0xd08a3a),
        SHADOW_ALCHEMY: pal(0x040a14, 0x163450, 0x9ae0ff, 0x3a6a9a, 0xd8f4ff, 0x6ab0ff, 0xb0eaff, 0xd8f4ff, 0x7ac0ff),
    },
    // Hidden in Plain Sight: monochrome noir; colour only lives inside the lens.
    SHADOW_LENS: {
        SOLAR_ORDER: pal(0x08090c, 0x252830, 0x8a93a8, 0x4a505e, 0xc8d0e0, 0xc84a5a, 0xe86a7a, 0xe8e0d0, 0xb0b8c8),
        SHADOW_ALCHEMY: pal(0x06040e, 0x24163a, 0xb98cff, 0x4a2a7a, 0xd0b0ff, 0x9b4dff, 0x45e6ff, 0xb98cff, 0x8a5cff),
    },
};

/** Base palettes (PARALLEL_SYNC) used for the few textures baked with fixed colours. */
export const PALETTES: Skin = SKINS.PARALLEL_SYNC;

export function lerpColor(a: number, b: number, t: number): number {
    const ar = (a >> 16) & 255;
    const ag = (a >> 8) & 255;
    const ab = a & 255;
    const r = ar + (((b >> 16) & 255) - ar) * t;
    const g = ag + (((b >> 8) & 255) - ag) * t;
    const bl = ab + ((b & 255) - ab) * t;
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

/** Per-key lerp of two palettes into `out` (no per-frame allocation). */
export function mixPalette(a: RealmPalette, b: RealmPalette, t: number, out: RealmPalette): RealmPalette {
    for (const k of Object.keys(a) as (keyof RealmPalette)[]) out[k] = lerpColor(a[k], b[k], t);
    return out;
}

export const SUIT_COLORS = { CLUBS: 0x5dff9a, DIAMONDS: 0x4dc3ff, HEARTS: 0xff4d6d, SPADES: 0xc07dff } as const;
export const ELEMENT_COLORS = { IGNIS: 0xff6a2e, AQUA: 0x3ec8ff, AETHER: 0xe9d8ff } as const;
export const FONT = 'Verdana, DejaVu Sans, Bitstream Vera Sans, sans-serif';

/**
 * Title typography per preset (banners, wave popups, title screen, results). System font stacks
 * only, so there is nothing to clear with the organisers. Swap in a web font here if allowed.
 */
export interface TitleStyle {
    font: string;
    weight: 'normal' | 'bold';
    italic: boolean;
    spacing: number;
    /** Title fill + outline; the tagline uses the realm accent. */
    fill: number;
    stroke: number;
    /** Banner frame: 'round' panel, 'hazard' stripes, 'sigil' double rule, 'brass' rivets, 'noir' bars. */
    frame: 'round' | 'hazard' | 'sigil' | 'brass' | 'noir';
}

export const TITLE_STYLES: Record<Theme, TitleStyle> = {
    PARALLEL_SYNC: { font: 'Georgia, "DejaVu Serif", serif', weight: 'bold', italic: false, spacing: 6, fill: 0xffe9a8, stroke: 0x3a1206, frame: 'round' },
    CHAIN_OVERLOAD: { font: 'Impact, "Arial Black", "DejaVu Sans Condensed", "DejaVu Sans", sans-serif', weight: 'bold', italic: true, spacing: 2, fill: 0xffb000, stroke: 0x2a0400, frame: 'hazard' },
    ALCHEMY_CRAFT: { font: '"Palatino Linotype", Palatino, "C059", "Gentium Book Basic", "DejaVu Serif", serif', weight: 'normal', italic: true, spacing: 4, fill: 0xf2d675, stroke: 0x10200a, frame: 'sigil' },
    TIME_ECHO: { font: '"Courier New", Courier, "DejaVu Sans Mono", monospace', weight: 'bold', italic: false, spacing: 8, fill: 0xf0c080, stroke: 0x1a0e04, frame: 'brass' },
    SHADOW_LENS: { font: '"Trebuchet MS", "DejaVu Sans Condensed", "DejaVu Sans", sans-serif', weight: 'normal', italic: false, spacing: 14, fill: 0xe8e0d0, stroke: 0x000000, frame: 'noir' },
};

export const hexCss = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
