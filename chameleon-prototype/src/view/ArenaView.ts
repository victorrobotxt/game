import { Container, Graphics, Sprite } from 'pixi.js';
import { ARENA_H, ARENA_W, COIN_LIFE, LENS_RANGE, MISTIME_LOCK, MAX_COINS, MAX_ECHOES, MAX_ENEMIES, MAX_POWERUPS, type World } from '../engine/World';
import { PowerUpKind, Realm, Theme, type Theme as ThemeT } from '../engine/types';
import { ELEMENT_COLORS, SKINS, lerpColor, mixPalette, type RealmPalette } from './Palette';
import type { ArenaBaker } from './ArenaMotifs';
import type { Textures } from './TextureFactory';

const MAX_RINGS = 12;
const MAX_FLASHES = 24;
/** Enemy position history length (frames); trail dots sit at 5, 10 and 15 frames back. */
const HIST = 16;
const CAPE_SEGS = 4;

/** Beveled alchemical barrier, drawn in greys so a tint can colour it per skin. */
function drawWall(g: Graphics, w: number, h: number) {
    g.roundRect(0, 0, w, h, 4).fill(0xa8a8a8);
    const horiz = w >= h;
    // bevel: light top/left, dark bottom/right
    g.rect(2, 2, w - 4, 3).fill({ color: 0xffffff, alpha: 0.55 });
    g.rect(2, 2, 3, h - 4).fill({ color: 0xffffff, alpha: 0.4 });
    g.rect(2, h - 5, w - 4, 3).fill({ color: 0x000000, alpha: 0.45 });
    g.rect(w - 5, 2, 3, h - 4).fill({ color: 0x000000, alpha: 0.35 });
    g.roundRect(5, 5, w - 10, h - 10, 2).stroke({ width: 1.2, color: 0x000000, alpha: 0.45 }); // inset border
    // stone courses along the long axis
    const len = horiz ? w : h;
    for (let k = 30; k < len - 20; k += 30) {
        if (horiz) g.moveTo(k, 5).lineTo(k, h - 5).stroke({ width: 1, color: 0x000000, alpha: 0.25 });
        else g.moveTo(5, k).lineTo(w - 5, k).stroke({ width: 1, color: 0x000000, alpha: 0.25 });
    }
    for (const [x, y] of [[6, 6], [w - 6, 6], [6, h - 6], [w - 6, h - 6]]) {
        g.circle(x, y, 2.2).fill(0xffffff);
        g.circle(x, y, 2.2).stroke({ width: 0.8, color: 0x000000, alpha: 0.5 });
    }
    g.roundRect(0, 0, w, h, 4).stroke({ width: 2, color: 0xffffff, alpha: 0.8 });
}

function drawWallCore(g: Graphics, w: number, h: number) {
    const horiz = w >= h;
    if (horiz) g.moveTo(10, h / 2).lineTo(w - 10, h / 2);
    else g.moveTo(w / 2, 10).lineTo(w / 2, h - 10);
    g.stroke({ width: 2, color: 0xffffff });
    const len = horiz ? w : h;
    for (let k = 20; k < len - 10; k += 40) {
        const x = horiz ? k : w / 2;
        const y = horiz ? h / 2 : k;
        g.poly([x, y - 4, x + 4, y, x, y + 4, x - 4, y]).fill(0xffffff); // rune nodes on the core
    }
}

/** Phased-out barrier: dashed outline + diagonal scanlines (you can walk through it). */
function drawWallGhost(g: Graphics, w: number, h: number) {
    const dash = (x0: number, y0: number, x1: number, y1: number) => {
        const len = Math.hypot(x1 - x0, y1 - y0);
        for (let d = 0; d < len; d += 9) {
            const a = d / len;
            const b = Math.min(1, (d + 5) / len);
            g.moveTo(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a).lineTo(x0 + (x1 - x0) * b, y0 + (y1 - y0) * b);
        }
    };
    dash(0, 0, w, 0);
    dash(w, 0, w, h);
    dash(w, h, 0, h);
    dash(0, h, 0, 0);
    g.stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
    // 45° scanlines clipped to the rect: x - y = k
    for (let k = -h; k < w; k += 8) {
        const xa = Math.max(0, k);
        const xb = Math.min(w, k + h);
        if (xb <= xa) continue;
        g.moveTo(xa, xa - k).lineTo(xb, xb - k);
    }
    g.stroke({ width: 1, color: 0xffffff, alpha: 0.25 });
}

interface Ring {
    g: Graphics;
    x: number;
    y: number;
    radius: number;
    life: number;
    maxLife: number;
    color: number;
    width: number;
}

interface Flash {
    s: Sprite;
    intensity: number;
    life: number;
    maxLife: number;
    size: number;
}

/**
 * Renders the World. Index-aligned sprite pools (enemy i <-> sprite i) so syncing is a flat loop.
 * Reads the engine; never writes to it.
 */
