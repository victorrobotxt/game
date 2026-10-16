import { Graphics } from 'pixi.js';

/**
 * Portrait screens leave tall empty bands above and below the 2:1 arena. Fill them with a faint
 * alchemical blueprint (concentric rings, ticks, constellation lines) so the void reads as
 * part of the world. Drawn in white; main.ts tints it with the realm accent every frame.
 */
export function drawBackdrop(g: Graphics, w: number, h: number, arena: { x: number; y: number; w: number; h: number }, top: number, bottom: number) {
    g.clear();
    if (w / h >= 0.85) return;
    const bands = [
        { y0: top, y1: arena.y - 6 },
        { y0: arena.y + arena.h + 6, y1: h - bottom },
    ];
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const [bi, b] of bands.entries()) {
        const bh = b.y1 - b.y0;
        if (bh < 40) continue;
        const cx = w / 2;
        // Half-rings rise out of the arena edge, away from the play area (drawn above the arena layer).
        const up = bi === 0;
        const cy = up ? b.y1 : b.y0;
        const a0 = up ? Math.PI : 0;
        for (let r = 34; r < bh - 4; r += 22) {
            g.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r).arc(cx, cy, r, a0, a0 + Math.PI).stroke({ width: r % 66 === 34 ? 1.5 : 1, color: 0xffffff, alpha: 0.09 });
        }
        for (let i = 1; i < 12; i++) {
            const a = a0 + (i / 12) * Math.PI;
            g.moveTo(cx + Math.cos(a) * 34, cy + Math.sin(a) * 34).lineTo(cx + Math.cos(a) * (bh - 4), cy + Math.sin(a) * (bh - 4)).stroke({ width: 1, color: 0xffffff, alpha: 0.05 });
        }
        // constellations
        const stars: [number, number][] = [];
        for (let i = 0; i < 14; i++) stars.push([16 + rnd() * (w - 32), b.y0 + 10 + rnd() * (bh - 20)]);
        for (let i = 0; i < stars.length; i++) {
            const [x, y] = stars[i];
            g.circle(x, y, 1.2 + rnd() * 1.4).fill({ color: 0xffffff, alpha: 0.35 });
            if (i % 3 !== 2 && i + 1 < stars.length) g.moveTo(x, y).lineTo(stars[i + 1][0], stars[i + 1][1]).stroke({ width: 1, color: 0xffffff, alpha: 0.12 });
        }
    }
}
