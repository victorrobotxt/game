import { Container, Graphics, Sprite, Text, type TextStyleOptions } from 'pixi.js';
import gsap from 'gsap';
import { PERFECT_WINDOW } from '../engine/BeatClock';
import type { World } from '../engine/World';
import { Element, SUITS, THEME_INFO, THEME_ORDER, Theme, Realm, type Theme as ThemeT } from '../engine/types';
import { COIN_TIERS, GRAND_AT } from '../engine/easter-eggs/PortfolioCameos';
import { SUIT_INFO, type UpgradeTiers } from '../engine/Upgrades';
import { ELEMENT_COLORS, FONT, SKINS, SUIT_COLORS, TITLE_STYLES, lerpColor, type RealmPalette } from './Palette';
import type { Textures } from './TextureFactory';

export type GyroStatus = 'offline' | 'waiting' | 'linked';

const style = (size: number, fill: number, extra: Partial<TextStyleOptions> = {}): TextStyleOptions => ({
    fontFamily: FONT,
    fontSize: size,
    fontWeight: 'bold',
    fill,
    stroke: { color: 0x07040f, width: Math.max(2, size / 6) },
    ...extra,
});

/** Below this width the HUD switches to the two-row compact layout (phones, small laptops). */
const WIDE_AT = 1180;
/** Preset tab height (pill). */
const TAB_H = 32;
const SHORT_LABELS: Record<ThemeT, string> = {
    PARALLEL_SYNC: 'SYNC',
    CHAIN_OVERLOAD: 'CHAIN',
    ALCHEMY_CRAFT: 'CRAFT',
    TIME_ECHO: 'ECHO',
    SHADOW_LENS: 'LENS',
};

export interface RunSummary {
    score: number;
    wave: number;
    bestChain: number;
    bestCombo: number;
    coins: number;
    tiers: UpgradeTiers;
    theme: ThemeT;
    best: number;
    newBest: boolean;
}

/** Screen-space HUD. Never shaken. Theme buttons are real Pixi pointer targets. */
export class HudView extends Container {
    private readonly topBar = new Graphics();
    private readonly bottomBar = new Graphics();
    private readonly score = new Text({ text: '0', style: style(30, 0xffffff) });
    private readonly scoreLabel = new Text({ text: 'SCORE', style: style(11, 0xbfb3d9, { letterSpacing: 3, stroke: undefined }) });
    private readonly waveText = new Text({ text: '', style: style(14, 0xffd34d) });
    private readonly comboText = new Text({ text: '', style: style(26, 0xffffff) });
    private readonly realmText = new Text({ text: '', style: style(13, 0xffffff, { letterSpacing: 3 }) });
    private readonly link = new Container();
    private readonly linkBar = new Graphics();
    private readonly linkLabels: Text[] = [];
    private readonly linkCoin: Sprite;
    private readonly linkCount = new Text({ text: '0 / 20', style: style(13, 0xffe9a8) });
    private readonly clockBox = new Container();
    private readonly clock = new Graphics();
    private readonly clockLabels: Text[] = [];
    private readonly beatBox = new Container();
    private readonly beatBar = new Graphics();
    private readonly beatLabel = new Text({ text: 'ONE CLOCK', style: style(9, 0xbfb3d9, { letterSpacing: 2, stroke: undefined }) });
    private readonly gyroBox = new Container();
    private readonly gyroDot = new Graphics();
    private readonly gyroText = new Text({ text: 'PHONE', style: style(11, 0x9a90b0, { letterSpacing: 1 }) });
    private readonly gyroSub = new Text({ text: 'OFFLINE', style: style(10, 0x9a90b0, { fontWeight: 'normal' }) });
    private readonly hpGfx = new Graphics();
    private readonly hpBox = new Container();
    private readonly flaskIcons: Sprite[] = [];
    /** Seconds left of the crack animation per vitality flask. */
    private readonly crackT: number[] = [];
    private lastHp = -1;
    private readonly tex: Textures;
    private readonly hpLabel = new Text({ text: 'VITALITY', style: style(11, 0xbfb3d9, { letterSpacing: 3, stroke: undefined }) });
    private readonly buttons: { c: Container; bg: Graphics; label: Text; key: Text; theme: ThemeT; w: number }[] = [];
    private readonly widgetBox = new Container();
    private readonly widget = new Graphics();
    private readonly widgetText = new Text({ text: '', style: style(12, 0xffffff, { letterSpacing: 1 }) });
    private readonly flasks: Sprite[] = [];
    private readonly banner = new Container();
    private readonly bannerBox = new Container();
    private readonly bannerBg = new Graphics();
    private readonly bannerTitle = new Text({ text: '', style: style(48, 0xffffff, { letterSpacing: 6 }) });
    private readonly bannerTag = new Text({ text: '', style: style(20, 0xffd34d, { fontStyle: 'italic' }) });
    private readonly bannerHint = new Text({ text: '', style: style(15, 0xe8e0ff, { fontWeight: 'normal', wordWrap: true, wordWrapWidth: 640, align: 'center' }) });
    private readonly center = new Container();
    private readonly centerText = new Text({ text: '', style: style(56, 0xffd34d, { letterSpacing: 4, stroke: { color: 0x3a0410, width: 8 } }) });
    private readonly centerSub = new Text({ text: '', style: style(18, 0xffffff) });
    readonly fpsText = new Text({ text: '', style: style(10, 0x8affc1, { fontWeight: 'normal' }) });
    private readonly chips = new Text({ text: '', style: style(11, 0xffd34d, { letterSpacing: 1 }) });
    private readonly phoneUrl = new Text({ text: '', style: style(11, 0xe8e0ff, { fontWeight: 'normal', stroke: undefined }) });
    private readonly phoneBg = new Graphics();
    // Tutorial coach line above the bottom bar.
    private readonly coach = new Container();
    private readonly coachBg = new Graphics();
    private readonly coachText = new Text({ text: '', style: style(15, 0xffffff, { wordWrap: true, wordWrapWidth: 620, align: 'center', lineHeight: 20 }) });
    private coachWant = 0;
    // Title screen.
    private readonly title = new Container();
    private readonly titleDim = new Graphics();
    private readonly titleBox = new Container();
    private readonly titleClocks = new Graphics();
    private readonly titleKicker = new Text({ text: 'THE ALCHEMIST’S', style: style(20, 0xe8e0ff, { letterSpacing: 10, fontFamily: TITLE_STYLES.PARALLEL_SYNC.font }) });
    private readonly titleMain = new Text({ text: 'PARALLEL CLOCK', style: style(64, 0xffe9a8, { letterSpacing: 6, fontFamily: TITLE_STYLES.PARALLEL_SYNC.font, stroke: { color: 0x3a1206, width: 8 } }) });
    private readonly titleTag = new Text({ text: '“Two Worlds, One Clock”', style: style(20, 0xffd34d, { fontStyle: 'italic', fontWeight: 'normal', fontFamily: TITLE_STYLES.PARALLEL_SYNC.font }) });
    private readonly titlePress = new Text({ text: 'PRESS SPACE', style: style(30, 0xffffff, { letterSpacing: 8 }) });
    private readonly titleHelp = new Text({
        text: 'WASD move  ·  SPACE shift realms on the beat  ·  1–5 themes\nM mute  ·  C calm mode (less flash/shake)  ·  T 60-second tour',
        style: style(13, 0xbfb3d9, { fontWeight: 'normal', align: 'center', lineHeight: 20, stroke: undefined }),
    });
    private readonly titleDemo = new Text({ text: '', style: style(11, 0x8a80a8, { fontWeight: 'normal', letterSpacing: 2, stroke: undefined }) });
    private readonly titleCityA = new Text({ text: 'SOFIA', style: style(12, 0xffd34d, { letterSpacing: 4 }) });
    private readonly titleCityB = new Text({ text: 'MALTA', style: style(12, 0x3ef0ff, { letterSpacing: 4 }) });
    // Results card.
    private readonly results = new Container();
    private readonly resultsDim = new Graphics();
    private readonly resultsBox = new Container();
    private readonly resultsBg = new Graphics();
    private readonly resultsTitle = new Text({ text: 'THE CLOCK STOPS', style: style(40, 0xff4d6d, { letterSpacing: 4, stroke: { color: 0x3a0410, width: 6 } }) });
    private readonly resultsScore = new Text({ text: '0', style: style(54, 0xffffff) });
    private readonly resultsBest = new Text({ text: '', style: style(14, 0xffd34d, { letterSpacing: 2 }) });
    private readonly resultsStats: { k: Text; v: Text }[] = [];
    private readonly resultsSuits: Text[] = [];
    private readonly resultsHint = new Text({ text: 'SPACE / R  rewind the clock   ·   ESC  title', style: style(13, 0xbfb3d9, { fontWeight: 'normal', letterSpacing: 1, stroke: undefined }) });
    // Attract / tour caption.
    private readonly demo = new Container();
    private readonly demoBg = new Graphics();
    private readonly demoTag = new Text({ text: '', style: style(12, 0x07040f, { letterSpacing: 3, stroke: undefined }) });
    private readonly demoCaption = new Text({ text: '', style: style(20, 0xffffff, { wordWrap: true, wordWrapWidth: 700, align: 'center' }) });

