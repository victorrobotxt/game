import { Container, Graphics, Rectangle, Text, type Renderer, type Texture } from 'pixi.js';
import { LENS_HALF_ANGLE, LENS_RANGE } from '../engine/World';
import { SUITS, type Suit } from '../engine/types';
import { SUIT_INFO } from '../engine/Upgrades';
import { FONT, PALETTES, SUIT_COLORS } from './Palette';

/**
 * Every texture in the game is drawn here at startup with Graphics/Text and baked into a
 * RenderTexture. Zero external image files.
 */
export interface Textures {
    glow: Texture;
    spark: Texture;
    playerCloak: Texture;
    playerBody: Texture;
    capeSeg: Texture;
    orb: Texture;
    heartFull: Texture;
    heartEmpty: Texture;
    enemySolar: Texture;
    enemyShadow: Texture;
    /** Solar rune: a round seal with a hexagram. */
    rune: Texture;
    /** Shadow rune: a crescent in a diamond. Different silhouette, so colour is never the only cue. */
    runeShadow: Texture;
    coin: Texture;
    crown: Texture;
    seven: Texture;
    frog: Texture;
    flask: Texture;
    plate: Texture;
    lens: Texture;
    vignette: Texture;
    cardBack: Texture;
    cardFaces: Record<Suit, Texture>;
}

const TAU = Math.PI * 2;