export class ArenaView extends Container {
    /** Everything in arena coordinates; this is what screen-shake moves. */
    readonly world = new Container();
    readonly fxLayer = new Container();
    private readonly tex: Textures;
    private readonly bg = new Graphics();
    /** [solar, shadow] floor for the current skin, and the previous skin while crossfading. */
    private readonly floorNow: [Sprite, Sprite];
    private readonly floorPrev: [Sprite, Sprite];
    private readonly bakeFloor: ArenaBaker;
    private skinNow: ThemeT = Theme.PARALLEL_SYNC;
    private skinPrev: ThemeT = Theme.PARALLEL_SYNC;
    /** 0 -> previous skin, 1 -> current skin. */
    private skinT = 1;
    private readonly solarPal: RealmPalette = { ...SKINS.PARALLEL_SYNC.SOLAR_ORDER };
    private readonly shadowPal: RealmPalette = { ...SKINS.PARALLEL_SYNC.SHADOW_ALCHEMY };
    private readonly beatRing = new Graphics();
    /** Per wall: beveled solid body (tinted), pulsing energy core, and a dashed "phased" ghost. */
    private readonly walls: { solid: Graphics; core: Graphics; ghost: Graphics }[] = [];
    private readonly runeSprites: Sprite[] = [];
    private readonly runeGlows: Sprite[] = [];
    /** Tightening warning ring round a rune an enemy of the other realm is about to cross. */
    private readonly lureGfx = new Graphics();
    /** Circle wipe that reveals the new realm from the player outwards. */
    private readonly wipe = new Container();
    private readonly wipeBg = new Graphics();
    private readonly wipeFloor = new Sprite();
    private readonly wipeMask = new Graphics();
    private readonly wipeEdge = new Graphics();
    private shownRealm: Realm = Realm.SOLAR_ORDER;
    private wipeTo: Realm = Realm.SOLAR_ORDER;
    private wipeT = 1;
    private wipeX = 0;
    private wipeY = 0;
    /** Reduced-flash mode: additive flashes are scaled by this. */
    flashScale = 1;
    /** First-wave tutorial: make the lure warnings louder. */
    teach = false;
    /** 0..1 per rune: how close an enemy of the other realm is to crossing it (read by the HUD coach). */
    readonly runeDanger: number[] = [];
    private readonly plates: Sprite[] = [];
    private readonly flasks: Sprite[] = [];
    private readonly flaskGlows: Sprite[] = [];
    private readonly coinSprites: Sprite[] = [];
    private readonly powerSprites: Sprite[] = [];
    private readonly powerGlows: Sprite[] = [];
    private readonly enemySprites: Sprite[] = [];
    private readonly enemyGlows: Sprite[] = [];
    /** 3-dot motion trail per enemy, sampled from a short position history. */
    private readonly enemyTrails: Sprite[][] = [];
    private readonly enemyHist = new Float32Array(MAX_ENEMIES * HIST * 2);
    private readonly enemyHistId = new Int32Array(MAX_ENEMIES);
    private histHead = 0;
    private readonly cape: Sprite[] = [];
    private readonly capePts: { x: number; y: number }[] = [];
    private readonly orb: Sprite;
    private readonly orbGlow: Sprite;
    private readonly echoSprites: Container[] = [];
    private readonly echoCloaks: Sprite[] = [];
    private readonly frog: Sprite;
    private readonly frogShadow: Sprite;
    private readonly player = new Container();
    private readonly playerAura: Sprite;
    private readonly playerCloak: Sprite;
    private readonly playerBody: Sprite;
    private readonly playerCrown: Sprite;
    private readonly shieldRing = new Graphics();
    private readonly lensLight: Sprite;
    private readonly lensDark = new Graphics();
    private readonly lensPts: number[] = [];
    private readonly echoTrails: Sprite[][] = [];
    private readonly echoGlows: Sprite[] = [];
    private readonly rings: Ring[] = [];
    private readonly flashes: Flash[] = [];
    private readonly border = new Graphics();
    readonly pal: RealmPalette = { ...SKINS.PARALLEL_SYNC.SOLAR_ORDER };
    /** 0 = solar, 1 = shadow; eased towards the player's realm. */
    realmT = 0;
    private time = 0;