    private shownScore = 0;
    private demoBottom = 600;
    private shownTheme: ThemeT | null = null;
    private w = 1280;
    private h = 720;
    compact = false;
    topH = 64;
    bottomH = 72;
    onTheme: (t: ThemeT) => void = () => {};
    /** Captions and the title screen live above the draft overlay; main.ts adds this to the stage last. */
    readonly overlay = new Container();

    constructor(tex: Textures) {
        super();
        this.tex = tex;
        for (let i = 0; i < 12; i++) {
            const f = new Sprite(tex.heartFull);
            f.anchor.set(0.5);
            f.visible = false;
            this.flaskIcons.push(f);
            this.crackT.push(0);
            this.hpBox.addChild(f);
        }
        this.hpBox.addChild(this.hpGfx);
        this.addChild(this.topBar, this.bottomBar);
        this.score.anchor.set(0, 0.5);
        this.addChild(this.scoreLabel, this.score, this.waveText, this.realmText);

        this.linkCoin = new Sprite(tex.coin);
        this.linkCoin.anchor.set(0.5);
        this.link.addChild(this.linkBar, this.linkCoin, this.linkCount);
        this.linkCount.anchor.set(0, 0.5);
        for (const tier of COIN_TIERS) {
            const t = new Text({ text: tier.name, style: style(11, tier.color, { letterSpacing: 2 }) });
            t.anchor.set(0.5);
            this.linkLabels.push(t);
            this.link.addChild(t);
        }
        this.addChild(this.link);

        this.clockBox.addChild(this.clock);
        for (const name of ['SOFIA', 'MALTA']) {
            const t = new Text({ text: name, style: style(9, 0xe8e0ff, { letterSpacing: 2, stroke: undefined }) });
            t.anchor.set(0.5);
            t.position.set(name === 'SOFIA' ? -28 : 28, 28);
            this.clockLabels.push(t);
            this.clockBox.addChild(t);
        }
        this.beatLabel.anchor.set(0.5, 0);
        this.beatLabel.y = 24;
        this.beatBox.addChild(this.beatBar, this.beatLabel);
        this.gyroText.position.set(10, -7);
        this.gyroSub.position.set(10, 10);
        this.gyroBox.addChild(this.gyroDot, this.gyroText, this.gyroSub);
        this.addChild(this.clockBox, this.beatBox, this.gyroBox);

        this.addChild(this.hpBox, this.hpLabel);
        THEME_ORDER.forEach((theme, i) => {
            const c = new Container();
            const bg = new Graphics();
            const label = new Text({ text: THEME_INFO[theme].title, style: style(12, 0xffffff, { letterSpacing: 1, stroke: undefined }) });
            label.anchor.set(0.5);
            const key = new Text({ text: `${i + 1}`, style: style(12, 0x07040f, { stroke: undefined }) });
            key.anchor.set(0.5);
            c.addChild(bg, label, key);
            c.eventMode = 'static';
            c.cursor = 'pointer';
            c.on('pointertap', () => this.onTheme(theme));
            c.label = `theme-btn-${i + 1}`;
            this.buttons.push({ c, bg, label, key, theme, w: 136 });
            this.addChild(c);
        });
        this.widgetBox.addChild(this.widget, this.widgetText);
        this.widgetText.y = -22;
        Object.values(Element).forEach((el, i) => {
            const s = new Sprite(tex.flask);
            s.anchor.set(0.5);
            s.scale.set(0.5);
            s.tint = ELEMENT_COLORS[el];
            s.position.set(17 + i * 42, 16);
            this.flasks.push(s);
            this.widgetBox.addChild(s);
        });
        this.addChild(this.widgetBox);

        this.bannerTitle.anchor.set(0.5);
        this.bannerTag.anchor.set(0.5);
        this.bannerHint.anchor.set(0.5);
        this.bannerBox.addChild(this.bannerBg, this.bannerTitle, this.bannerTag, this.bannerHint);
        this.banner.addChild(this.bannerBox);
        this.banner.alpha = 0;

        this.centerText.anchor.set(0.5);
        this.centerSub.anchor.set(0.5);
        this.center.addChild(this.centerText, this.centerSub);
        this.center.alpha = 0;

        this.coachText.anchor.set(0.5);
        this.coach.addChild(this.coachBg, this.coachText);
        this.coach.alpha = 0;

        this.demoTag.anchor.set(0.5);
        this.demoCaption.anchor.set(0.5, 0);
        this.demo.addChild(this.demoBg, this.demoTag, this.demoCaption);
        this.demo.visible = false;

        this.buildTitle();
        this.buildResults();

        this.addChild(this.banner, this.center, this.comboText, this.coach, this.fpsText, this.chips, this.phoneBg, this.phoneUrl, this.results);
        this.overlay.addChild(this.demo, this.title);
        this.overlay.eventMode = 'none';
        this.phoneUrl.anchor.set(0, 0.5);
        this.comboText.anchor.set(0.5);
        this.fpsText.anchor.set(1, 1);
        this.chips.anchor.set(1, 0);
        for (const deco of [this.banner, this.center, this.comboText, this.fpsText, this.chips, this.link, this.phoneUrl, this.phoneBg, this.coach, this.demo, this.results, this.title])
            deco.eventMode = 'none';
    }

