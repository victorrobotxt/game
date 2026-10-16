import { Container, Graphics, Rectangle, type Renderer, type Texture } from 'pixi.js';
import { ARENA_H, ARENA_W } from '../engine/World';
import { Realm, type Theme } from '../engine/types';
import { SKINS, type RealmPalette } from './Palette';

/**
 * Arena floor art, one motif per theme and realm, drawn procedurally and baked into a
 * RenderTexture the first time a theme is shown (then cached).
 */
type Motif = (g: Graphics, p: RealmPalette, shadow: boolean) => void;

const W = ARENA_W;
const H = ARENA_H;
const CX = W / 2;
const CY = H / 2;
const TAU = Math.PI * 2;

function seeded(seed: number) {
    let s = seed;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function squareGrid(g: Graphics, color: number, step: number, alpha: number) {
    for (let x = 0; x <= W; x += step) g.moveTo(x, 0).lineTo(x, H).stroke({ width: x % (step * 5) ? 1 : 2, color, alpha: x % (step * 5) ? alpha : alpha * 1.6 });
    for (let y = 0; y <= H; y += step) g.moveTo(0, y).lineTo(W, y).stroke({ width: y % (step * 5) ? 1 : 2, color, alpha: y % (step * 5) ? alpha : alpha * 1.6 });
}

function stars(g: Graphics, p: RealmPalette, n: number, seed: number) {
    const rnd = seeded(seed);
    for (let i = 0; i < n; i++) g.circle(rnd() * W, rnd() * H, rnd() * 1.8 + 0.4).fill({ color: rnd() > 0.5 ? p.gridHot : 0xffffff, alpha: 0.2 + rnd() * 0.5 });
}

function hexGrid(g: Graphics, color: number, r: number, alpha: number, nodes?: number) {
    const w = Math.sqrt(3) * r;
    for (let row = -1; row * r * 1.5 < H + r; row++) {
        for (let col = -1; col * w < W + w; col++) {
            const x = col * w + (row % 2 ? w / 2 : 0);
            const y = row * r * 1.5;
            g.regularPoly(x, y, r - 2, 6, 0).stroke({ width: 1.5, color, alpha });
            if (nodes !== undefined && (row * 7 + col * 3) % 5 === 0) g.circle(x, y, 3).fill({ color: nodes, alpha: 0.45 });
        }
    }
}

function gear(g: Graphics, x: number, y: number, r: number, teeth: number, color: number, alpha: number) {
    const pts: number[] = [];
    for (let i = 0; i < teeth * 2; i++) {
        const a0 = (i / (teeth * 2)) * TAU;
        const a1 = ((i + 1) / (teeth * 2)) * TAU;
        const rr = i % 2 ? r : r + r * 0.14;
        pts.push(x + Math.cos(a0) * rr, y + Math.sin(a0) * rr, x + Math.cos(a1) * rr, y + Math.sin(a1) * rr);
    }
    g.poly(pts).stroke({ width: 2, color, alpha });
    g.circle(x, y, r * 0.72).stroke({ width: 1.5, color, alpha: alpha * 0.7 });
    g.circle(x, y, r * 0.16).stroke({ width: 2, color, alpha });
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        g.moveTo(x + Math.cos(a) * r * 0.16, y + Math.sin(a) * r * 0.16).lineTo(x + Math.cos(a) * r * 0.72, y + Math.sin(a) * r * 0.72).stroke({ width: 1.5, color, alpha: alpha * 0.6 });
    }
}

