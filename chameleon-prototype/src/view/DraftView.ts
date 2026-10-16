import { Container, Graphics, Sprite, Text } from 'pixi.js';
import gsap from 'gsap';
import { SUITS, type Suit } from '../engine/types';
import { SUIT_INFO } from '../engine/Upgrades';
import { FONT, SUIT_COLORS } from './Palette';
import { CARD_H, CARD_W, type Textures } from './TextureFactory';

const COLS = 4;
const ROWS = 3;
const GAP = 16;

interface CardView {
    c: Container;
    glow: Sprite;
    /** "One more of this suit!" pulse. Its own sprite, so it never touches an awaited flip tween. */
    hot: Sprite;
    hover: boolean;
    face: Sprite;
    homeX: number;
    homeY: number;
}

/**
 * The Jackpot Cards overlay. Every animation method RETURNS its gsap animation so the
 * SequenceRunner can await it and fast-forward it with totalProgress(1). Nothing here kills
 * an awaited tween.
 */
export class DraftView extends Container {
    private readonly dim = new Graphics();
    private readonly title = new Text({
        text: 'JACKPOT CARDS',
        style: { fontFamily: FONT, fontSize: 40, fontWeight: 'bold', fill: 0xffd34d, letterSpacing: 8, stroke: { color: 0x3a0410, width: 6 } },
    });
    private readonly subtitle = new Text({
        text: '',
        style: { fontFamily: FONT, fontSize: 15, fill: 0xe8e0ff },
    });
    private readonly grid = new Container();
    private readonly tally = new Container();
    private readonly tallyTexts: Record<Suit, Text>;
    private readonly award = new Container();
    private readonly awardText = new Text({ text: '', style: { fontFamily: FONT, fontSize: 34, fontWeight: 'bold', fill: 0xffffff, stroke: { color: 0x07040f, width: 6 } } });
    private readonly awardSub = new Text({ text: '', style: { fontFamily: FONT, fontSize: 16, fill: 0xe8e0ff, stroke: { color: 0x07040f, width: 3 } } });
    private readonly awardBg = new Graphics();
    readonly cards: CardView[] = [];
    private readonly tex: Textures;
    /** Face-down cards lift on hover only while the player may pick. */
    pickable = false;
    private readonly hotSet = new Set<number>();
    private hotSuit: Suit | null = null;
    private t = 0;
    private readonly tallyPerks: Record<Suit, Text>;
    onCardTap: (i: number) => void = () => {};

    constructor(tex: Textures) {
        super();
        this.tex = tex;
        this.visible = false;
        this.dim.eventMode = 'static'; // swallow clicks behind the overlay
        this.title.anchor.set(0.5);
        this.subtitle.anchor.set(0.5);
        this.addChild(this.dim, this.title, this.subtitle, this.grid, this.tally, this.award);

        for (let i = 0; i < COLS * ROWS; i++) {
            const c = new Container();
            const glow = new Sprite(tex.glow);
            glow.anchor.set(0.5);
            glow.blendMode = 'add';
            glow.scale.set(2.5, 3.1);
            glow.alpha = 0;
            const hot = new Sprite(tex.glow);
            hot.anchor.set(0.5);
            hot.blendMode = 'add';
            hot.scale.set(2.8, 3.4);
            hot.alpha = 0;
            const face = new Sprite(tex.cardBack);
            face.anchor.set(0.5);
            c.addChild(hot, glow, face);
            const col = i % COLS;
            const row = Math.floor(i / COLS);
            const homeX = (col - (COLS - 1) / 2) * (CARD_W + GAP);
            const homeY = (row - (ROWS - 1) / 2) * (CARD_H + GAP);
            c.position.set(homeX, homeY);
            c.eventMode = 'static';
            c.cursor = 'pointer';
            c.label = `card-${i}`;
            c.on('pointertap', () => this.onCardTap(i));
            c.on('pointerover', () => (this.cards[i].hover = true));
            c.on('pointerout', () => (this.cards[i].hover = false));
            this.cards.push({ c, glow, hot, face, homeX, homeY, hover: false });
            this.grid.addChild(c);
        }

        this.tallyTexts = {} as Record<Suit, Text>;
        this.tallyPerks = {} as Record<Suit, Text>;
        SUITS.forEach((s, i) => {
            const t = new Text({ text: '', style: { fontFamily: FONT, fontSize: 18, fontWeight: 'bold', fill: SUIT_COLORS[s], stroke: { color: 0x07040f, width: 4 } } });
            t.anchor.set(0.5);
            t.x = (i - 1.5) * 180;
            // What each suit gives, visible BEFORE anything is flipped, so every pick is a choice.
            const perk = new Text({ text: SUIT_INFO[s].perk, style: { fontFamily: FONT, fontSize: 12, fill: 0xe8e0ff, stroke: { color: 0x07040f, width: 3 } } });
            perk.anchor.set(0.5, 0);
            perk.position.set(t.x, 14);
            this.tallyTexts[s] = t;
            this.tallyPerks[s] = perk;
            this.tally.addChild(t, perk);
        });

        this.awardText.anchor.set(0.5);
        this.awardSub.anchor.set(0.5);
        this.awardSub.y = 38;
        this.award.addChild(this.awardBg, this.awardText, this.awardSub);
        this.award.alpha = 0;
        // Pixi v8 hit-tests alpha-0 objects: a faded-out award banner would swallow clicks on the
        // middle card row of the NEXT draft. Decoration must never be a pointer target.
        for (const deco of [this.award, this.title, this.subtitle, this.tally]) deco.eventMode = 'none';
    }