    private buildTitle() {
        for (const t of [this.titleKicker, this.titleMain, this.titleTag, this.titlePress, this.titleHelp, this.titleDemo, this.titleCityA, this.titleCityB]) t.anchor.set(0.5);
        this.titleKicker.y = -184;
        this.titleMain.y = -134;
        this.titleTag.y = -86;
        this.titleCityA.position.set(-200, 82);
        this.titleCityB.position.set(200, 82);
        this.titlePress.y = 130;
        this.titleHelp.y = 180;
        this.titleDemo.y = 218;
        this.titleBox.addChild(this.titleClocks, this.titleKicker, this.titleMain, this.titleTag, this.titleCityA, this.titleCityB, this.titlePress, this.titleHelp, this.titleDemo);
        this.title.addChild(this.titleDim, this.titleBox);
        this.title.visible = false;
    }

    private buildResults() {
        const b = this.resultsBox;
        b.addChild(this.resultsBg);
        for (const t of [this.resultsTitle, this.resultsScore, this.resultsBest, this.resultsHint]) {
            t.anchor.set(0.5);
            b.addChild(t);
        }
        this.resultsTitle.y = -158;
        this.resultsScore.y = -98;
        this.resultsBest.y = -58;
        this.resultsHint.y = 168;
        const labels = ['WAVE', 'BEST CHAIN', 'BEST COMBO', 'COINS'];
        labels.forEach((name, i) => {
            const x = (i - 1.5) * 128;
            const k = new Text({ text: name, style: style(10, 0xbfb3d9, { letterSpacing: 2, stroke: undefined }) });
            const v = new Text({ text: '0', style: style(30, 0xffffff) });
            k.anchor.set(0.5);
            v.anchor.set(0.5);
            k.position.set(x, -14);
            v.position.set(x, 18);
            this.resultsStats.push({ k, v });
            b.addChild(k, v);
        });
        SUITS.forEach((s, i) => {
            const t = new Text({ text: '', style: style(16, SUIT_COLORS[s], { align: 'center', lineHeight: 20 }) });
            t.anchor.set(0.5);
            t.position.set((i - 1.5) * 128, 96);
            this.resultsSuits.push(t);
            b.addChild(t);
        });
        this.results.addChild(this.resultsDim, b);
        this.results.visible = false;
    }

    /** Screen position of the coin-link target (for bezier coin flights). */
    get coinTarget(): { x: number; y: number } {
        return this.link.toGlobal(this.linkCoin.position);
    }

    setPhoneUrl(url: string) {
        this.phoneUrl.text = url ? `PHONE CO-OP  →  ${url}` : '';
        this.phoneBg.clear();
        if (url) this.phoneBg.roundRect(-10, -12, this.phoneUrl.width + 20, 24, 12).fill({ color: 0x07040f, alpha: 0.85 }).stroke({ width: 1, color: 0xffd34d, alpha: 0.5 });
    }