    constructor(tex: Textures, world: World, bakeFloor: ArenaBaker) {
        super();
        this.tex = tex;
        this.bakeFloor = bakeFloor;
        this.addChild(this.world);
        const w = this.world;

        this.bg.rect(-400, -400, ARENA_W + 800, ARENA_H + 800).fill(0xffffff);
        const floor = (realm: Realm) => new Sprite(bakeFloor(world.theme, realm));
        this.floorPrev = [floor(Realm.SOLAR_ORDER), floor(Realm.SHADOW_ALCHEMY)];
        this.floorNow = [floor(Realm.SOLAR_ORDER), floor(Realm.SHADOW_ALCHEMY)];
        this.skinNow = this.skinPrev = world.theme;
        this.wipeBg.rect(-400, -400, ARENA_W + 800, ARENA_H + 800).fill(0xffffff);
        this.wipe.addChild(this.wipeBg, this.wipeFloor);
        this.wipe.mask = this.wipeMask;
        this.wipe.visible = this.wipeEdge.visible = false;
        w.addChild(this.bg, ...this.floorPrev, ...this.floorNow, this.wipe, this.wipeMask, this.wipeEdge, this.border, this.lureGfx);

        for (const h of world.hazards) {
            const glow = new Sprite(tex.glow);
            glow.anchor.set(0.5);
            glow.blendMode = 'add';
            glow.position.set(h.x, h.y);
            const s = new Sprite(h.realm === Realm.SOLAR_ORDER ? tex.rune : tex.runeShadow);
            s.anchor.set(0.5);
            s.position.set(h.x, h.y);
            s.scale.set((h.r * 2) / 120);
            this.runeGlows.push(glow);
            this.runeSprites.push(s);
            this.runeDanger.push(0);
            w.addChild(glow, s);
        }
        for (const sw of world.switches) {
            const s = new Sprite(tex.plate);
            s.anchor.set(0.5);
            s.position.set(sw.x, sw.y);
            this.plates.push(s);
            w.addChild(s);
        }
        for (const wall of world.walls) {
            const solid = new Graphics();
            const core = new Graphics();
            const ghost = new Graphics();
            drawWall(solid, wall.w, wall.h);
            drawWallCore(core, wall.w, wall.h);
            drawWallGhost(ghost, wall.w, wall.h);
            core.blendMode = 'add';
            for (const g of [ghost, solid, core]) {
                g.position.set(wall.x, wall.y);
                w.addChild(g);
            }
            this.walls.push({ solid, core, ghost });
        }
        for (const c of world.catalysts) {
            const glow = new Sprite(tex.glow);
            glow.anchor.set(0.5);
            glow.blendMode = 'add';
            glow.tint = ELEMENT_COLORS[c.element];
            glow.scale.set(1.6);
            const s = new Sprite(tex.flask);
            s.anchor.set(0.5);
            s.tint = ELEMENT_COLORS[c.element];
            this.flaskGlows.push(glow);
            this.flasks.push(s);
            w.addChild(glow, s);
        }
        for (let i = 0; i < MAX_COINS; i++) {
            const s = new Sprite(tex.coin);
            s.anchor.set(0.5);
            s.visible = false;
            this.coinSprites.push(s);
            w.addChild(s);
        }
        for (let i = 0; i < MAX_POWERUPS; i++) {
            const glow = new Sprite(tex.glow);
            glow.anchor.set(0.5);
            glow.blendMode = 'add';
            glow.scale.set(2.2);
            glow.visible = false;
            const s = new Sprite(tex.crown);
            s.anchor.set(0.5);
            s.visible = false;
            this.powerGlows.push(glow);
            this.powerSprites.push(s);
            w.addChild(glow, s);
        }
        for (let i = 0; i < MAX_ECHOES; i++) {
            const glow = new Sprite(tex.glow);
            glow.anchor.set(0.5);
            glow.blendMode = 'add';
            glow.scale.set(2.2);
            glow.visible = false;
            w.addChild(glow);
            this.echoGlows.push(glow);
            const trail: Sprite[] = [];
            for (let k = 0; k < 4; k++) {
                const ts = new Sprite(tex.playerCloak);
                ts.anchor.set(0.45, 0.5);
                ts.blendMode = 'add';
                ts.visible = false;
                trail.push(ts);
                w.addChild(ts);
            }
            this.echoTrails.push(trail);
            // v8: only Containers may have children, so the ghost is cloak + body in a Container.
            const s = new Container();
            const cloak = new Sprite(tex.playerCloak);
            cloak.anchor.set(0.45, 0.5);
            const body = new Sprite(tex.playerBody);
            body.anchor.set(36 / 70, 0.5);
            body.alpha = 0.7;
            body.tint = 0xbfefff;
            s.addChild(cloak, body);
            s.visible = false;
            this.echoCloaks.push(cloak);
            this.echoSprites.push(s);
            w.addChild(s);
        }
        for (let i = 0; i < MAX_ENEMIES; i++) {
            const trail: Sprite[] = [];
            for (let k = 0; k < 3; k++) {
                const d = new Sprite(tex.glow);
                d.anchor.set(0.5);
                d.blendMode = 'add';
                d.visible = false;
                trail.push(d);
                w.addChild(d);
            }
            this.enemyTrails.push(trail);
            const glow = new Sprite(tex.glow);
            glow.anchor.set(0.5);
            glow.blendMode = 'add';
            glow.visible = false;
            const s = new Sprite(tex.enemySolar);
            s.anchor.set(0.5);
            s.visible = false;
            this.enemyGlows.push(glow);
            this.enemySprites.push(s);
            w.addChild(glow, s);
        }

        this.frogShadow = new Sprite(tex.glow);
        this.frogShadow.anchor.set(0.5);
        this.frogShadow.tint = 0x000000;
        this.frogShadow.scale.set(0.8, 0.35);
        this.frog = new Sprite(tex.frog);
        this.frog.anchor.set(0.5, 0.8);
        this.frog.visible = this.frogShadow.visible = false;
        w.addChild(this.frogShadow, this.frog);

        for (let k = 0; k < CAPE_SEGS; k++) {
            const seg = new Sprite(tex.capeSeg);
            seg.anchor.set(0.5);
            this.cape.push(seg);
            this.capePts.push({ x: world.player.x, y: world.player.y });
        }
        w.addChild(...[...this.cape].reverse());
        this.orbGlow = new Sprite(tex.glow);
        this.orbGlow.anchor.set(0.5);
        this.orbGlow.blendMode = 'add';
        this.orb = new Sprite(tex.orb);
        this.orb.anchor.set(0.5);
        this.orb.scale.set(0.7);
        this.playerAura = new Sprite(tex.glow);
        this.playerAura.anchor.set(0.5);
        this.playerAura.blendMode = 'add';
        this.playerAura.scale.set(2.4);
        this.playerCloak = new Sprite(tex.playerCloak);
        this.playerCloak.anchor.set(0.45, 0.5);
        this.playerBody = new Sprite(tex.playerBody);
        this.playerBody.anchor.set(36 / 70, 0.5);
        this.playerCrown = new Sprite(tex.crown);
        this.playerCrown.anchor.set(0.5, 1.1);
        this.playerCrown.scale.set(0.6);
        this.player.addChild(this.playerAura, this.beatRing, this.shieldRing, this.playerCloak, this.playerBody);
        w.addChild(this.player, this.orbGlow, this.orb, this.playerCrown);

        this.lensDark.visible = false;
        this.lensLight = new Sprite(tex.lens);
        this.lensLight.anchor.set(0, 0.5);
        this.lensLight.blendMode = 'add';
        this.lensLight.visible = false;
        w.addChild(this.lensDark, this.lensLight);

        for (let i = 0; i < MAX_FLASHES; i++) {
            const s = new Sprite(tex.glow);
            s.anchor.set(0.5);
            s.blendMode = 'add';
            s.visible = false;
            this.flashes.push({ s, life: 0, maxLife: 1, size: 1, intensity: 1 });
            this.fxLayer.addChild(s);
        }
        for (let i = 0; i < MAX_RINGS; i++) {
            const g = new Graphics();
            g.visible = false;
            this.rings.push({ g, x: 0, y: 0, radius: 0, life: 0, maxLife: 1, color: 0xffffff, width: 4 });
            this.fxLayer.addChild(g);
        }
        w.addChild(this.fxLayer);
    }