    layout(w: number, h: number) {
        this.dim.clear();
        this.dim.rect(0, 0, w, h).fill({ color: 0x05020c, alpha: 0.82 });
        const scale = Math.min(1, (h - 220) / (ROWS * CARD_H + (ROWS - 1) * GAP), (w - 40) / (COLS * CARD_W + (COLS - 1) * GAP));
        this.grid.scale.set(scale);
        this.grid.position.set(w / 2, h / 2 - 4);
        const gridH = (ROWS * CARD_H + (ROWS - 1) * GAP) * scale;
        const textFit = Math.min(1, (w - 24) / 740);
        this.title.scale.set(textFit);
        this.subtitle.scale.set(textFit);
        this.subtitle.style.wordWrap = true;
        this.subtitle.style.wordWrapWidth = 720;
        this.subtitle.style.align = 'center';
        this.tally.scale.set(textFit);
        this.award.scale.set(textFit);
        this.title.position.set(w / 2, h / 2 - 4 - gridH / 2 - 62 * textFit);
        this.subtitle.position.set(w / 2, h / 2 - 4 - gridH / 2 - 26 * textFit);
        this.tally.position.set(w / 2, h / 2 - 4 + gridH / 2 + 26 * textFit);
        this.award.position.set(w / 2, h / 2 + 8);
    }

    setSubtitle(text: string) {
        this.subtitle.text = text;
    }

    /** `revealed` = face-up cards; a suit sitting at 2/3 lights up ("one away"). */
    setTally(counts: Record<Suit, number>, revealed: { index: number; suit: Suit }[] = [], tierOf?: (s: Suit) => number) {
        this.hotSet.clear();
        this.hotSuit = null;
        for (const s of SUITS) {
            const tier = tierOf ? tierOf(s) : 0;
            this.tallyTexts[s].text = `${SUIT_INFO[s].glyph} ${counts[s]}/3${tier ? `  (T${tier})` : ''}`;
            if (counts[s] === 2) this.hotSuit = s;
        }
        for (const r of revealed) if (counts[r.suit] === 2) this.hotSet.add(r.index);
    }

    get hot(): Suit | null {
        return this.hotSuit;
    }

    /** Per-frame: hover lift and the "one away" pulse. Plain lerps, no tweens to collide with. */
    tick(dt: number) {
        if (!this.visible) return;
        this.t += dt;
        const k = 1 - Math.exp(-dt * 14);
        this.cards.forEach((card, i) => {
            const down = card.face.texture === this.tex.cardBack;
            const lift = this.pickable && down && card.hover ? -10 : 0;
            card.face.y += (lift - card.face.y) * k;
            card.glow.y = card.face.y;
            const hot = this.hotSet.has(i) ? 0.45 + 0.35 * Math.sin(this.t * 9) : 0;
            card.hot.alpha += (hot - card.hot.alpha) * k;
            if (hot > 0 && this.hotSuit) card.hot.tint = SUIT_COLORS[this.hotSuit];
        });
        for (const s of SUITS) {
            const on = s === this.hotSuit;
            const sc = on ? 1.15 + 0.08 * Math.sin(this.t * 9) : 1;
            this.tallyTexts[s].scale.set(sc);
            this.tallyPerks[s].alpha = this.hotSuit && !on ? 0.45 : 1;
        }
    }