    layout(w: number, h: number) {
        this.w = w;
        this.h = h;
        // wide: everything in one row. medium: one row, beat bar + phone status dropped.
        // compact (< 900 px): two-row bars, short theme labels.
        const compact = (this.compact = w < 900);
        const medium = !compact && w < WIDE_AT;
        const top = (this.topH = compact ? 92 : 64);
        const bot = (this.bottomH = compact ? 96 : 64);

        // ---- top
        this.scoreLabel.position.set(compact ? 12 : 22, compact ? 6 : 10);
        this.score.position.set(compact ? 10 : 20, compact ? 28 : 38);
        this.score.scale.set(compact ? 0.78 : 1);
        this.realmText.position.set(compact ? 132 : 160, compact ? 8 : 10);
        this.waveText.position.set(compact ? 132 : 160, compact ? 28 : 30);
        const linkW = 450;
        const linkScale = compact ? Math.min(1, (w - 40) / linkW) : medium ? Math.min(1, (w - 360 - 150) / linkW) : 1;
        this.link.scale.set(linkScale);
        const linkCx = medium ? 360 + (w - 150 - 360) / 2 : w / 2;
        this.link.position.set(linkCx - (linkW / 2 - 20) * linkScale, compact ? 50 : 14 + (1 - linkScale) * 20);
        this.linkCoin.position.set(-18, 18);
        this.linkCount.position.set(388, 18);
        this.linkLabels.forEach((t, i) => t.position.set(47 + i * 95, 44));
        // The beat bar is redundant on small screens: the ring round the player carries the rhythm.
        this.beatBox.visible = !compact && !medium;
        this.gyroBox.visible = !medium && (!compact || w >= 760);
        this.clockBox.visible = !compact || w >= 560;
        if (medium) this.clockBox.position.set(w - 70, 22);
        else if (compact) {
            this.clockBox.position.set(w - (this.gyroBox.visible ? 210 : 62), 22);
            this.gyroBox.position.set(w - 130, 22);
        } else {
            this.beatBox.position.set(w - 330, 22);
            this.clockBox.position.set(w - 200, 26);
            this.gyroBox.position.set(w - 126, 20);
        }
        this.comboText.position.set(w / 2, top + 34);
        this.comboText.scale.set(compact ? 0.8 : 1);
        this.chips.position.set(w - 10, top + 8);

        // ---- bottom
        const y0 = h - bot;
        if (compact) {
            this.hpLabel.visible = false;
            this.hpBox.position.set(12, y0 + 10);
            const ws = Math.min(1, (w - 24 - 200) / 262);
            this.widgetBox.scale.set(Math.max(0.5, ws));
            this.widgetBox.position.set(w - 12 - 262 * this.widgetBox.scale.x, y0 + 30);
        } else {
            this.hpLabel.visible = true;
            this.hpLabel.position.set(22, y0 + 5);
            this.hpBox.position.set(22, y0 + 20);
            this.widgetBox.scale.set(1);
            this.widgetBox.position.set(w - 272, y0 + 32);
        }
        const gap = compact ? 6 : 8;
        const bw = compact ? (w - 16 - gap * 4) / 5 : Math.max(60, Math.min(136, (w - 602) / 5));
        const short = compact || bw < 112;
        const total = bw * 5 + gap * 4;
        const by = compact ? h - 26 : h - bot / 2;
        this.buttons.forEach((b, i) => {
            b.w = bw;
            b.c.position.set(w / 2 - total / 2 + i * (bw + gap) + bw / 2, by);
            b.c.hitArea = { contains: (x: number, y: number) => Math.abs(x) < bw / 2 && Math.abs(y) < TAB_H / 2 + 2 };
            b.key.position.set(-bw / 2 + 14, 0);
            b.label.text = short ? SHORT_LABELS[b.theme] : THEME_INFO[b.theme].title;
            b.label.scale.set(1);
            b.label.scale.set(Math.min(1, (bw - 34) / Math.max(1, b.label.width)));
            b.label.x = 9;
        });

        // ---- overlays
        this.bannerBox.scale.set(Math.min(1, (w - 24) / 740, (h - top - bot) * 0.4 / 160));
        this.banner.position.set(w / 2, top + (h - top - bot) * 0.55);
        this.center.position.set(w / 2, top + Math.min(110, (h - top - bot) * 0.22));
        // Compact: the FPS/seed debug line moves under the top bar so it never meets the coach.
        if (compact) {
            this.fpsText.anchor.set(0, 0);
            this.fpsText.position.set(10, top + 6);
        } else {
            this.fpsText.anchor.set(1, 1);
            this.fpsText.position.set(w - 10, h - bot - 6);
        }
        this.phoneUrl.position.set(24, h - bot - 20);
        this.phoneBg.position.set(24, h - bot - 20);
        this.coach.position.set(w / 2, h - bot - (compact ? 40 : 48));
        this.coachText.style.wordWrapWidth = Math.min(620, w - 60);
        // Tour/attract caption sits inside the bottom of the arena: clear of the top HUD, the
        // WAVE popups and the preset banner. The pill is the caption box's header.
        this.demoCaption.style.wordWrapWidth = Math.min(700, w - 64);
        this.demoBottom = h - bot - 14;
        this.demoTag.text = '';

        this.titleDim.clear();
        this.titleDim.rect(0, 0, w, h).fill({ color: 0x05020c, alpha: 0.72 });
        // >= 36 px each side, so the title clears the arena frame (12 px) by at least 24 px.
        this.titleBox.scale.set(Math.min(1, (w - 72) / 760, (h - 24) / 440));
        this.titleBox.position.set(w / 2, h / 2);
        this.resultsDim.clear();
        this.resultsDim.rect(0, 0, w, h).fill({ color: 0x05020c, alpha: 0.7 });
        this.resultsBox.scale.set(Math.min(1, (w - 24) / 580, (h - 24) / 400));
        this.resultsBox.position.set(w / 2, h / 2);

        this.topBar.clear();
        this.topBar.rect(0, 0, w, top).fill({ color: 0x07040f, alpha: 0.78 });
        this.bottomBar.clear();
        this.bottomBar.rect(0, y0, w, bot).fill({ color: 0x07040f, alpha: 0.78 });
    }

    /** Bounding boxes of the HUD parts, for the narrow-screen layout check in the e2e. */
    layoutReport() {
        const box = (c: Container) => {
            const b = c.getBounds();
            return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
        };
        const parts: Record<string, Container> = { score: this.score, realm: this.realmText, link: this.link, hp: this.hpBox, widget: this.widgetBox };
        if (this.fpsText.visible) parts.fps = this.fpsText;
        if (this.coach.alpha > 0.05) parts.coach = this.coach;
        if (this.clockBox.visible) parts.clock = this.clockBox;
        if (this.gyroBox.visible) parts.gyro = this.gyroBox;
        if (this.beatBox.visible) parts.beat = this.beatBox;
        return {
            compact: this.compact,
            topH: this.topH,
            bottomH: this.bottomH,
            parts: Object.fromEntries(Object.entries(parts).map(([k, c]) => [k, box(c)])),
            buttons: this.buttons.map((b) => ({ x: Math.round(b.c.x - b.w / 2), w: Math.round(b.w), labelW: Math.round(b.label.width) })),
            titleMain: this.title.visible ? box(this.titleMain) : null,
        };
    }

    private applyTitleStyle(theme: ThemeT) {
        const ts = TITLE_STYLES[theme];
        for (const t of [this.bannerTitle, this.centerText]) {
            t.style.fontFamily = ts.font;
            t.style.fontWeight = ts.weight;
            t.style.fontStyle = ts.italic ? 'italic' : 'normal';
            t.style.letterSpacing = ts.spacing;
            t.style.stroke = { color: ts.stroke, width: 8 };
        }
        this.bannerTitle.style.fill = ts.fill;
        this.bannerTag.style.fontFamily = ts.font;
        this.bannerTag.style.fill = SKINS[theme].SOLAR_ORDER.accent;
    }