    /** Theme preset changed: crossfade floor art and palettes to the new skin. */
    setSkin(theme: ThemeT) {
        if (theme === this.skinNow) return;
        this.skinPrev = this.skinNow;
        this.skinNow = theme;
        this.skinT = 0;
        for (let i = 0; i < 2; i++) this.floorPrev[i].texture = this.floorNow[i].texture;
        this.floorNow[0].texture = this.bakeFloor(theme, Realm.SOLAR_ORDER);
        this.floorNow[1].texture = this.bakeFloor(theme, Realm.SHADOW_ALCHEMY);
    }

    /** The current (possibly mid-crossfade) palette of one realm. */
    palOf(realm: Realm): RealmPalette {
        return realm === Realm.SOLAR_ORDER ? this.solarPal : this.shadowPal;
    }

    shockwave(x: number, y: number, radius: number, color: number, life = 0.5, width = 6) {
        const r = this.rings.find((rg) => rg.life <= 0) ?? this.rings[0];
        Object.assign(r, { x, y, radius, life, maxLife: life, color, width });
        r.g.visible = true;
    }

    flash(x: number, y: number, size: number, color: number, life = 0.35, intensity = 1) {
        const f = this.flashes.find((fl) => fl.life <= 0) ?? this.flashes[0];
        f.life = f.maxLife = life;
        f.intensity = intensity * this.flashScale;
        f.size = size;
        f.s.position.set(x, y);
        f.s.tint = color;
        f.s.visible = true;
    }

    /**
     * Rhythm feedback where the eye already is: an approach ring closes onto the alchemist and
     * flashes inside the PERFECT window; an arc shows the shift cooldown; pips show the combo.
     */
    private drawBeatRing(world: World, pal: RealmPalette) {
        const g = this.beatRing;
        g.clear();
        const p = world.player;
        if (!p.alive) return;
        const phase = world.clock.phase;
        const win = world.clock.windowPhase;
        const lens = world.theme === Theme.SHADOW_LENS;
        const dim = lens ? 0.45 : 1;
        const inWindow = phase < win || phase > 1 - win;
        if (inWindow) {
            g.circle(0, 0, 30).stroke({ width: 5, color: pal.accent, alpha: 0.9 * dim });
            g.circle(0, 0, 30).stroke({ width: 2, color: 0xffffff, alpha: 0.9 * dim });
        } else {
            const r = 30 + 46 * (1 - phase);
            g.circle(0, 0, r).stroke({ width: 2 + phase * 2, color: pal.accent, alpha: (0.15 + phase * 0.55) * dim });
            g.circle(0, 0, 30).stroke({ width: 1, color: pal.accent, alpha: 0.25 * dim });
        }
        const locked = !lens && p.shiftCd > world.stats.shiftCooldown + 0.01; // MISTIMED lockout
        const cd = lens ? world.lensFlareCd / (world.stats.shiftCooldown * 1.5) : locked ? p.shiftCd / MISTIME_LOCK : p.shiftCd / world.stats.shiftCooldown;
        if (cd > 0) {
            const start = -Math.PI / 2;
            if (locked) g.circle(0, 0, 36).stroke({ width: 3, color: 0xff3048, alpha: 0.25 });
            g.arc(0, 0, 36, start, start + Math.PI * 2 * (1 - cd)).stroke({ width: locked ? 4 : 3, color: locked ? 0xff3048 : 0xffffff, alpha: locked ? 0.9 : 0.55 });
        }
        const pips = Math.min(world.combo, 8);
        for (let i = 0; i < pips; i++) {
            const a = Math.PI / 2 + (i - (pips - 1) / 2) * 0.22;
            g.circle(Math.cos(a) * 44, Math.sin(a) * 44, 3).fill({ color: i >= 5 ? 0xffffff : pal.accent });
        }
    }