export function bakeTextures(renderer: Renderer): Textures {
    const bake = (draw: (g: Graphics) => void, w: number, h = w, resolution = 2, extra?: (c: Container) => void): Texture => {
        const c = new Container();
        const g = new Graphics();
        draw(g);
        c.addChild(g);
        extra?.(c);
        const tex = renderer.generateTexture({ target: c, frame: new Rectangle(0, 0, w, h), resolution, antialias: true });
        c.destroy({ children: true });
        return tex;
    };

    const glow = bake((g) => {
        // Soft radial falloff from stacked translucent discs (quadratic-ish profile).
        for (let i = 32; i > 0; i--) g.circle(32, 32, i).fill({ color: 0xffffff, alpha: 0.035 + (1 - i / 32) * 0.05 });
    }, 64);

    const spark = bake((g) => {
        g.poly([16, 0, 19, 13, 32, 16, 19, 19, 16, 32, 13, 19, 0, 16, 13, 13]).fill(0xffffff);
        g.circle(16, 16, 4).fill(0xffffff);
    }, 32);

    // Alchemist, top-down, facing +x. Cloak is white (tinted per realm), body has fixed colours.
    const playerCloak = bake((g) => {
        g.poly([10, 10, 46, 20, 54, 32, 46, 44, 10, 54, 18, 32]).fill(0xffffff);
        g.poly([10, 10, 46, 20, 54, 32, 46, 44, 10, 54, 18, 32]).stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
        for (let i = 0; i < 3; i++) g.poly([12 + i * 4, 14 + i * 3, 22 + i * 4, 32, 12 + i * 4, 50 - i * 3]).stroke({ width: 1.5, color: 0x000000, alpha: 0.18 });
    }, 64);
    const playerBody = bake((g) => {
        // Pointed alchemist hat seen from above: wide brim, cone whose tip droops back (-x),
        // star on the crown, two glowing eyes peeking out under the front of the brim.
        g.circle(36, 32, 15).fill(0x1a1036);
        g.circle(36, 32, 15).stroke({ width: 2.5, color: 0xffe08a });
        g.poly([30, 22, 42, 28, 42, 36, 30, 42, 14, 36, 4, 26, 12, 28]).fill(0x2a1a56);
        g.poly([30, 22, 42, 28, 42, 36, 30, 42, 14, 36, 4, 26, 12, 28]).stroke({ width: 1.8, color: 0xffe08a, alpha: 0.9 });
        g.circle(4, 26, 2.6).fill(0xffe08a);
        g.star(35, 32, 5, 5, 2.2, 0).fill(0xfff3a0);
        g.circle(50, 27, 3.4).fill({ color: 0x9dfcff, alpha: 0.35 });
        g.circle(50, 37, 3.4).fill({ color: 0x9dfcff, alpha: 0.35 });
        g.circle(50, 27, 2).fill(0xeaffff);
        g.circle(50, 37, 2).fill(0xeaffff);
    }, 70, 64);

    /** One flowing cape segment (tinted per realm), trailed behind the alchemist. */
    const capeSeg = bake((g) => {
        g.ellipse(16, 16, 15, 11).fill(0xffffff);
        g.ellipse(13, 16, 9, 6).fill({ color: 0x000000, alpha: 0.15 });
    }, 32);

    /** The catalyst orb that orbits the alchemist on the beat. */
    const orb = bake((g) => {
        for (let i = 10; i > 0; i--) g.circle(16, 16, i + 5).fill({ color: 0xffffff, alpha: 0.05 });
        g.poly([16, 6, 23, 16, 16, 26, 9, 16]).fill(0xffffff);
        g.poly([16, 6, 23, 16, 16, 26, 9, 16]).stroke({ width: 1.5, color: 0xfff3a0 });
        g.circle(16, 16, 3).fill(0xfff3a0);
    }, 32);

    // Enemies face +x (the view rotates them to look at the player). Drawn big: 64 px canvas,
    // body radius ~26, so the sprite scale is (r * 2) / 52.
    // Solar: an armoured construct — riveted octagonal shell, crest fin behind, visor with two eyes.
    const enemySolar = bake((g) => {
        const c = 32;
        g.poly([6, 26, 2, 32, 6, 38, 14, 34, 14, 30]).fill(0xffb347); // crest fin (back)
        g.regularPoly(c, c, 24, 8, Math.PI / 8).fill(0x5a1e08);
        g.regularPoly(c, c, 24, 8, Math.PI / 8).stroke({ width: 3, color: 0xffd34d });
        g.regularPoly(c, c, 16, 8, Math.PI / 8).fill(0x8a2e0c);
        g.regularPoly(c, c, 16, 8, Math.PI / 8).stroke({ width: 1.5, color: 0xff8a3d });
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * TAU + Math.PI / 8;
            g.circle(c + Math.cos(a) * 20, c + Math.sin(a) * 20, 1.8).fill(0xffe08a);
        }
        g.roundRect(c + 4, c - 9, 14, 18, 4).fill(0x1a0602); // visor
        g.circle(c + 13, c - 4, 4).fill({ color: 0xffd34d, alpha: 0.45 });
        g.circle(c + 13, c + 4, 4).fill({ color: 0xffd34d, alpha: 0.45 });
        g.circle(c + 13, c - 4, 2.4).fill(0xfffbe0);
        g.circle(c + 13, c + 4, 2.4).fill(0xfffbe0);
    }, 64);
    // Shadow: a horned wraith — tattered cloak streaming back, two horns sweeping forward, cyan eyes.
    const enemyShadow = bake((g) => {
        const S = PALETTES.SHADOW_ALCHEMY;
        const body = [56, 32, 48, 18, 34, 12, 20, 14, 2, 8, 12, 22, 0, 32, 12, 42, 2, 56, 20, 50, 34, 52, 48, 46];
        g.poly(body).fill(0x1a0a4a);
        g.poly(body).stroke({ width: 2.5, color: S.enemy });
        g.poly([44, 20, 52, 6, 60, 4, 54, 12, 50, 22]).fill(0xd8c8ff); // horns
        g.poly([44, 44, 52, 58, 60, 60, 54, 52, 50, 42]).fill(0xd8c8ff);
        g.ellipse(40, 32, 11, 13).fill(0x07061a);
        g.circle(45, 27, 3.8).fill({ color: S.enemy, alpha: 0.5 });
        g.circle(45, 37, 3.8).fill({ color: S.enemy, alpha: 0.5 });
        g.circle(45, 27, 2.2).fill(0xeaffff);
        g.circle(45, 37, 2.2).fill(0xeaffff);
    }, 64);

    /** Vitality: an alchemical heart-flask (red liquid) and its empty, cracked twin. */
    const flaskShape = (g: Graphics) => {
        g.roundRect(9, 1, 6, 4, 1); // cork
        g.moveTo(10, 5).lineTo(14, 5).lineTo(14, 9).arc(12, 15, 8, -Math.PI / 2 + 0.55, Math.PI * 1.5 - 0.55).lineTo(10, 9).closePath();
    };
    const heartFull = bake((g) => {
        flaskShape(g);
        g.fill(0x3a1020);
        g.circle(12, 16, 6.5).fill(0xff4d6d);
        g.poly([8, 14, 12, 19, 16, 14, 14, 12, 12, 14, 10, 12]).fill(0xffd0dc); // heart glint
        flaskShape(g);
        g.stroke({ width: 1.5, color: 0xffd0dc });
        g.roundRect(9, 1, 6, 4, 1).fill(0xc89a6a);
    }, 24, 26, 3);
    const heartEmpty = bake((g) => {
        flaskShape(g);
        g.fill({ color: 0x1a0f24, alpha: 0.9 });
        flaskShape(g);
        g.stroke({ width: 1.5, color: 0x8a6070 });
        g.moveTo(8, 11).lineTo(12, 15).lineTo(10, 19).moveTo(12, 15).lineTo(16, 17).stroke({ width: 1.2, color: 0xffd0dc, alpha: 0.7 }); // crack
        g.roundRect(9, 1, 6, 4, 1).fill(0x6a5040);
    }, 24, 26, 3);

    const rune = bake((g) => {
        const c = 64;
        // Sun seal: round, ticked rim, hexagram. (Round = solar; the shadow seal is a diamond.)
        g.circle(c, c, 60).fill({ color: 0xffffff, alpha: 0.1 });
        g.circle(c, c, 60).stroke({ width: 3, color: 0xffffff });
        g.circle(c, c, 50).stroke({ width: 1.5, color: 0xffffff, alpha: 0.7 });
        for (let i = 0; i < 24; i++) {
            const a = (i / 24) * TAU;
            const r0 = i % 2 ? 51 : 53;
            g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0)
                .lineTo(c + Math.cos(a) * 58, c + Math.sin(a) * 58)
                .stroke({ width: 2, color: 0xffffff, alpha: 0.8 });
        }
        const tri = (rot: number) => {
            const pts: number[] = [];
            for (let i = 0; i < 3; i++) pts.push(c + Math.cos(rot + (i / 3) * TAU) * 44, c + Math.sin(rot + (i / 3) * TAU) * 44);
            g.poly(pts).stroke({ width: 2.5, color: 0xffffff });
        };
        tri(-Math.PI / 2);
        tri(Math.PI / 2);
        g.circle(c, c, 14).stroke({ width: 2, color: 0xffffff });
        g.circle(c, c, 5).fill(0xffffff);
    }, 128);

    const runeShadow = bake((g) => {
        const c = 64;
        // Moon seal: square-ish diamond body, spikes pointing IN, a crescent at the heart.
        const dia = (r: number) => [c, c - r, c + r, c, c, c + r, c - r, c];
        g.poly(dia(60)).fill({ color: 0xffffff, alpha: 0.12 });
        g.poly(dia(60)).stroke({ width: 3, color: 0xffffff });
        g.poly(dia(48)).stroke({ width: 1.5, color: 0xffffff, alpha: 0.7 });
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * TAU + Math.PI / 4;
            const x = c + Math.cos(a) * 30;
            const y = c + Math.sin(a) * 30;
            g.poly([x + Math.cos(a) * 12, y + Math.sin(a) * 12, x + Math.cos(a + 1.9) * 5, y + Math.sin(a + 1.9) * 5, x + Math.cos(a - 1.9) * 5, y + Math.sin(a - 1.9) * 5])
                .fill({ color: 0xffffff, alpha: 0.85 });
        }
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * TAU;
            g.circle(c + Math.cos(a) * 40, c + Math.sin(a) * 40, 2.2).fill(0xffffff);
        }
        g.circle(c, c, 18).fill(0xffffff);
        g.circle(c + 8, c - 5, 15).cut();
    }, 128);

    const coin = bake((g) => {
        g.circle(16, 16, 15).fill(0xb8860b);
        g.circle(16, 16, 13).fill(0xffd34d);
        g.circle(16, 16, 10).stroke({ width: 1.5, color: 0xb8860b });
        g.star(16, 16, 5, 7, 3, -Math.PI / 2).fill(0xfff3b0);
        g.circle(11, 10, 3).fill({ color: 0xffffff, alpha: 0.7 });
    }, 32);

    const crown = bake((g) => {
        g.poly([8, 44, 4, 16, 18, 30, 28, 8, 38, 30, 52, 16, 48, 44]).fill(0xffd34d);
        g.poly([8, 44, 4, 16, 18, 30, 28, 8, 38, 30, 52, 16, 48, 44]).stroke({ width: 2.5, color: 0xfff6c8 });
        g.rect(8, 44, 40, 6).fill(0xc8961e);
        for (const [x, col] of [[16, 0xff3048], [28, 0x3ec8ff], [40, 0x5dff7a]] as const) g.circle(x, 47, 2.6).fill(col);
        g.circle(4, 16, 3).fill(0xfff6c8);
        g.circle(28, 8, 3.5).fill(0xfff6c8);
        g.circle(52, 16, 3).fill(0xfff6c8);
    }, 56);

    const seven = bake(
        (g) => {
            g.circle(28, 28, 26).fill(0x3a0410);
            g.circle(28, 28, 26).stroke({ width: 3, color: 0xffd34d });
            g.moveTo(40, 10).lineTo(46, 4).stroke({ width: 3, color: 0xffd34d }); // fuse
            g.circle(47, 3, 3).fill(0xffffff);
        },
        56,
        56,
        2,
        (c) => {
            const t = new Text({ text: '7', style: { fontFamily: FONT, fontSize: 38, fontWeight: 'bold', fill: 0xff3048, stroke: { color: 0xfff6c8, width: 3 } } });
            t.anchor.set(0.5);
            t.position.set(28, 30);
            c.addChild(t);
        },
    );

    const frog = bake((g) => {
        g.ellipse(24, 28, 17, 14).fill(0x2fbf4a); // body
        g.ellipse(24, 32, 11, 8).fill(0x9dffb0); // belly
        g.circle(14, 14, 7).fill(0x2fbf4a);
        g.circle(34, 14, 7).fill(0x2fbf4a);
        g.circle(14, 14, 4).fill(0xffffff);
        g.circle(34, 14, 4).fill(0xffffff);
        g.circle(15, 14, 2).fill(0x101010);
        g.circle(33, 14, 2).fill(0x101010);
        g.moveTo(17, 24).quadraticCurveTo(24, 29, 31, 24).stroke({ width: 2, color: 0x0e5a1e });
        g.ellipse(7, 38, 6, 3).fill(0x1f9a38);
        g.ellipse(41, 38, 6, 3).fill(0x1f9a38);
        g.poly([18, 6, 24, 0, 30, 6, 24, 4]).fill(0xffd34d); // tiny crown, it's a prince after all
    }, 48);

    const flask = bake((g) => {
        g.rect(20, 4, 8, 14).fill(0xffffff);
        g.poly([20, 18, 28, 18, 42, 40, 36, 46, 12, 46, 6, 40]).fill({ color: 0xffffff, alpha: 0.35 });
        g.poly([20, 18, 28, 18, 42, 40, 36, 46, 12, 46, 6, 40]).stroke({ width: 2.5, color: 0xffffff });
        g.poly([12, 32, 36, 32, 42, 40, 36, 46, 12, 46, 6, 40]).fill(0xffffff);
        g.circle(18, 38, 2).fill({ color: 0x000000, alpha: 0.3 });
        g.circle(28, 41, 1.5).fill({ color: 0x000000, alpha: 0.3 });
    }, 48);

    const plate = bake((g) => {
        g.circle(36, 36, 34).fill({ color: 0xffffff, alpha: 0.08 });
        g.circle(36, 36, 34).stroke({ width: 3, color: 0xffffff });
        g.roundRect(20, 20, 32, 32, 6).stroke({ width: 3, color: 0xffffff });
        g.circle(36, 36, 6).fill(0xffffff);
    }, 72);

    // Lens cone: apex at (0, h/2) pointing +x, brightest near the apex.
    const lensH = Math.ceil(Math.sin(LENS_HALF_ANGLE) * LENS_RANGE * 2) + 4;
    const lens = bake(
        (g) => {
            const cy = lensH / 2;
            for (let i = 0; i < 18; i++) {
                const r = LENS_RANGE * (1 - i / 18);
                const ha = LENS_HALF_ANGLE * (1 - i * 0.012);
                g.moveTo(0, cy)
                    .lineTo(Math.cos(-ha) * r, cy + Math.sin(-ha) * r)
                    .arc(0, cy, r, -ha, ha)
                    .lineTo(0, cy)
                    .fill({ color: 0xffffff, alpha: 0.055 });
            }
        },
        LENS_RANGE,
        lensH,
        1,
    );

    const vignette = bake(
        (g) => {
            for (let i = 0; i < 24; i++) {
                const inset = i * 6;
                g.rect(inset, inset, 512 - inset * 2, 512 - inset * 2).stroke({ width: 6, color: 0x000000, alpha: 0.06 * (1 - i / 24) });
            }
        },
        512,
        512,
        1,
    );

    const CW = 110;
    const CH = 150;
    const cardBack = bake((g) => {
        g.roundRect(2, 2, CW - 4, CH - 4, 12).fill(0x1a0b33);
        g.roundRect(2, 2, CW - 4, CH - 4, 12).stroke({ width: 3, color: 0xffd34d });
        g.roundRect(10, 10, CW - 20, CH - 20, 8).stroke({ width: 1.5, color: 0xffd34d, alpha: 0.6 });
        for (let y = 18; y < CH - 14; y += 14)
            for (let x = 18 + ((y / 14) % 2) * 7; x < CW - 14; x += 14) g.regularPoly(x, y, 4, 4, 0).fill({ color: 0x7b3cff, alpha: 0.55 });
        g.circle(CW / 2, CH / 2, 22).fill(0x1a0b33);
        g.circle(CW / 2, CH / 2, 22).stroke({ width: 2.5, color: 0xffd34d });
        g.star(CW / 2, CH / 2, 4, 15, 5, 0).fill(0xffd34d);
    }, CW, CH);

    const cardFaces = {} as Record<Suit, Texture>;
    for (const suit of SUITS) {
        const col = SUIT_COLORS[suit];
        cardFaces[suit] = bake(
            (g) => {
                g.roundRect(2, 2, CW - 4, CH - 4, 12).fill(0xfdf6e3);
                g.roundRect(2, 2, CW - 4, CH - 4, 12).stroke({ width: 4, color: col });
                g.roundRect(8, 8, CW - 16, CH - 16, 8).stroke({ width: 1.5, color: col, alpha: 0.5 });
                g.circle(CW / 2, CH / 2, 36).fill({ color: col, alpha: 0.16 });
            },
            CW,
            CH,
            2,
            (c) => {
                const big = new Text({ text: SUIT_INFO[suit].glyph, style: { fontFamily: FONT, fontSize: 64, fill: col, stroke: { color: 0x1a0b33, width: 3 } } });
                big.anchor.set(0.5);
                big.position.set(CW / 2, CH / 2 - 2);
                const corner = new Text({ text: SUIT_INFO[suit].glyph, style: { fontFamily: FONT, fontSize: 20, fill: col } });
                corner.position.set(10, 6);
                const corner2 = new Text({ text: SUIT_INFO[suit].glyph, style: { fontFamily: FONT, fontSize: 20, fill: col } });
                corner2.anchor.set(1, 1);
                corner2.position.set(CW - 10, CH - 6);
                // A classic card: centre emblem + two corner pips, no words.
                corner2.rotation = Math.PI;
                corner2.anchor.set(0, 0);
                c.addChild(big, corner, corner2);
            },
        );
    }

    return {
        glow, spark, playerCloak, playerBody, capeSeg, orb, heartFull, heartEmpty, enemySolar, enemyShadow, rune, runeShadow, coin, crown, seven, frog, flask, plate,
        lens, vignette, cardBack, cardFaces,
    };
}

export const CARD_W = 110;
export const CARD_H = 150;