    showThemeBanner(theme: ThemeT) {
        const info = THEME_INFO[theme];
        const ts = TITLE_STYLES[theme];
        const accent = SKINS[theme].SOLAR_ORDER.accent;
        const accent2 = SKINS[theme].SHADOW_ALCHEMY.accent;
        this.applyTitleStyle(theme);
        this.bannerTitle.text = info.title;
        this.bannerTag.text = `“${info.tagline}”`;
        this.bannerHint.text = info.hint;
        this.bannerTitle.y = -36;
        this.bannerTag.y = 10;
        this.bannerHint.y = 46;
        const g = this.bannerBg;
        g.clear();
        const W = 720;
        const H = 160;
        const x0 = -W / 2;
        const y0 = -82;
        switch (ts.frame) {
            case 'hazard':
                g.rect(x0, y0, W, H).fill({ color: 0x0a0402, alpha: 0.85 });
                for (let x = x0; x < x0 + W; x += 28) {
                    g.poly([x, y0, x + 14, y0, x + 4, y0 + 10, x - 10, y0 + 10]).fill({ color: accent, alpha: 0.8 });
                    g.poly([x, y0 + H, x + 14, y0 + H, x + 4, y0 + H - 10, x - 10, y0 + H - 10]).fill({ color: accent, alpha: 0.8 });
                }
                break;
            case 'sigil':
                g.roundRect(x0, y0, W, H, 80).fill({ color: 0x07040f, alpha: 0.78 });
                g.roundRect(x0, y0, W, H, 80).stroke({ width: 2, color: accent, alpha: 0.7 });
                g.roundRect(x0 + 8, y0 + 8, W - 16, H - 16, 72).stroke({ width: 1, color: accent2, alpha: 0.6 });
                for (const sx of [-1, 1]) g.circle(sx * (W / 2 - 40), y0 + H / 2, 16).stroke({ width: 1.5, color: accent, alpha: 0.7 });
                break;
            case 'brass':
                g.rect(x0, y0, W, H).fill({ color: 0x140d05, alpha: 0.85 });
                g.rect(x0, y0, W, H).stroke({ width: 4, color: accent, alpha: 0.75 });
                for (const [rx, ry] of [[x0 + 12, y0 + 12], [x0 + W - 12, y0 + 12], [x0 + 12, y0 + H - 12], [x0 + W - 12, y0 + H - 12]]) g.circle(rx, ry, 4).fill(accent);
                break;
            case 'noir':
                g.rect(x0 - 60, y0 + 4, W + 120, H - 8).fill({ color: 0x000000, alpha: 0.85 });
                g.rect(x0 - 60, y0 + 4, W + 120, 2).fill({ color: 0xffffff, alpha: 0.5 });
                g.rect(x0 - 60, y0 + H - 6, W + 120, 2).fill({ color: 0xffffff, alpha: 0.5 });
                break;
            default:
                g.roundRect(x0, y0, W, H, 18).fill({ color: 0x07040f, alpha: 0.72 });
                g.roundRect(x0, y0, W, H, 18).stroke({ width: 2, color: accent, alpha: 0.7 });
        }
        gsap.killTweensOf(this.banner); // fire-and-forget tween: nothing awaits it
        gsap.killTweensOf(this.banner.scale);
        this.banner.alpha = 1;
        this.banner.scale.set(0.85);
        gsap.to(this.banner.scale, { x: 1, y: 1, duration: 0.35, ease: 'back.out(2)' });
        gsap.to(this.banner, { alpha: 0, duration: 0.5, delay: 1.7 });
    }

    private fitCenter(): number {
        return Math.min(1, (this.w - 24) / Math.max(1, this.centerText.width, this.centerSub.width));
    }

    /** Big centre popup with a rolling odometer, e.g. "27 ETERNAL COMBO!". */
    odometer(n: number, format: (v: number) => string, sub: string, color = 0xffd34d) {
        const counter = { v: 0 };
        gsap.killTweensOf(this.center);
        gsap.killTweensOf(this.center.scale);
        this.center.alpha = 1;
        this.centerText.style.fill = color;
        this.centerSub.text = sub;
        this.centerSub.y = 46;
        this.centerText.text = format(n);
        const fit = this.fitCenter();
        this.center.scale.set(0.6 * fit);
        gsap.to(this.center.scale, { x: fit, y: fit, duration: 0.4, ease: 'back.out(2.5)' });
        gsap.to(counter, {
            v: n,
            duration: Math.min(1.2, 0.3 + n * 0.04),
            ease: 'power2.out',
            onUpdate: () => (this.centerText.text = format(Math.round(counter.v))),
            onComplete: () => (this.centerText.text = format(n)),
        });
        this.centerText.text = format(0);
        gsap.to(this.center, { alpha: 0, duration: 0.5, delay: 2 });
    }

    popCenter(text: string, sub: string, color: number) {
        gsap.killTweensOf(this.center);
        gsap.killTweensOf(this.center.scale);
        this.centerText.text = text;
        this.centerText.style.fill = color;
        this.centerSub.text = sub;
        this.centerSub.y = 46;
        this.center.alpha = 1;
        const fit = this.fitCenter();
        this.center.scale.set(0.6 * fit);
        gsap.to(this.center.scale, { x: fit, y: fit, duration: 0.35, ease: 'back.out(2.5)' });
        gsap.to(this.center, { alpha: 0, duration: 0.5, delay: 1.6 });
    }

    hideCenter() {
        gsap.killTweensOf(this.center);
        this.center.alpha = 0;
    }

    // ------------------------------------------------------------------ title / results / coach / demo

    showTitle(on: boolean) {
        this.title.visible = on;
    }

    /** Touch-first device: word the prompts for taps instead of keys. */
    setTouch(on: boolean) {
        if (!on) return;
        this.titlePress.text = 'TAP TO START';
        this.titleHelp.text = 'thumb 1: hold & drag to move  ·  thumb 2: tap to shift realms\non the beat  ·  theme buttons below';
    }

    get titleVisible(): boolean {
        return this.title.visible;
    }

    /** Two clock faces (Sofia + Malta) driven by the one beat clock: the game's motif. */
    updateTitle(beats: number, bpm: number, demoIn: number) {
        if (!this.title.visible) return;
        const g = this.titleClocks;
        g.clear();
        const phase = beats - Math.floor(beats);
        const beat = (1 - phase) ** 2;
        const solar = SKINS.PARALLEL_SYNC.SOLAR_ORDER;
        const shadow = SKINS.PARALLEL_SYNC.SHADOW_ALCHEMY;
        const cy = 4;
        for (const [cx, pal, hourOff] of [[-200, solar, 0], [200, shadow, -1]] as const) {
            g.circle(cx, cy, 54).fill({ color: pal.bg, alpha: 0.95 }).stroke({ width: 3, color: pal.accent, alpha: 0.55 + beat * 0.45 });
            g.circle(cx, cy, 62 + beat * 6).stroke({ width: 1.5, color: pal.accent, alpha: 0.15 + beat * 0.35 });
            for (let i = 0; i < 12; i++) {
                const a = (i / 12) * Math.PI * 2;
                g.circle(cx + Math.cos(a) * 44, cy + Math.sin(a) * 44, i % 3 ? 1.5 : 3).fill({ color: pal.gridHot, alpha: 0.8 });
            }
            const hand = phase * Math.PI * 2 - Math.PI / 2;
            const hour = ((beats / 4 + hourOff) / 12) * Math.PI * 2 - Math.PI / 2;
            g.moveTo(cx, cy).lineTo(cx + Math.cos(hour) * 26, cy + Math.sin(hour) * 26).stroke({ width: 4, color: 0xffffff });
            g.moveTo(cx, cy).lineTo(cx + Math.cos(hand) * 44, cy + Math.sin(hand) * 44).stroke({ width: 2.5, color: pal.accent });
            g.circle(cx, cy, 4).fill(0xffffff);
        }
        // One pendulum linking the two: the beat travels between the offices.
        const swing = Math.sin(beats * Math.PI);
        g.moveTo(-136, cy).lineTo(136, cy).stroke({ width: 1.5, color: 0xffffff, alpha: 0.25 });
        g.circle(swing * 126, cy, 7 + beat * 4).fill(lerpColor(solar.accent, shadow.accent, (swing + 1) / 2));
        this.titlePress.alpha = 0.55 + beat * 0.45;
        this.titlePress.scale.set(1 + beat * 0.05);
        this.titleDemo.text = `${Math.round(bpm)} BPM  ·  ${demoIn > 0 ? `self-playing demo in ${Math.ceil(demoIn)}s` : ''}`;
    }