    update(world: World, dt: number) {
        this.time += dt;
        const t = this.time;
        const p = world.player;
        const lens = world.theme === Theme.SHADOW_LENS;
        const target = p.realm === Realm.SHADOW_ALCHEMY ? 1 : 0;
        this.realmT += (target - this.realmT) * (1 - Math.exp(-dt * 9));
        const rt = this.realmT;
        this.skinT = Math.min(1, this.skinT + dt / 0.6);
        const st = this.skinT * this.skinT * (3 - 2 * this.skinT);
        mixPalette(SKINS[this.skinPrev].SOLAR_ORDER, SKINS[this.skinNow].SOLAR_ORDER, st, this.solarPal);
        mixPalette(SKINS[this.skinPrev].SHADOW_ALCHEMY, SKINS[this.skinNow].SHADOW_ALCHEMY, st, this.shadowPal);
        const pal = mixPalette(this.solarPal, this.shadowPal, rt, this.pal);
        const beat = 1 - world.beatPhase; // 1 on the beat, decays to 0
        const pulse = beat * beat;

        // Realm shift: the new realm's floor grows as a circle from the alchemist instead of a crossfade.
        if (p.realm !== this.wipeTo) {
            if (this.wipeT < 1) this.shownRealm = this.wipeTo; // a shift mid-wipe: finish the old one instantly
            this.wipeTo = p.realm;
            this.wipeT = 0;
            this.wipeX = p.x;
            this.wipeY = p.y;
        }
        if (this.wipeT < 1) {
            this.wipeT = Math.min(1, this.wipeT + dt / 0.42);
            if (this.wipeT >= 1) this.shownRealm = this.wipeTo;
        }
        const wiping = this.wipeT < 1;
        const sr = this.shownRealm === Realm.SHADOW_ALCHEMY ? 1 : 0;
        this.bg.tint = this.palOf(this.shownRealm).bg;
        const glowFloor = 0.85 + pulse * 0.15;
        this.floorNow[0].alpha = (1 - sr) * glowFloor * st;
        this.floorNow[1].alpha = sr * glowFloor * st;
        this.floorPrev[0].alpha = (1 - sr) * glowFloor * (1 - st);
        this.floorPrev[1].alpha = sr * glowFloor * (1 - st);
        this.wipe.visible = this.wipeEdge.visible = wiping;
        this.wipeMask.clear();
        this.wipeEdge.clear();
        if (wiping) {
            const k = this.wipeT;
            const e = 1 - Math.pow(1 - k, 3);
            const far = Math.max(
                Math.hypot(this.wipeX, this.wipeY), Math.hypot(ARENA_W - this.wipeX, this.wipeY),
                Math.hypot(this.wipeX, ARENA_H - this.wipeY), Math.hypot(ARENA_W - this.wipeX, ARENA_H - this.wipeY),
            ) + 40;
            const r = Math.max(1, far * e);
            const to = this.palOf(this.wipeTo);
            this.wipeBg.tint = to.bg;
            this.wipeFloor.texture = this.floorNow[this.wipeTo === Realm.SHADOW_ALCHEMY ? 1 : 0].texture;
            this.wipeFloor.alpha = glowFloor;
            this.wipeMask.circle(this.wipeX, this.wipeY, r).fill(0xffffff);
            this.wipeEdge.circle(this.wipeX, this.wipeY, r).stroke({ width: 10 * (1 - k) + 2, color: to.accent, alpha: (1 - k) * 0.9 });
            this.wipeEdge.circle(this.wipeX, this.wipeY, r - 6).stroke({ width: 2, color: 0xffffff, alpha: (1 - k) * 0.6 });
        }
        this.floorPrev[0].visible = this.floorPrev[1].visible = st < 1;
        this.border.clear();
        this.border.rect(0, 0, ARENA_W, ARENA_H).stroke({ width: 4, color: pal.wallEdge, alpha: 0.55 + pulse * 0.35 });
        this.border.rect(-8, -8, ARENA_W + 16, ARENA_H + 16).stroke({ width: 2, color: pal.accent, alpha: 0.18 });

        const inRealm = (r: Realm) => (r === Realm.SOLAR_ORDER ? 1 - rt : rt);

        world.walls.forEach((wall, i) => {
            const { solid: g, core, ghost } = this.walls[i];
            if (wall.realm === 'BOTH') {
                g.tint = lerpColor(0x8a7a6a, 0x5c5a7a, rt);
                g.alpha = 1;
                core.tint = pal.accent;
                core.alpha = 0.25 + pulse * 0.25;
                ghost.visible = false;
                return;
            }
            const own = this.palOf(wall.realm);
            const solid = inRealm(wall.realm);
            g.tint = own.wall;
            g.alpha = solid;
            g.visible = solid > 0.02;
            core.tint = own.wallEdge;
            core.alpha = solid * (0.45 + pulse * 0.45);
            core.visible = g.visible;
            ghost.tint = own.wallEdge;
            ghost.alpha = (1 - solid) * 0.6;
            ghost.visible = solid < 0.98;
        });

        const L = this.lureGfx;
        L.clear();
        world.hazards.forEach((h, i) => {
            const s = this.runeSprites[i];
            const glow = this.runeGlows[i];
            const own = this.palOf(h.realm);
            const solid = lens ? 1 : inRealm(h.realm);
            const visible = h.revealed ? 1 : 0;
            // How close is a foe of the OTHER realm to stepping in? (that is the transmute trick)
            let danger = 0;
            for (const e of world.enemies) {
                if (!e.active || e.realm === h.realm) continue;
                const d = Math.hypot(e.x - h.x, e.y - h.y) - h.r * 0.8;
                danger = Math.max(danger, 1 - Math.max(0, d) / 130);
            }
            danger *= visible;
            this.runeDanger[i] = danger;
            const blink = danger > 0 ? 0.5 + 0.5 * Math.sin(t * (10 + danger * 14)) : 0;
            s.rotation = t * (h.realm === Realm.SOLAR_ORDER ? 0.35 : -0.35) * (1 + danger * 3);
            // Recessed floor engraving at rest; it only flares when a foe of the other realm is close.
            s.tint = danger > 0.6 && blink > 0.5 ? 0xffffff : own.rune;
            s.alpha = visible * Math.max(0.35 * (0.45 + solid * 0.55), danger);
            s.scale.set(((h.r * 2) / 120) * (1 + danger * 0.12 * blink));
            glow.tint = danger > 0 ? lerpColor(own.rune, 0xffffff, danger * 0.5) : own.rune;
            glow.alpha = visible * Math.max(0.06 * solid, danger * (0.6 + 0.4 * blink));
            glow.scale.set(((h.r * 2.6) / 64) * (1 + danger * 0.4));
            if (danger > 0.05) {
                const loud = this.teach ? 1 : 0.6;
                const rr = h.r + 10 + (1 - danger) * 40;
                L.circle(h.x, h.y, rr).stroke({ width: 2 + danger * 3, color: 0xffffff, alpha: danger * loud });
                for (let k = 0; k < 4; k++) {
                    const a = (k / 4) * Math.PI * 2 + t * 2;
                    L.moveTo(h.x + Math.cos(a) * (rr + 4), h.y + Math.sin(a) * (rr + 4))
                        .lineTo(h.x + Math.cos(a) * (rr + 14), h.y + Math.sin(a) * (rr + 14))
                        .stroke({ width: 3, color: own.rune, alpha: danger * loud });
                }
            }
        });

        world.switches.forEach((sw, i) => {
            const s = this.plates[i];
            const active = world.theme === Theme.TIME_ECHO || world.theme === Theme.PARALLEL_SYNC;
            s.visible = active;
            s.tint = sw.held ? 0x7dff8a : pal.accent;
            s.alpha = sw.held ? 1 : 0.55;
            s.scale.set(sw.held ? 1.08 + pulse * 0.08 : 1);
        });

        const craft = world.theme === Theme.ALCHEMY_CRAFT;
        world.catalysts.forEach((c, i) => {
            const s = this.flasks[i];
            const glow = this.flaskGlows[i];
            const vis = craft && !c.collected;
            s.visible = glow.visible = vis;
            if (!vis) return;
            const solid = inRealm(c.realm);
            const bob = Math.sin(t * 3 + i) * 5;
            s.position.set(c.x, c.y + bob);
            glow.position.set(c.x, c.y + bob);
            s.alpha = 0.3 + solid * 0.7;
            glow.alpha = 0.2 + solid * 0.6;
            s.scale.set(0.9 + solid * 0.2);
        });

        world.coins.forEach((c, i) => {
            const s = this.coinSprites[i];
            s.visible = c.active;
            if (!c.active) return;
            s.position.set(c.x, c.y);
            s.scale.set(Math.abs(Math.cos(t * 6 + i)) * 0.8 + 0.2, 1);
            const left = COIN_LIFE - c.age;
            s.alpha = left > 2.5 ? 1 : left < 0.6 ? left / 0.6 : Math.sin(t * 26) > 0 ? 1 : 0.35;
        });

        world.powerups.forEach((u, i) => {
            const s = this.powerSprites[i];
            const glow = this.powerGlows[i];
            s.visible = glow.visible = u.active;
            if (!u.active) return;
            s.texture = u.kind === PowerUpKind.SHINING_CROWN ? this.tex.crown : u.kind === PowerUpKind.RED_SEVEN_BOMB ? this.tex.seven : this.tex.frog;
            const bob = Math.sin(t * 4 + i) * 4;
            s.position.set(u.x, u.y + bob);
            glow.position.set(u.x, u.y + bob);
            glow.tint = u.kind === PowerUpKind.SHINING_CROWN ? 0xffd34d : u.kind === PowerUpKind.RED_SEVEN_BOMB ? 0xff3048 : 0x5dff7a;
            glow.alpha = 0.55 + Math.sin(t * 6) * 0.2;
            const blink = u.age > 11 ? (Math.sin(t * 30) > 0 ? 1 : 0.3) : 1;
            s.alpha = blink;
        });

        this.histHead = (this.histHead + 1) % HIST;
        const warn = this.lureGfx; // lunge telegraphs share the overlay graphics
        world.enemies.forEach((e, i) => {
            const s = this.enemySprites[i];
            const glow = this.enemyGlows[i];
            const trail = this.enemyTrails[i];
            s.visible = glow.visible = e.active;
            const base = i * HIST * 2;
            if (!e.active) {
                for (const d of trail) d.visible = false;
                return;
            }
            if (this.enemyHistId[i] !== e.id) {
                this.enemyHistId[i] = e.id;
                for (let k = 0; k < HIST; k++) {
                    this.enemyHist[base + k * 2] = e.x;
                    this.enemyHist[base + k * 2 + 1] = e.y;
                }
            }
            this.enemyHist[base + this.histHead * 2] = e.x;
            this.enemyHist[base + this.histHead * 2 + 1] = e.y;
            const own = this.palOf(e.realm);
            s.texture = e.realm === Realm.SOLAR_ORDER ? this.tex.enemySolar : this.tex.enemyShadow;
            const solid = lens ? (e.revealed ? 1 : 0) : inRealm(e.realm);
            const hidden = lens && !e.revealed;
            const spawn = Math.min(1, e.spawnT * 3);
            const wob = 1 + Math.sin(t * 8 + i) * 0.04 * (1 - solid);
            const size = ((e.r * 2) / 52) * spawn * wob;
            s.position.set(e.x, e.y);
            // Squash on the beat, stretch towards the player between beats (BPM-synced wobble).
            s.scale.set(size * (1 - pulse * 0.1 + (1 - pulse) * 0.04), size * (1 + pulse * 0.12));
            s.rotation = Math.atan2(p.y - e.y, p.x - e.x); // eyes always on the alchemist
            if (e.windup > 0) {
                // Telegraph: shudder, swell, flash red, and a warning arrow at the alchemist.
                s.position.set(e.x + Math.sin(t * 90 + i) * 2.5, e.y + Math.cos(t * 83 + i) * 2.5);
                s.scale.set(size * 1.18);
                const ux = (p.x - e.x) / (Math.hypot(p.x - e.x, p.y - e.y) || 1);
                const uy = (p.y - e.y) / (Math.hypot(p.x - e.x, p.y - e.y) || 1);
                const r0 = e.r + 8;
                const tipX = e.x + ux * (r0 + 26);
                const tipY = e.y + uy * (r0 + 26);
                warn.moveTo(e.x + ux * r0, e.y + uy * r0).lineTo(tipX, tipY).stroke({ width: 4, color: 0xff3048, alpha: 0.9 });
                warn.poly([tipX + ux * 10, tipY + uy * 10, tipX - uy * 7, tipY + ux * 7, tipX + uy * 7, tipY - ux * 7]).fill({ color: 0xff3048, alpha: 0.9 });
            } else if (e.lunge > 0) s.scale.set(size * 1.3, size * 0.8); // streaking
            trail.forEach((d, k) => {
                const idx = (this.histHead - (k + 1) * 5 + HIST * 4) % HIST;
                d.visible = !hidden;
                d.position.set(this.enemyHist[base + idx * 2], this.enemyHist[base + idx * 2 + 1]);
                d.tint = own.enemy;
                d.alpha = (0.5 - k * 0.14) * (0.3 + solid * 0.7);
                d.scale.set(size * (0.42 - k * 0.1));
            });
            s.alpha = hidden ? 0.04 + Math.max(0, Math.sin(t * 5 + i)) * 0.05 : 0.22 + solid * 0.78;
            s.tint = e.windup > 0 && Math.sin(t * 50) > 0 ? 0xff6070 : e.flash > 0.5 || solid > 0.5 ? 0xffffff : 0x9a9aa8;
            glow.position.set(e.x, e.y);
            glow.tint = e.flash > 0 ? 0xffffff : own.enemy;
            glow.alpha = hidden ? 0 : (0.15 + solid * 0.5) * (e.brute ? 1.3 : 1) + e.flash * 0.6;
            glow.scale.set(size * 2.3);
        });

        world.echoes.forEach((echo, i) => {
            const s = this.echoSprites[i];
            const glow = this.echoGlows[i];
            const trail = this.echoTrails[i];
            s.visible = glow.visible = echo.active;
            for (const ts of trail) ts.visible = echo.active;
            if (!echo.active) return;
            const own = this.palOf(echo.realm);
            const fade = Math.min(1, (1 - echo.t / echo.len) * 4) * (0.35 + inRealm(echo.realm) * 0.65);
            const heading = (idx: number) => {
                const j = Math.max(0, Math.min(echo.len - 1, idx));
                const k = Math.min(echo.len - 1, j + 4);
                const dx = echo.path[k * 2] - echo.path[j * 2];
                const dy = echo.path[k * 2 + 1] - echo.path[j * 2 + 1];
                return dx * dx + dy * dy > 0.5 ? Math.atan2(dy, dx) : null;
            };
            const cur = Math.floor(echo.t);
            s.position.set(echo.x, echo.y);
            this.echoCloaks[i].tint = own.accent;
            s.alpha = (0.75 + 0.2 * Math.sin(t * 14 + i)) * fade;
            const h = heading(cur);
            if (h !== null) s.rotation = h;
            glow.position.set(echo.x, echo.y);
            glow.tint = own.accent;
            glow.alpha = 0.55 * fade;
            // Afterimages sampled from the recording itself: the ghost visibly "replays".
            trail.forEach((ts, k) => {
                const idx = Math.max(0, cur - (k + 1) * 7);
                ts.position.set(echo.path[idx * 2], echo.path[idx * 2 + 1]);
                ts.tint = own.accent;
                ts.alpha = fade * 0.4 * (1 - k / trail.length);
                ts.scale.set(1 - k * 0.08);
                const th = heading(idx);
                if (th !== null) ts.rotation = th;
            });
        });

        const f = world.frog;
        this.frog.visible = this.frogShadow.visible = f.active;
        if (f.active) {
            const h = Math.sin(Math.PI * f.hop) * 22;
            this.frog.position.set(f.x, f.y - h);
            this.frogShadow.position.set(f.x, f.y + 4);
            const squash = f.hop >= 1 ? 1 + Math.max(0, f.rest) * 2 : 1;
            this.frog.scale.set(0.9 * squash, (0.9 / squash) * (1 + h / 120));
            this.frog.alpha = f.life < 3 && Math.sin(t * 25) > 0 ? 0.4 : 1;
        }

        // Player
        this.player.position.set(p.x, p.y);
        // Cape: a 4-link chain hanging off the alchemist's back, flowing behind the movement vector.
        const back = { x: p.x - Math.cos(p.facing) * 12, y: p.y - Math.sin(p.facing) * 12 };
        const sway = Math.sin(t * 5) * 2;
        this.capePts.forEach((pt, k) => {
            const lead = k === 0 ? back : this.capePts[k - 1];
            const dx = pt.x - lead.x;
            const dy = pt.y - lead.y;
            const d = Math.hypot(dx, dy) || 1;
            const link = 9;
            // Always pull links back to `link` length; at rest they settle straight behind.
            const rx = d > 0.5 ? dx / d : -Math.cos(p.facing);
            const ry = d > 0.5 ? dy / d : -Math.sin(p.facing);
            pt.x = lead.x + rx * link - Math.cos(p.facing) * 0.6 + -Math.sin(p.facing) * sway * 0.2 * k;
            pt.y = lead.y + ry * link - Math.sin(p.facing) * 0.6 + Math.cos(p.facing) * sway * 0.2 * k;
            const seg = this.cape[k];
            seg.position.set(pt.x, pt.y);
            seg.rotation = Math.atan2(lead.y - pt.y, lead.x - pt.x);
            seg.scale.set(0.95 - k * 0.15, 0.85 - k * 0.14);
            seg.tint = lerpColor(pal.cloak, 0x000000, k * 0.12);
            seg.alpha = (1 - k * 0.15) * (p.alive ? 1 : 0);
        });
        const oa = world.clock.beats * Math.PI; // half an orbit per beat
        this.orb.position.set(p.x + Math.cos(oa) * 30, p.y + Math.sin(oa) * 30 * 0.8);
        this.orb.rotation = oa * 2;
        this.orb.tint = lerpColor(pal.accent, 0xffffff, 0.3);
        this.orbGlow.position.copyFrom(this.orb.position);
        this.orbGlow.tint = pal.accent;
        this.orbGlow.alpha = 0.5 + pulse * 0.4;
        this.orbGlow.scale.set(0.7 + pulse * 0.3);
        this.orb.visible = this.orbGlow.visible = p.alive;
        this.playerCloak.rotation = this.playerBody.rotation = p.facing;
        this.playerCloak.tint = pal.cloak;
        this.playerAura.tint = p.crown > 0 ? 0xffd34d : pal.accent;
        this.playerAura.alpha = 0.45 + pulse * 0.35 + (p.crown > 0 ? 0.3 : 0);
        this.playerAura.scale.set(2.2 + pulse * 0.5 + (p.crown > 0 ? 0.8 : 0));
        this.player.alpha = p.invuln > 0 && p.crown <= 0 ? (Math.sin(t * 40) > 0 ? 1 : 0.35) : 1;
        this.player.visible = p.alive;
        this.playerCrown.visible = p.crown > 0;
        this.playerCrown.position.set(p.x, p.y - 14 + Math.sin(t * 5) * 3);
        this.shieldRing.clear();
        if (p.shield >= 1) {
            this.shieldRing.circle(0, 0, 26 + Math.sin(t * 4) * 1.5).stroke({ width: 2, color: 0x9dfcff, alpha: 0.65 });
            this.shieldRing.circle(0, 0, 30).stroke({ width: 1, color: 0x9dfcff, alpha: 0.25 });
        }

        this.drawBeatRing(world, pal);

        // Shadow lens: dark veil with a cone cut out, plus the baked light cone on top.
        this.lensDark.visible = this.lensLight.visible = lens;
        if (lens) {
            const a = world.lensAngle;
            const half = 0.5;
            this.lensDark.clear();
            this.lensDark.rect(-40, -40, ARENA_W + 80, ARENA_H + 80).fill({ color: 0x02010a, alpha: 0.62 });
            // One simple hole polygon (cone + small circle round the player). Two overlapping
            // cut() holes break triangulation and leave a dark seam along the cone edge.
            const pts = this.lensPts;
            pts.length = 0;
            const steps = 20;
            for (let i = 0; i <= steps; i++) {
                const t = a + half + ((Math.PI * 2 - half * 2) * i) / steps;
                pts.push(p.x + Math.cos(t) * 34, p.y + Math.sin(t) * 34);
            }
            for (let i = 0; i <= steps; i++) {
                const t = a - half + (half * 2 * i) / steps;
                pts.push(p.x + Math.cos(t) * LENS_RANGE, p.y + Math.sin(t) * LENS_RANGE);
            }
            this.lensDark.poly(pts).cut();
            this.lensLight.position.set(p.x, p.y);
            this.lensLight.rotation = a;
            this.lensLight.tint = 0xb98cff;
            this.lensLight.alpha = 0.75 + pulse * 0.25;
        }

        for (const r of this.rings) {
            if (r.life <= 0) continue;
            r.life -= dt;
            if (r.life <= 0) {
                r.g.visible = false;
                continue;
            }
            const k = 1 - r.life / r.maxLife;
            const ease = 1 - Math.pow(1 - k, 3);
            r.g.clear();
            r.g.circle(r.x, r.y, r.radius * ease).stroke({ width: r.width * (1 - k) + 1, color: r.color, alpha: 1 - k });
            r.g.circle(r.x, r.y, r.radius * ease * 0.82).stroke({ width: 2, color: 0xffffff, alpha: (1 - k) * 0.5 });
        }
        for (const fl of this.flashes) {
            if (fl.life <= 0) continue;
            fl.life -= dt;
            if (fl.life <= 0) {
                fl.s.visible = false;
                continue;
            }
            const k = fl.life / fl.maxLife;
            fl.s.alpha = k * fl.intensity;
            fl.s.scale.set((fl.size / 32) * (1.2 - k * 0.4));
        }
    }
}