const MOTIFS: Record<Theme, Motif> = {
    PARALLEL_SYNC: (g, p, shadow) => {
        if (!shadow) {
            squareGrid(g, p.grid, 40, 0.55);
            for (let r = 80; r < 700; r += 90) g.circle(CX, CY, r).stroke({ width: 1.5, color: p.gridHot, alpha: 0.12 });
            for (let i = 0; i < 24; i++) {
                const a = (i / 24) * TAU;
                g.moveTo(CX + Math.cos(a) * 60, CY + Math.sin(a) * 60).lineTo(CX + Math.cos(a) * 900, CY + Math.sin(a) * 900).stroke({ width: 1, color: p.gridHot, alpha: 0.07 });
            }
            for (let i = 0; i < 12; i++) {
                const a = (i / 12) * TAU - Math.PI / 2;
                g.circle(CX + Math.cos(a) * 250, CY + Math.sin(a) * 250, 4).fill({ color: p.gridHot, alpha: 0.35 });
            }
        } else {
            for (let k = -H; k < W + H; k += 48) {
                g.moveTo(k, 0).lineTo(k + H, H).stroke({ width: 1, color: p.grid, alpha: 0.75 });
                g.moveTo(k, H).lineTo(k + H, 0).stroke({ width: 1, color: p.grid, alpha: 0.75 });
            }
            stars(g, p, 140, 12345);
            for (let r = 70; r < 700; r += 110) g.regularPoly(CX, CY, r, 6, 0).stroke({ width: 1.5, color: p.gridHot, alpha: 0.1 });
        }
    },
    CHAIN_OVERLOAD: (g, p, shadow) => {
        hexGrid(g, p.grid, 34, 0.7, shadow ? p.gridHot : undefined);
        // Reactor core rings + hazard chevrons around the rim.
        for (let r = 60; r < 360; r += 60) g.circle(CX, CY, r).stroke({ width: r === 180 ? 3 : 1.5, color: p.gridHot, alpha: r === 180 ? 0.22 : 0.1 });
        for (let i = 0; i < 3; i++) {
            const a = (i / 3) * TAU - Math.PI / 2;
            g.moveTo(CX, CY).arc(CX, CY, 120, a - 0.5, a + 0.5).lineTo(CX, CY).fill({ color: p.gridHot, alpha: 0.06 });
        }
        for (let x = -20; x < W + 20; x += 36) {
            g.poly([x, 0, x + 18, 0, x + 6, 14, x - 12, 14]).fill({ color: p.gridHot, alpha: 0.16 });
            g.poly([x, H, x + 18, H, x + 6, H - 14, x - 12, H - 14]).fill({ color: p.gridHot, alpha: 0.16 });
        }
    },
    ALCHEMY_CRAFT: (g, p, shadow) => {
        const rnd = seeded(shadow ? 99 : 7);
        for (let i = 0; i < 260; i++) g.circle(rnd() * W, rnd() * H, 1).fill({ color: p.grid, alpha: 0.9 });
        // A great transmutation circle filling the arena.
        for (const r of [250, 236, 175, 110]) g.circle(CX, CY, r).stroke({ width: r === 236 ? 1 : 2, color: p.gridHot, alpha: 0.16 });
        const n = shadow ? 6 : 7;
        const star: number[] = [];
        for (let i = 0; i < n; i++) {
            const a = ((i * (shadow ? 2 : 3)) / n) * TAU - Math.PI / 2;
            star.push(CX + Math.cos(a) * 236, CY + Math.sin(a) * 236);
        }
        g.poly(star).stroke({ width: 1.5, color: p.gridHot, alpha: 0.14 });
        const tri = (dir: number, r: number) => {
            const pts: number[] = [];
            for (let i = 0; i < 3; i++) {
                const a = (i / 3) * TAU + (dir > 0 ? -Math.PI / 2 : Math.PI / 2);
                pts.push(CX + Math.cos(a) * r, CY + Math.sin(a) * r);
            }
            g.poly(pts).stroke({ width: 1.5, color: p.gridHot, alpha: 0.18 });
        };
        tri(1, 175);
        tri(-1, 175);
        for (let i = 0; i < 48; i++) {
            const a = (i / 48) * TAU;
            const r0 = i % 4 ? 240 : 228;
            g.moveTo(CX + Math.cos(a) * r0, CY + Math.sin(a) * r0).lineTo(CX + Math.cos(a) * 250, CY + Math.sin(a) * 250).stroke({ width: 1.5, color: p.gridHot, alpha: 0.2 });
        }
        // Planetary sigils in the corners.
        for (const [x, y] of [[120, 100], [W - 120, 100], [120, H - 100], [W - 120, H - 100]] as const) {
            g.circle(x, y, 46).stroke({ width: 1.5, color: p.gridHot, alpha: 0.12 });
            g.circle(x, y, 8).stroke({ width: 1.5, color: p.gridHot, alpha: 0.18 });
            g.moveTo(x - 46, y).lineTo(x + 46, y).stroke({ width: 1, color: p.gridHot, alpha: 0.1 });
            g.moveTo(x, y - 46).lineTo(x, y + 46).stroke({ width: 1, color: p.gridHot, alpha: 0.1 });
        }
    },
    TIME_ECHO: (g, p, shadow) => {
        squareGrid(g, p.grid, 60, 0.35);
        const gears: [number, number, number, number][] = shadow
            ? [[230, 170, 120, 16], [395, 300, 70, 10], [CX + 260, CY + 90, 150, 20], [W - 140, 120, 80, 12], [180, H - 90, 90, 12]]
            : [[CX, CY, 170, 24], [CX + 300, CY - 120, 95, 14], [CX - 290, CY + 140, 110, 16], [140, 110, 70, 10], [W - 150, H - 110, 85, 12]];
        for (const [x, y, r, t] of gears) gear(g, x, y, r, t, p.gridHot, 0.16);
        // Clock dial around the centre: 60 ticks, 12 strong.
        for (let i = 0; i < 60; i++) {
            const a = (i / 60) * TAU;
            const r0 = i % 5 ? 262 : 246;
            g.moveTo(CX + Math.cos(a) * r0, CY + Math.sin(a) * r0).lineTo(CX + Math.cos(a) * 272, CY + Math.sin(a) * 272).stroke({ width: i % 5 ? 1 : 3, color: p.gridHot, alpha: 0.22 });
        }
    },
    SHADOW_LENS: (g, p, shadow) => {
        for (let x = 20; x < W; x += 40) for (let y = 20; y < H; y += 40) g.circle(x, y, 1.2).fill({ color: p.gridHot, alpha: 0.35 });
        const rnd = seeded(shadow ? 4242 : 2424);
        // Noir rain.
        for (let i = 0; i < 160; i++) {
            const x = rnd() * (W + 200) - 100;
            const y = rnd() * H;
            const l = 20 + rnd() * 50;
            g.moveTo(x, y).lineTo(x + l * 0.25, y + l).stroke({ width: 1, color: p.gridHot, alpha: 0.08 + rnd() * 0.08 });
        }
        for (let i = 0; i < 6; i++) g.circle(rnd() * W, rnd() * H, 80 + rnd() * 120).fill({ color: p.grid, alpha: 0.25 });
        if (shadow) stars(g, p, 60, 777);
    },
};

export function makeArenaBaker(renderer: Renderer) {
    const cache = new Map<string, Texture>();
    return (theme: Theme, realm: Realm): Texture => {
        const key = `${theme}:${realm}`;
        let tex = cache.get(key);
        if (!tex) {
            const c = new Container();
            const g = new Graphics();
            MOTIFS[theme](g, SKINS[theme][realm], realm === Realm.SHADOW_ALCHEMY);
            c.addChild(g);
            tex = renderer.generateTexture({ target: c, frame: new Rectangle(0, 0, W, H), resolution: 1, antialias: true });
            c.destroy({ children: true });
            cache.set(key, tex);
        }
        return tex;
    };
}

export type ArenaBaker = ReturnType<typeof makeArenaBaker>;