    showResults(r: RunSummary) {
        this.results.visible = true;
        const g = this.resultsBg;
        const ts = TITLE_STYLES[r.theme];
        const accent = SKINS[r.theme].SOLAR_ORDER.accent;
        g.clear();
        g.roundRect(-280, -196, 560, 392, 22).fill({ color: 0x07040f, alpha: 0.94 });
        g.roundRect(-280, -196, 560, 392, 22).stroke({ width: 2.5, color: accent, alpha: 0.85 });
        g.moveTo(-240, -40).lineTo(240, -40).stroke({ width: 1, color: 0xffffff, alpha: 0.15 });
        g.moveTo(-240, 58).lineTo(240, 58).stroke({ width: 1, color: 0xffffff, alpha: 0.15 });
        this.resultsTitle.style.fontFamily = ts.font;
        this.resultsTitle.style.fontStyle = ts.italic ? 'italic' : 'normal';
        this.resultsBest.text = r.newBest ? '★ NEW BEST ★' : `BEST ${r.best.toLocaleString('en-US')}`;
        this.resultsBest.style.fill = r.newBest ? 0xffd34d : 0xbfb3d9;
        const vals = [r.wave, r.bestChain, r.bestCombo, r.coins];
        this.resultsStats.forEach((s) => (s.v.text = '0'));
        SUITS.forEach((s, i) => {
            const t = r.tiers[s];
            this.resultsSuits[i].text = `${SUIT_INFO[s].glyph} ${'●'.repeat(Math.min(t, 5))}${'○'.repeat(Math.max(0, 3 - t))}\n${SUIT_INFO[s].name} ${t}`;
            this.resultsSuits[i].alpha = t > 0 ? 1 : 0.4;
        });
        // Count-up: fire-and-forget (nothing awaits the results card).
        const o = { k: 0 };
        gsap.killTweensOf(this.resultsBox.scale);
        this.resultsBox.alpha = 1;
        const fit = Math.min(1, (this.w - 24) / 580, (this.h - 24) / 400);
        this.resultsBox.scale.set(fit * 0.7);
        gsap.to(this.resultsBox.scale, { x: fit, y: fit, duration: 0.45, ease: 'back.out(2)' });
        gsap.to(o, {
            k: 1,
            duration: 1.1,
            ease: 'power2.out',
            onUpdate: () => {
                this.resultsScore.text = Math.round(r.score * o.k).toLocaleString('en-US');
                this.resultsStats.forEach((s, i) => (s.v.text = String(Math.round(vals[i] * o.k))));
            },
        });
    }

    hideResults() {
        this.results.visible = false;
    }

    get resultsVisible(): boolean {
        return this.results.visible;
    }

    setCoach(text: string | null) {
        if (text) {
            if (this.coachText.text !== text) {
                this.coachText.text = text;
                this.coachBg.clear();
                const bw = this.coachText.width + 36;
                const bh = this.coachText.height + 18;
                this.coachBg.roundRect(-bw / 2, -bh / 2, bw, bh, 12).fill({ color: 0x07040f, alpha: 0.85 }).stroke({ width: 2, color: 0xffd34d, alpha: 0.8 });
            }
            this.coachWant = 1;
        } else this.coachWant = 0;
    }

    get coachLine(): string {
        return this.coachWant > 0 ? this.coachText.text : '';
    }

    setDemo(mode: 'off' | 'attract' | 'tour', caption: string) {
        this.demo.visible = mode !== 'off';
        if (mode === 'off') return;
        const tag = mode === 'tour' ? 'GUIDED TOUR  ·  ANY KEY TO PLAY' : 'DEMO  ·  ANY KEY TO PLAY';
        if (this.demoTag.text !== tag || this.demoCaption.text !== caption) {
            this.demoTag.text = tag;
            this.demoCaption.text = caption;
            const ch = caption ? this.demoCaption.height : 0;
            const boxW = Math.max(this.demoTag.width + 40, caption ? this.demoCaption.width + 36 : 0);
            const boxH = 26 + (caption ? ch + 16 : 0);
            // Local origin = bottom centre of the box.
            this.demoTag.y = -boxH + 13;
            this.demoCaption.y = -boxH + 30;
            const g = this.demoBg;
            g.clear();
            g.roundRect(-boxW / 2, -boxH, boxW, boxH, 12).fill({ color: 0x07040f, alpha: 0.86 }).stroke({ width: 1.5, color: 0xffd34d, alpha: 0.8 });
            g.roundRect(-boxW / 2, -boxH, boxW, 26, 12).fill({ color: 0xffd34d, alpha: 0.95 });
            g.rect(-boxW / 2, -boxH + 14, boxW, 12).fill({ color: 0xffd34d, alpha: 0.95 });
        }
        this.demo.position.set(this.w / 2, this.demoBottom);
    }

    /** Screen rect of the preset banner while it is showing (combat popups steer clear of it). */
    get bannerRect(): { x: number; y: number; w: number; h: number } | null {
        if (this.banner.alpha < 0.05) return null;
        const b = this.bannerBg.getBounds();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
    }

    /** Bounds of the overlays for the e2e overlap check (only the ones currently visible). */
    overlayReport() {
        const box = (c: Container) => {
            const b = c.getBounds();
            return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
        };
        const out: Record<string, { x: number; y: number; w: number; h: number }> = { 'top-hud': { x: 0, y: 0, w: Math.round(this.w), h: this.topH } };
        if (this.demo.visible && this.demo.alpha > 0.05) {
            out['tour-pill'] = box(this.demoTag);
            if (this.demoCaption.text) out['tour-caption'] = box(this.demoCaption);
        }
        const banner = this.bannerRect;
        if (banner) out['preset-banner'] = { x: Math.round(banner.x), y: Math.round(banner.y), w: Math.round(banner.w), h: Math.round(banner.h) };
        if (this.center.alpha > 0.05) out['center-popup'] = box(this.centerText);
        return out;
    }