    reset() {
        this.visible = true;
        this.alpha = 1;
        this.award.alpha = 0;
        this.hotSet.clear();
        this.hotSuit = null;
        this.pickable = false;
        for (const card of this.cards) {
            card.hot.alpha = 0;
            card.face.y = 0;
            card.glow.y = 0;
            card.face.texture = this.tex.cardBack;
            card.c.scale.set(1);
            card.c.rotation = 0;
            card.c.alpha = 0;
            card.glow.alpha = 0;
            card.c.position.set(0, 400);
        }
    }

    /** SPIN: cards fly in from below, staggered. */
    deal(onCard: (i: number) => void): gsap.core.Timeline {
        const tl = gsap.timeline();
        tl.fromTo(this.title, { alpha: 0, y: this.title.y - 20 }, { alpha: 1, y: this.title.y, duration: 0.3 }, 0);
        this.cards.forEach((card, i) => {
            tl.to(card.c, { alpha: 1, x: card.homeX, y: card.homeY, rotation: 0, duration: 0.38, ease: 'back.out(1.4)', onStart: () => onCard(i) }, 0.1 + i * 0.05);
            tl.fromTo(card.c, { rotation: (i % 2 ? 1 : -1) * 0.6 }, { rotation: 0, duration: 0.38 }, 0.1 + i * 0.05);
        });
        return tl;
    }

    /** 3D-style flip: squash scaleX to 0, swap texture, unsquash with a lift. */
    flip(i: number, suit: Suit): gsap.core.Timeline {
        const card = this.cards[i];
        const tl = gsap.timeline();
        tl.to(card.c.scale, { x: 0, y: 1.08, duration: 0.11, ease: 'power2.in' });
        tl.call(() => {
            card.face.texture = this.tex.cardFaces[suit];
        });
        tl.to(card.c.scale, { x: 1, y: 1, duration: 0.16, ease: 'back.out(2)' });
        tl.to(card.glow, { alpha: 0.22, duration: 0.1 }, '<');
        tl.call(() => {
            card.glow.tint = SUIT_COLORS[suit];
        }, undefined, 0.11);
        return tl;
    }

    /** Matched triple pulses; the rest dim; perk banner slides in. */
    celebrate(suit: Suit, indices: number[], tier: number): gsap.core.Timeline {
        const tl = gsap.timeline();
        this.cards.forEach((card, i) => {
            if (indices.includes(i)) {
                card.glow.tint = SUIT_COLORS[suit];
                tl.to(card.glow, { alpha: 0.75, duration: 0.25 }, 0);
                tl.to(card.c.scale, { x: 1.14, y: 1.14, duration: 0.25, yoyo: true, repeat: 3, ease: 'sine.inOut' }, 0);
            } else {
                tl.to(card.c, { alpha: 0.25, duration: 0.3 }, 0);
            }
        });
        const info = SUIT_INFO[suit];
        this.awardText.text = `${info.glyph} ${info.name} · TIER ${tier}`;
        this.awardText.style.fill = SUIT_COLORS[suit];
        this.awardSub.text = info.perk;
        this.awardBg.clear();
        this.awardBg.roundRect(-300, -40, 600, 104, 16).fill({ color: 0x07040f, alpha: 0.9 });
        this.awardBg.roundRect(-300, -40, 600, 104, 16).stroke({ width: 3, color: SUIT_COLORS[suit] });
        tl.fromTo(this.award, { alpha: 0 }, { alpha: 1, duration: 0.3 }, 0.3);
        tl.fromTo(this.award.scale, { x: 0.6, y: 0.6 }, { x: 1, y: 1, duration: 0.45, ease: 'back.out(2.2)' }, 0.3);
        tl.to({}, { duration: 1.1 });
        return tl;
    }

    close(): gsap.core.Tween {
        return gsap.to(this, { alpha: 0, duration: 0.3, onComplete: () => void (this.visible = false) });
    }
}