    setStatus(muted: boolean, calm: boolean) {
        const parts: string[] = [];
        if (muted) parts.push('♪ MUTED (M)');
        if (calm) parts.push('CALM MODE (C)');
        this.chips.text = parts.join('   ');
    }

    get statusLine(): string {
        return this.chips.text;
    }

    update(world: World, pal: RealmPalette, dt: number, gyro: GyroStatus, gyroTilt: number) {
        const p = world.player;
        if (this.shownTheme !== world.theme) {
            this.shownTheme = world.theme;
            this.applyTitleStyle(world.theme);
        }
        this.shownScore += (world.score - this.shownScore) * Math.min(1, dt * 10);
        if (Math.abs(world.score - this.shownScore) < 1) this.shownScore = world.score;
        this.score.text = Math.round(this.shownScore).toLocaleString('en-US');
        this.waveText.text = `WAVE ${world.wave}   ×${world.multiplier.toFixed(2).replace(/\.?0+$/, '')}`;
        const shadow = p.realm === Realm.SHADOW_ALCHEMY;
        this.realmText.text = shadow ? '☾ SHADOW ALCHEMY' : '☉ SOLAR ORDER';
        this.realmText.style.fill = pal.accent;
        this.coach.alpha += (this.coachWant - this.coach.alpha) * Math.min(1, dt * 8);
        // The preset banner owns the screen while it shows: the tour caption steps aside.
        const demoWant = this.banner.alpha > 0.05 ? 0 : 1;
        this.demo.alpha += (demoWant - this.demo.alpha) * Math.min(1, dt * 12);
        if (demoWant === 0 && this.demo.alpha < 0.05) this.demo.alpha = 0;
        this.coach.scale.set(1 + (1 - world.beatPhase) ** 4 * 0.03 * this.coachWant);

        const phase = world.beatPhase;
        const beat = 1 - phase;
        // Combo (the demo caption owns that spot while a demo runs)
        if (world.combo >= 2 && !this.demo.visible) {
            this.comboText.text = `${world.combo}× ON-BEAT`;
            this.comboText.alpha = 1;
            this.comboText.style.fill = lerpColor(0xffffff, pal.accent, 0.6);
            this.comboText.scale.set((this.compact ? 0.8 : 1) * (1 + beat * beat * 0.12));
        } else this.comboText.alpha = 0;

        // Bars pick up the current realm accent: the frame reskins with the arena.
        this.topBar.clear();
        this.topBar.rect(0, 0, this.w, this.topH).fill({ color: lerpColor(0x07040f, pal.bg, 0.5), alpha: 0.8 });
        this.topBar.rect(0, this.topH - 2, this.w, 2).fill({ color: pal.accent, alpha: 0.35 + beat * beat * 0.3 });
        this.bottomBar.clear();
        this.bottomBar.rect(0, this.h - this.bottomH, this.w, this.bottomH).fill({ color: lerpColor(0x07040f, pal.bg, 0.5), alpha: 0.8 });
        this.bottomBar.rect(0, this.h - this.bottomH, this.w, 2).fill({ color: pal.accent, alpha: 0.35 + beat * beat * 0.3 });

        // Coin link
        const L = this.linkBar;
        L.clear();
        const segW = 90;
        for (let i = 0; i < COIN_TIERS.length; i++) {
            const tier = COIN_TIERS[i];
            const lo = i === 0 ? 0 : COIN_TIERS[i - 1].at;
            const fill = Math.max(0, Math.min(1, (world.linkCoins - lo) / (tier.at - lo)));
            const x = 2 + i * (segW + 5);
            L.roundRect(x, 8, segW, 20, 6).fill({ color: 0x1b1430, alpha: 1 });
            if (fill > 0) L.roundRect(x, 8, segW * fill, 20, 6).fill({ color: tier.color, alpha: 0.9 });
            L.roundRect(x, 8, segW, 20, 6).stroke({ width: 1.5, color: tier.color, alpha: fill >= 1 ? 1 : 0.5 });
            this.linkLabels[i].alpha = fill >= 1 ? 1 : 0.6;
        }
        this.linkCount.text = `${world.linkCoins} / ${GRAND_AT}`;

        // Two offices, one clock: Sofia (EET) and Malta (CET) hands driven by the same beat.
        const C = this.clock;
        C.clear();
        const handA = phase * Math.PI * 2 - Math.PI / 2;
        for (const [ox, hourOffset] of [[-28, 0], [28, -1]] as const) {
            C.circle(ox, 0, 17).fill({ color: 0x120a24 }).stroke({ width: 2, color: pal.accent, alpha: 0.5 + beat * beat * 0.5 });
            for (let i = 0; i < 12; i++) {
                const a = (i / 12) * Math.PI * 2;
                C.circle(ox + Math.cos(a) * 13, Math.sin(a) * 13, i % 3 ? 0.8 : 1.6).fill({ color: 0xffffff, alpha: 0.7 });
            }
            const hour = ((world.clock.beats / 4 + hourOffset) / 12) * Math.PI * 2 - Math.PI / 2;
            C.moveTo(ox, 0).lineTo(ox + Math.cos(hour) * 8, Math.sin(hour) * 8).stroke({ width: 2.5, color: 0xffffff });
            C.moveTo(ox, 0).lineTo(ox + Math.cos(handA) * 13, Math.sin(handA) * 13).stroke({ width: 1.5, color: pal.accent });
        }
        C.moveTo(-11, 0).lineTo(11, 0).stroke({ width: 1, color: pal.accent, alpha: 0.5 });

        // Beat bar: the perfect window is the bright zone in the middle.
        const B = this.beatBar;
        B.clear();
        const bw = 120;
        const win = (PERFECT_WINDOW / world.clock.period) * bw;
        B.roundRect(-bw / 2, 0, bw, 6, 3).fill({ color: 0xffffff, alpha: 0.12 });
        B.roundRect(-win, -1, win * 2, 8, 3).fill({ color: pal.accent, alpha: 0.35 + beat * beat * 0.5 });
        const off = ((phase + 0.5) % 1) - 0.5; // -0.5..0.5, 0 = on beat
        B.circle(off * bw, 3, 5).fill({ color: 0xffffff });
        const cd = p.shiftCd / world.stats.shiftCooldown;
        if (cd > 0) B.roundRect(-bw / 2, 9, bw * (1 - cd), 2, 1).fill({ color: pal.accent, alpha: 0.7 });
        this.beatLabel.text = `ONE CLOCK · ${Math.round(world.clock.bpm)} BPM`;

        // Gyro / phone link
        const G = this.gyroDot;
        G.clear();
        const gc = gyro === 'linked' ? 0x5dff7a : gyro === 'waiting' ? 0xffd34d : 0x6a6080;
        G.circle(0, 0, 5).fill(gc);
        if (gyro === 'linked') G.circle(0, 0, 8 + beat * 3).stroke({ width: 1.5, color: gc, alpha: 0.6 });
        this.gyroText.text = gyro === 'linked' ? 'PHONE LINKED' : 'PHONE';
        this.gyroSub.text = gyro === 'linked' ? `tilt aim ${Math.round((gyroTilt * 180) / Math.PI)}°` : gyro === 'waiting' ? 'waiting for phone' : 'relay offline';
        this.gyroText.style.fill = gc;
        this.gyroSub.style.fill = gc;
        this.phoneUrl.visible = !this.compact && gyro !== 'linked' && this.phoneUrl.text !== '' && !this.title.visible;
        this.phoneBg.visible = this.phoneUrl.visible;

        // Vitality: heart-flasks that crack when emptied, plus a glowing shield bar.
        const H = this.hpGfx;
        H.clear();
        const cell = this.compact ? 20 : 23;
        const sc = this.compact ? 0.82 : 0.95;
        if (this.lastHp >= 0 && p.hp < this.lastHp) for (let i = p.hp; i < this.lastHp; i++) this.crackT[i] = 0.55;
        this.lastHp = p.hp;
        this.flaskIcons.forEach((f, i) => {
            f.visible = i < world.stats.maxHp;
            if (!f.visible) return;
            const full = i < p.hp;
            const ct = (this.crackT[i] = Math.max(0, this.crackT[i] - dt));
            f.texture = full ? this.tex.heartFull : this.tex.heartEmpty;
            const shake = ct > 0 ? Math.sin(ct * 80) * 3 * (ct / 0.55) : 0;
            f.position.set(i * cell + 10 + shake, 13);
            f.scale.set(sc * (1 + (ct > 0.4 ? (ct - 0.4) * 3 : 0)));
            f.tint = ct > 0 ? lerpColor(0xffffff, 0xff3048, ct / 0.55) : 0xffffff;
            f.alpha = full ? 1 : 0.75;
            if (ct > 0) {
                // shards flying off the cracked flask
                const k = 1 - ct / 0.55;
                for (let s2 = 0; s2 < 4; s2++) {
                    const a = -Math.PI / 2 + (s2 - 1.5) * 0.7;
                    H.circle(i * cell + 10 + Math.cos(a) * 16 * k, 13 + Math.sin(a) * 16 * k, 1.6 * (1 - k)).fill({ color: 0xffd0dc, alpha: 1 - k });
                }
            }
        });
        const shieldW = world.stats.maxHp * cell - 4;
        const sy = this.compact ? 28 : 31;
        const sf = (shieldW * p.shield) / world.stats.shieldMax;
        H.roundRect(0, sy, shieldW, 4, 2).fill({ color: 0x1b2a3a });
        if (sf > 0) {
            H.roundRect(-2, sy - 2, sf + 4, 8, 4).fill({ color: 0x9dfcff, alpha: 0.18 + beat * beat * 0.12 });
            H.roundRect(0, sy, sf, 4, 2).fill({ color: 0x9dfcff });
        }

        // Theme buttons
        for (const b of this.buttons) {
            const active = b.theme === world.theme;
            const bw = b.w;
            const own = SKINS[b.theme].SOLAR_ORDER.accent;
            b.bg.clear();
            const r = TAB_H / 2;
            b.bg.roundRect(-bw / 2, -r, bw, TAB_H, r).fill({ color: active ? pal.accent : 0x140e26, alpha: active ? 0.95 : 0.85 });
            b.bg.roundRect(-bw / 2, -r, bw, TAB_H, r).stroke({ width: active ? 2 : 1, color: active ? 0xffffff : own, alpha: active ? 0.9 : 0.4 });
            b.bg.circle(-bw / 2 + 14, 0, 9).fill({ color: active ? 0x07040f : own, alpha: active ? 1 : 0.85 });
            b.key.style.fill = active ? pal.accent : 0x07040f;
            b.label.style.fill = active ? 0x07040f : 0xd8d0f0;
            b.label.y = 0;
        }

        // Theme widget (bottom right)
        const Wd = this.widget;
        Wd.clear();
        for (const f of this.flasks) f.visible = false;
        if (world.theme === Theme.CHAIN_OVERLOAD) {
            const v = world.instability / 100;
            const col = v < 0.6 ? 0xffd34d : v < 0.85 ? 0xff8a2e : 0xff3048;
            this.widgetText.text = `INSTABILITY ${Math.round(world.instability)}%  ·  SHIFT TO VENT`;
            Wd.roundRect(0, 0, 250, 14, 5).fill({ color: 0x1b1430 });
            Wd.roundRect(0, 0, 250 * v, 14, 5).fill({ color: col, alpha: 0.6 + (v > 0.85 ? Math.sin(world.time * 30) * 0.4 : 0) });
            Wd.roundRect(0, 0, 250, 14, 5).stroke({ width: 1.5, color: col });
        } else if (world.theme === Theme.ALCHEMY_CRAFT) {
            this.widgetText.text = `CATALYSTS ${world.catalystCount}/3`;
            world.catalysts.forEach((c, i) => {
                this.flasks[i].visible = true;
                this.flasks[i].alpha = c.collected ? 1 : 0.25;
            });
        } else if (world.theme === Theme.TIME_ECHO) {
            const n = world.echoes.filter((e) => e.active).length;
            this.widgetText.text = `ECHOES ${n}/3  ·  SWITCHES ${world.switches.filter((s) => s.held).length}/2`;
            for (let i = 0; i < 3; i++) Wd.circle(10 + i * 26, 12, 8).fill({ color: i < n ? 0x9dfcff : 0x1b1430 }).stroke({ width: 1.5, color: 0x9dfcff });
        } else if (world.theme === Theme.SHADOW_LENS) {
            this.widgetText.text = `LENS ${Math.round((((world.lensAngle * 180) / Math.PI) % 360 + 360) % 360)}° · FLARE ${world.lensFlareCd > 0 ? '...' : 'READY'}`;
            Wd.circle(14, 14, 12).stroke({ width: 1.5, color: 0xb98cff });
            Wd.moveTo(14, 14).lineTo(14 + Math.cos(world.lensAngle) * 12, 14 + Math.sin(world.lensAngle) * 12).stroke({ width: 2.5, color: 0xffffff });
        } else {
            this.widgetText.text = `SWITCHES ${world.switches.filter((s) => s.held).length}/2  ·  BEST COMBO ${world.bestCombo}`;
        }
        this.widgetText.style.fill = 0xe8e0ff;
    }
}
