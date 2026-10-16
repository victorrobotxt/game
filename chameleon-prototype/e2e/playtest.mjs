#!/usr/bin/env node
/**
 * Live-browser E2E playtest. Starts Vite, launches headless Chromium with SwiftShader WebGL,
 * actually plays the game through real keyboard/mouse input, drives the phone controller in a
 * second browser context, asserts zero page/console errors, and saves 1280x720 screenshots.
 *
 *   npm run e2e                      # starts its own Vite on :5199
 *   E2E_URL=http://localhost:5173 npm run e2e   # reuse a running dev server
 *   HEADED=1 npm run e2e             # watch it play
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shots = resolve(root, 'screenshots');
mkdirSync(shots, { recursive: true });

const results = [];
let failures = 0;
const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- dev server
let vite = null;
let base = process.env.E2E_URL;
if (!base) {
    const port = 5199;
    base = `http://localhost:${port}`;
    // Run vite's JS entry directly (not via npx) so kill() reaches the real server process.
    vite = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' } });
    vite.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
    for (let i = 0; i < 100; i++) {
        try {
            if ((await fetch(base)).ok) break;
        } catch {
            /* not up yet */
        }
        await sleep(150);
    }
}
console.log(`dev server: ${base}`);

// Default: real GPU through ANGLE/OpenGL (hits 60 FPS headless). E2E_GL=swiftshader forces the
// CPU rasteriser for GPU-less CI boxes; it renders correctly but only manages ~25 FPS.
const swiftshader = process.env.E2E_GL === 'swiftshader';
const glArgs = swiftshader
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'];
const minFps = Number(process.env.E2E_MIN_FPS ?? (swiftshader ? 20 : 55));
const browser = await chromium.launch({
    headless: !process.env.HEADED,
    args: [...glArgs, '--autoplay-policy=no-user-gesture-required'],
});
console.log(`GL backend: ${swiftshader ? 'SwiftShader (software)' : 'ANGLE/OpenGL (hardware)'}`);

const errors = [];
const warnings = [];
const watch = (page, tag) => {
    page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
    page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`[${tag}] console.error: ${m.text()}`);
        if (m.type() === 'warning') warnings.push(`[${tag}] console.warn: ${m.text().slice(0, 200)}`);
    });
};

try {
    const game = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
    watch(game, 'game');
    await game.goto(`${base}/?seed=42`);
    await game.waitForFunction(() => !!window.__GAME_DEBUG__, null, { timeout: 30_000 });
    const snap = () => game.evaluate(() => window.__GAME_DEBUG__.snapshot());
    const dbg = (fn, ...args) => game.evaluate(([f, a]) => window.__GAME_DEBUG__[f](...a), [fn, args]);
    const waitFor = (pred, timeout = 8000) => game.waitForFunction(pred, null, { timeout, polling: 50 });
    const hold = async (key, ms) => {
        await game.keyboard.down(key);
        await sleep(ms);
        await game.keyboard.up(key);
    };
    const shot = (name) => game.screenshot({ path: resolve(shots, name) });
    /** Shifts outside the GOOD window lock shifting for 1.25 s, so time them like a player would. */
    const onBeat = async (pg = game) => {
        const ms = await pg.evaluate(() => window.__GAME_DEBUG__.snapshot().toBeatMs);
        await sleep(Math.max(0, ms - 25));
    };
    /** A cleared wave auto-opens the draft (world paused). Play through it like a user would. */
    const ensurePlaying = async () => {
    // Increase the stabilization sleep from 1100ms to 1500ms so wave-clear auto-drafts trigger before returning
    for (let i = 0; i < 30; i++) {
        if ((await snap()).flow === 'PLAYING') {
            await sleep(1500);
            if ((await snap()).flow === 'PLAYING') return;
        } else {
            await game.keyboard.press('Space');
            await sleep(250);
        }
    }
};

    // ------------------------------------------------------------ 1. boot + renderer health
    await sleep(1200);
    let s = await snap();
    check('PixiJS v8 initialised on WebGL', s.renderer === 'webgl', `renderer=${s.renderer}`);
    check('canvas present at 1280x720', await game.evaluate(() => {
        const c = document.querySelector('canvas');
        return !!c && c.clientWidth === 1280 && c.clientHeight === 720;
    }));
    const px = await dbg('samplePixels');
    check('rendered frame is non-blank', px.uniqueColors > 60 && px.litFraction > 0.015, `${px.uniqueColors} colours, ${(px.litFraction * 100).toFixed(0)}% lit`);
    const measured = await game.evaluate(
        () =>
            new Promise((done) => {
                let n = 0;
                const start = performance.now();
                const tick = () => {
                    n++;
                    if (performance.now() - start < 2000) requestAnimationFrame(tick);
                    else done((n * 1000) / (performance.now() - start));
                };
                requestAnimationFrame(tick);
            }),
    );
    s = await snap();
    check(`frame rate >= ${minFps} FPS`, measured >= minFps, `rAF ${measured.toFixed(1)} fps, in-game ${s.fps} fps`);
    check('boots into the TITLE screen (two clocks, PRESS SPACE)', s.flow === 'TITLE' && s.title && s.wave === 0, `flow=${s.flow}`);
    await shot('00-title-screen.png');
    await game.keyboard.press('Space');
    await sleep(300);
    s = await snap();
    check('SPACE on the title starts wave 1 in PLAYING', s.flow === 'PLAYING' && s.wave === 1 && !s.title);
    check('first-wave coach teaches the shift', /SPACE shifts realm/.test(s.coach), s.coach);
    const notes0 = s.musicNotes;
    await sleep(1000);
    s = await snap();
    check('procedural music is sequenced on the beat clock', s.audioReady && s.musicNotes > notes0 + 4, `${s.musicNotes - notes0} notes/s at ${s.bpm} BPM`);

    // ------------------------------------------------------------ 2. movement + solar combat + chain reaction
    await dbg('godMode', true);
    const p0 = (await snap()).player;
    await hold('KeyD', 450);
    await hold('KeyW', 300);
    const p1 = (await snap()).player;
    check('keyboard moves the alchemist', p1.x > p0.x + 40 && p1.y < p0.y - 20, `(${p0.x.toFixed(0)},${p0.y.toFixed(0)}) -> (${p1.x.toFixed(0)},${p1.y.toFixed(0)})`);
    await dbg('teleport', 520, 300);
    await sleep(1600); // let wave 1 close in
    const scoreBefore = (await snap()).score;
    await dbg('spawnChain');
    await sleep(380);
    await shot('01-solar-realm-combat.png');
    await sleep(900);
    s = await snap();
    check('chain reaction scored across realms', s.score > scoreBefore + 500, `score ${scoreBefore} -> ${s.score}`);
    await sleep(1600);
    s = await snap();
    // (A coin dropped AFTER the chain by an unrelated kill may still be on the floor; it is young.)
    check('a finished chain vacuums its coins to the player', s.entities.oldCoins === 0 && s.totalCoins >= 8 && s.bestChain >= 3, `old coins left ${s.entities.oldCoins}, collected ${s.totalCoins}, best chain ${s.bestChain}`);
    check('particle + label pools stay within capacity', s.pools.particles.inUse <= 250 && s.pools.labels.inUse <= 40, JSON.stringify(s.pools));

    await ensurePlaying();
    // ------------------------------------------------------------ 3. SPACE realm shift
    const realmBefore = s.realm;
    await onBeat();
    await game.keyboard.press('Space');
    await sleep(60);
    s = await snap();
    check('SPACE shifts realm', s.realm !== realmBefore && s.realm === 'SHADOW_ALCHEMY', `${realmBefore} -> ${s.realm}`);
    check('coach moves on to the lure trick after the first shift', s.coach === '' || /runes|rune is flashing|PERFECT combo/.test(s.coach), s.coach);
    await game.keyboard.press('Space'); // inside cooldown: must be ignored, not queued
    await sleep(40);
    check('shift spam inside cooldown is ignored', (await snap()).realm === 'SHADOW_ALCHEMY');
    await dbg('spawnChain');
    await sleep(320);
    await shot('02-shadow-realm-shift.png');
    s = await snap();
    check('palette interpolated to SHADOW_ALCHEMY', s.realmBlend > 0.9, `blend=${s.realmBlend.toFixed(2)}`);

    await ensurePlaying();
    // ------------------------------------------------------------ 4. Theme presets via keys 1-5 and HUD buttons
    const themes = ['PARALLEL_SYNC', 'CHAIN_OVERLOAD', 'ALCHEMY_CRAFT', 'TIME_ECHO', 'SHADOW_LENS'];
    let keysOk = true;
    for (let i = 1; i <= 5; i++) {
        await game.keyboard.press(`Digit${i}`);
        await sleep(120);
        if ((await snap()).theme !== themes[i - 1]) keysOk = false;
    }
    check('keys 1-5 hot-swap all theme presets', keysOk);
    // Each preset must LOOK and SOUND like a different game: own palette/floor and own tempo.
    const looks = [];
    const tempos = new Set();
    for (let i = 1; i <= 5; i++) {
        await game.keyboard.press(`Digit${i}`);
        await sleep(900); // skin crossfade is 0.6 s
        looks.push((await dbg('samplePixels')).avg);
        tempos.add((await snap()).bpm);
    }
    let minDist = Infinity;
    for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) minDist = Math.min(minDist, looks[a].reduce((d, v, k) => d + Math.abs(v - looks[b][k]), 0));
    check('each preset reskins the arena (distinct rendered palettes)', minDist >= 5, `avg RGB ${looks.map((l) => l.join('/')).join('  ')}; min distance ${minDist}`);
    check('each preset has its own tempo', tempos.size === 5, [...tempos].join(', ') + ' BPM');
    await game.keyboard.press('KeyC');
    await sleep(50);
    s = await snap();
    const calmOn = s.calm && /CALM/.test(s.status);
    await game.keyboard.press('KeyM');
    await sleep(50);
    s = await snap();
    const muteOn = s.muted && /MUTED/.test(s.status);
    await game.keyboard.press('KeyC');
    await game.keyboard.press('KeyM');
    await sleep(50);
    s = await snap();
    check('C toggles calm mode and M mute, both shown on the HUD', calmOn && muteOn && !s.calm && !s.muted && s.status === '', `status now "${s.status}"`);
    await ensurePlaying();
    const targets = await dbg('hitTargets');
    let clickOk = true;
    for (const i of [2, 3, 1]) {
        const t = targets.themes[i - 1];
        await game.mouse.click(t.x, t.y);
        await sleep(120);
        if ((await snap()).theme !== themes[i - 1]) clickOk = false;
    }
    check('HUD theme buttons are clickable', clickOk);

    // CHAIN_OVERLOAD vent + ALCHEMY_CRAFT smoke
    await game.keyboard.press('Digit2');
    await sleep(2500);
    await ensurePlaying();
    const inst = (await snap()).score;
    await onBeat();
    await game.keyboard.press('Space');
    await sleep(100);
    check('CHAIN_OVERLOAD: shifting vents instability for score', (await snap()).score > inst);

    await ensurePlaying();
    // ------------------------------------------------------------ 5. TIME_ECHO ghosts
    await game.keyboard.press('Digit4');
    await sleep(1200);
    await ensurePlaying();
    await dbg('teleport', 360, 440);
    const sw = await dbg('switches');
    await hold('KeyD', 900);
    await hold('KeyW', 500);
    await onBeat();
    await game.keyboard.press('Space');
    await hold('KeyA', 500);
    await hold('KeyS', 400);
    await onBeat();
    await game.keyboard.press('Space');
    await game.keyboard.down('KeyD');
    await sleep(500);
    await dbg('spawnChain');
    await sleep(250);
    await shot('03-time-echo-ghosts.png');
    await game.keyboard.up('KeyD');
    s = await snap();
    check('TIME_ECHO spawns recorded ghosts', s.entities.echoes >= 2, `echoes=${s.entities.echoes}`);
    check('TIME_ECHO switches exist', sw.length === 2);

    await ensurePlaying();
    // ------------------------------------------------------------ 6. phone controller bridge + SHADOW_LENS
    await game.keyboard.press('Digit5');
    await dbg('teleport', 420, 300);
    await sleep(2300); // let the theme banner fade so the lens shot is unobstructed
    const phoneCtx = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: true, isMobile: false });
    // Record vibrations instead of buzzing: proves the game -> phone haptic path end to end.
    await phoneCtx.addInitScript(() => {
        window.__vibes = [];
        navigator.vibrate = (p) => (window.__vibes.push(p), true);
    });
    const phone = await phoneCtx.newPage();
    watch(phone, 'phone');
    await phone.goto(`${base}/controller.html`);
    await phone.waitForFunction(() => document.getElementById('statusText')?.textContent?.startsWith('LINKED'), null, { timeout: 8000 });
    await waitFor(() => window.__GAME_DEBUG__.snapshot().gyro.status === 'linked');
    check('game HUD shows phone linked', (await snap()).gyro.status === 'linked');

    const tilt = (beta, gamma) =>
        phone.evaluate(([b, g]) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: b, gamma: g })), [beta, gamma]);
    await ensurePlaying();
    let lensOk = true;
    const angles = [];
    for (const [beta, gamma] of [[0, 30], [25, 25], [-30, -10], [20, -30]]) {
        await tilt(beta, gamma);
        const want = Math.atan2(beta, gamma);
        try {
            await game.waitForFunction(
                (w) => {
                    const st = window.__GAME_DEBUG__.snapshot();
                    return st.lensSource === 'gyro' && Math.abs(Math.atan2(Math.sin(st.lensAngle - w), Math.cos(st.lensAngle - w))) < 0.02;
                },
                want,
                { timeout: 2000, polling: 30 },
            );
            angles.push(((want * 180) / Math.PI).toFixed(0));
        } catch {
            lensOk = false;
        }
    }
    check('gyro tilt packets steer SHADOW_LENS in real time', lensOk, `angles ${angles.join('°, ')}°`);
    await ensurePlaying();
    // Aim at a hidden shadow rune and prove the lens reveals it.
    const hz = (await dbg('hazards')).filter((h) => h.realm === 'SHADOW_ALCHEMY');
    const me = (await snap()).player;
    const target = hz.reduce((a, b) => (Math.hypot(a.x - me.x, a.y - me.y) < Math.hypot(b.x - me.x, b.y - me.y) ? a : b));
    const ang = Math.atan2(target.y - me.y, target.x - me.x);
    await tilt(Math.sin(ang) * 30, Math.cos(ang) * 30);
    await sleep(250);
    const revealed = (await dbg('hazards')).filter((h) => h.realm === 'SHADOW_ALCHEMY' && h.revealed).length;
    check('lens reveals hidden shadow runes only inside the cone', revealed >= 1 && revealed < hz.length, `${revealed}/${hz.length} revealed at ${((ang * 180) / Math.PI).toFixed(0)}°`);
    await dbg('spawnChain');
    await sleep(2400); // the chain clears the wave; the auto-draft opens ~0.9s later
    await ensurePlaying();
    await sleep(2300); // let the WAVE popup and perk label fade
    // joystick on the phone moves the player
    await ensurePlaying();
    const pad = await phone.locator('#pad').boundingBox();
    const before = (await snap()).player;
    await phone.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
    await phone.mouse.down();
    await phone.mouse.move(pad.x + pad.width * 0.95, pad.y + pad.height * 0.35, { steps: 4 });
    await sleep(300);
    await dbg('spawnChain');
    await sleep(350);
    await shot('04-shadow-lens-gyro.png');
    await phone.screenshot({ path: resolve(shots, '06-mobile-controller-ui.png') });
    await phone.mouse.up();
    const after = (await snap()).player;
    check('phone joystick moves the player', after.x > before.x + 30, `dx=${(after.x - before.x).toFixed(0)}`);

    await ensurePlaying();
    // phone SHIFT button -> realm shift (in PARALLEL_SYNC)
    await game.keyboard.press('Digit1');
    await sleep(500);
    const r0 = (await snap()).realm;
    await onBeat();
    await phone.locator('#shift').dispatchEvent('pointerdown');
    await game.waitForFunction((r) => window.__GAME_DEBUG__.snapshot().realm !== r, r0, { timeout: 2000 }).catch(() => {});
    check('phone SHIFT REALM button shifts the realm', (await snap()).realm !== r0);
    check('gyro packets streamed at ~30 Hz', (await snap()).gyro.packets > 30, `${(await snap()).gyro.packets} packets`);

    // Two-way link: the phone wears the current realm's colours and vibrates when you are hit.
    await ensurePlaying();
    await phone.waitForFunction(() => document.body.dataset.mode === 'play', null, { timeout: 3000 }).catch(() => {});
    const phoneLook = () => phone.evaluate(() => ({ mode: document.body.dataset.mode, realm: document.body.dataset.realm, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), label: document.getElementById('shiftLabel').textContent }));
    await sleep(400);
    const look1 = await phoneLook();
    s = await snap();
    check('phone mirrors the game (mode, realm, button label)', look1.mode === 'play' && look1.realm === s.realm && look1.label === 'SHIFT REALM', JSON.stringify(look1));
    await sleep(1300); // clear any lockout from the phone-button shift
    await onBeat();
    await game.keyboard.press('Space');
    await sleep(500);
    const look2 = await phoneLook();
    check('phone takes on the new realm colours after a shift', look2.realm !== look1.realm && look2.accent !== look1.accent, `${look1.accent} -> ${look2.accent}`);
    await dbg('hurt', 1);
    await phone.waitForFunction(() => window.__vibes.some((v) => Array.isArray(v) && v.length === 3), null, { timeout: 2000 }).catch(() => {});
    check('getting hit vibrates the phone', await phone.evaluate(() => window.__vibes.some((v) => Array.isArray(v) && v.length === 3)), JSON.stringify(await phone.evaluate(() => window.__vibes.slice(-3))));

    await ensurePlaying();
    // ------------------------------------------------------------ 7. Jackpot Cards draft (J) — click flips, SPACE slam-stop, SPACE skip
    const tiersBefore = (await snap()).tiers;
    await game.keyboard.press('KeyJ');
    await waitFor(() => window.__GAME_DEBUG__.snapshot().flow === 'DRAFT');
    check('J opens the Jackpot Cards draft', true);
    await waitFor(() => window.__GAME_DEBUG__.snapshot().draft === 'PICKING', 5000);
    await sleep(300);
    check('phone button turns into SLAM STOP during the draft', (await phoneLook()).label === 'SLAM STOP', (await phoneLook()).label);
    const cards = (await dbg('hitTargets')).cards;
    // Regression: a faded (alpha 0) award banner from the previous draft used to eat clicks on row 2.
    const hits = await Promise.all(cards.map((c) => dbg('hitTest', c.x, c.y)));
    const blocked = hits.flatMap((h, i) => (h[0]?.endsWith(`#card-${i}`) ? [] : [`${i}:${h[0]}`]));
    check('all 12 cards are pointer targets on a reused draft', blocked.length === 0, blocked.join(' '));
    for (const i of [0, 5]) {
        await game.mouse.click(cards[i].x, cards[i].y);
        await sleep(330);
    }
    s = await snap();
    check('clicking cards flips them', s.draftFlips === 2, `flips=${s.draftFlips} revealed=${s.draftRevealed} draft=${s.draft} targets=${JSON.stringify([cards[0], cards[5]])}`);
    await game.keyboard.press('Space'); // STOP -> auto-reveal
    await sleep(120);
    check('SPACE slam-stops into auto-reveal', ['REVEALING', 'AWARDING'].includes((await snap()).draft), (await snap()).draft);
    const tSkip = Date.now();
    await game.keyboard.press('Space'); // SKIP -> fast-forward
    await waitFor(() => window.__GAME_DEBUG__.snapshot().draft === 'AWARDING', 3000);
    check('SPACE skip fast-forwards the reveal', Date.now() - tSkip < 1500, `${Date.now() - tSkip}ms`);
    await sleep(700);
    await shot('05-jackpot-cards-draft.png');
    s = await snap();
    check('a suit tripled', !!s.draftMatched && s.draftFlips <= 9, `${s.draftMatched} after ${s.draftFlips} flips`);
    await game.keyboard.press('Space');
    await waitFor(() => window.__GAME_DEBUG__.snapshot().flow === 'PLAYING', 4000);
    s = await snap();
    const gained = Object.keys(s.tiers).filter((k) => s.tiers[k] > tiersBefore[k]);
    check('draft awards a permanent roguelike tier and returns to combat', gained.length === 1 && s.flow === 'PLAYING', `+${gained.join(',')}`);

    // ------------------------------------------------------------ 8. abuse: open draft and hammer SPACE
    await game.keyboard.press('KeyJ');
    for (let i = 0; i < 40; i++) await game.keyboard.press('Space', { delay: 5 });
    await waitFor(() => window.__GAME_DEBUG__.snapshot().flow === 'PLAYING', 8000).catch(() => {});
    check('SPACE spam through a whole draft never soft-locks', (await snap()).flow === 'PLAYING', (await snap()).draft);

    await ensurePlaying();
    // ------------------------------------------------------------ 9. Golden coins + cameos
    await dbg('giveCoins', 20);
    await waitFor(() => window.__GAME_DEBUG__.snapshot().flow === 'DRAFT', 6000).catch(() => {});
    check('20 golden coins fill GRAND and trigger the draft', (await snap()).draftReason === 'GRAND');
    for (let i = 0; i < 6 && (await snap()).flow !== 'PLAYING'; i++) {
        await game.keyboard.press('Space');
        await sleep(400);
    }
    for (const k of ['SHINING_CROWN', 'FROG_FAMILIAR', 'RED_SEVEN_BOMB']) await dbg('spawnPowerUp', k);
    await dbg('spawnChain');
    await sleep(1500);
    s = await snap();
    check('cameo power-ups run (frog familiar active)', s.entities.frog === true);

    // ------------------------------------------------------------ 10. results card, guided tour, attract mode
    await ensurePlaying();
    await dbg('hurt', 30);
    await waitFor(() => window.__GAME_DEBUG__.snapshot().flow === 'GAME_OVER', 3000).catch(() => {});
    await sleep(1400); // count-up finishes
    s = await snap();
    check('dying shows the results card (best chain, combo, coins, suit tiers)', s.flow === 'GAME_OVER' && s.results, `flow=${s.flow} bestChain=${s.bestChain} coins=${s.totalCoins}`);
    await shot('07-results-card.png');
    await game.keyboard.press('Space');
    await sleep(300);
    s = await snap();
    check('SPACE on the results card rewinds into a fresh run', s.flow === 'PLAYING' && s.wave === 1 && !s.results && s.score === 0);
    await game.keyboard.press('Escape');
    await sleep(200);
    check('ESC returns to the title screen', (await snap()).flow === 'TITLE');
    await game.keyboard.press('KeyT');
    await sleep(3000);
    const tourP0 = (await snap()).player;
    // Sample every overlay through two preset announcements (14 s, and the start): nothing may collide.
    const rectHit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const overlayClashes = new Set();
    let samples = 0;
    let withBanner = 0;
    let withCaption = 0;
    const tEnd = Date.now() + 12_500;
    while (Date.now() < tEnd) {
        const r = await dbg('overlayReport');
        samples++;
        if (r['preset-banner']) withBanner++;
        if (r['tour-caption']) withCaption++;
        const keys = ['top-hud', 'tour-pill', 'tour-caption', 'preset-banner', 'center-popup'].filter((k) => r[k]);
        for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) if (rectHit(r[keys[i]], r[keys[j]])) overlayClashes.add(`${keys[i]}×${keys[j]}`);
        if (r['preset-banner']) for (const k of Object.keys(r)) if (k.startsWith('label-') && rectHit(r[k], r['preset-banner'])) overlayClashes.add(`${k.split(':')[1]}×preset-banner`);
        await sleep(150);
    }
    check('guided tour: zero overlap between tour pill/caption, preset banner, popups and top HUD', overlayClashes.size === 0 && withBanner > 3 && withCaption > 10, `${samples} samples (${withBanner} with banner, ${withCaption} with caption) ${[...overlayClashes].join(', ')}`);
    s = await snap();
    check('T starts the 60 s guided tour: bot plays, captions, presets change on cue', s.demo === 'tour' && s.theme === 'CHAIN_OVERLOAD' && s.score > 0 && s.demoCaption.includes('CHAIN OVERLOAD') && Math.hypot(s.player.x - tourP0.x, s.player.y - tourP0.y) > 5, `demo=${s.demo} theme=${s.theme} score=${s.score}`);
    await shot('08-guided-tour.png');
    await game.keyboard.press('KeyX');
    await sleep(300);
    s = await snap();
    check('any key hands control back (title, theme restored)', s.demo === 'off' && s.flow === 'TITLE' && s.theme === 'PARALLEL_SYNC', `demo=${s.demo} flow=${s.flow} theme=${s.theme}`);
    await dbg('startDemo', 'attract');
    const atP0 = (await snap()).player;
    await sleep(2500);
    s = await snap();
    check('attract mode: the bot plays by itself', s.demo === 'attract' && s.flow === 'PLAYING' && s.lensSource === 'bot' && Math.hypot(s.player.x - atP0.x, s.player.y - atP0.y) > 20, `moved ${Math.hypot(s.player.x - atP0.x, s.player.y - atP0.y).toFixed(0)}px`);
    await game.mouse.click(640, 360);
    await sleep(300);
    check('a click also ends the demo', (await snap()).demo === 'off');
    await game.keyboard.press('Space');
    await sleep(300);

    // ------------------------------------------------------------ 11. narrow screens: phone portrait + small laptop
    const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const [vw, vh, file] of [[375, 667, '09-narrow-375x667.png'], [900, 500, '10-small-900x500.png']]) {
        const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, isMobile: vw < 500, hasTouch: vw < 500, deviceScaleFactor: vw < 500 ? 2 : 1 });
        const pg = await ctx.newPage();
        watch(pg, `${vw}px`);
        await pg.goto(`${base}/?seed=3`);
        await pg.waitForFunction(() => !!window.__GAME_DEBUG__, null, { timeout: 30_000 });
        await pg.evaluate(() => window.__GAME_DEBUG__.godMode(true)); // layout check, not a survival test
        await sleep(800);
        if (vw < 500) {
            await pg.screenshot({ path: resolve(shots, '09-narrow-375x667-title.png') });
            const tr = await pg.evaluate(() => window.__GAME_DEBUG__.layoutReport());
            const tm = tr.hud.titleMain;
            // Portrait: the title owns the full width (the rotated arena is narrower than it).
            const padL = tm.x - 12;
            const padR = vw - 12 - (tm.x + tm.w);
            check('375 px title keeps >= 24 px padding inside its 12 px screen margin', padL >= 24 && padR >= 24, `left ${Math.round(padL)} px, right ${Math.round(padR)} px`);
            await pg.tap('canvas', { position: { x: vw / 2, y: vh / 2 } });
        } else await pg.keyboard.press('Space');
        await sleep(2600);
        const st = await pg.evaluate(() => window.__GAME_DEBUG__.snapshot());
        const rep = await pg.evaluate(() => window.__GAME_DEBUG__.layoutReport());
        const problems = [];
        const parts = Object.entries(rep.hud.parts);
        for (const [k, b] of parts) if (b.x < 0 || b.y < 0 || b.x + b.w > vw + 1 || b.y + b.h > vh + 1 || b.w <= 0) problems.push(`${k} off-screen ${JSON.stringify(b)}`);
        for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (overlap(parts[i][1], parts[j][1])) problems.push(`${parts[i][0]}×${parts[j][0]}`);
        rep.hud.buttons.forEach((b, i) => {
            if (b.w < 40 || b.x < 0 || b.x + b.w > vw + 1) problems.push(`button ${i + 1} ${JSON.stringify(b)}`);
            if (b.labelW > b.w - 20) problems.push(`button ${i + 1} label overflows`);
            if (i > 0 && b.x < rep.hud.buttons[i - 1].x + rep.hud.buttons[i - 1].w) problems.push(`buttons ${i}/${i + 1} overlap`);
        });
        const a = rep.arena;
        if (a.x < 0 || a.x + a.w > vw + 1 || a.y < rep.hud.topH || a.y + a.h > vh - rep.hud.bottomH + 1) problems.push(`arena ${JSON.stringify(a)}`);
        check(`${vw}x${vh}: tap/SPACE starts, HUD fits with no overlaps`, st.flow === 'PLAYING' && problems.length === 0, problems.slice(0, 4).join('; ') || `compact=${rep.hud.compact} arena ${Math.round(a.w)}x${Math.round(a.h)}`);
        if (vw < 500) {
            const t = await pg.evaluate(() => window.__GAME_DEBUG__.hitTargets().themes[1]);
            await pg.tap('canvas', { position: t });
            await sleep(200);
            check('375 px: theme buttons are tappable', (await pg.evaluate(() => window.__GAME_DEBUG__.snapshot())).theme === 'CHAIN_OVERLOAD');
            await sleep(1900);
        }
        await pg.screenshot({ path: resolve(shots, file) });
        await ctx.close();
    }

    // ------------------------------------------------------------ 12. iPhone: portrait 390x844 (multi-touch, no selection), landscape lock
    {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
        const pg = await ctx.newPage();
        watch(pg, 'iphone');
        await pg.goto(`${base}/?seed=8&tutorial=0`);
        await pg.waitForFunction(() => !!window.__GAME_DEBUG__, null, { timeout: 30_000 });
        const pdbg = (fn, ...args) => pg.evaluate(([f, a]) => window.__GAME_DEBUG__[f](...a), [fn, args]);
        const psnap = () => pdbg('snapshot');
        await sleep(600);
        // No iOS selection / callout / context menu on the game surface.
        const sel = await pg.evaluate(() => {
            const c = document.querySelector('canvas');
            const cs = getComputedStyle(c);
            // Chromium drops the iOS-only -webkit-touch-callout from the CSSOM, so read the source.
            const rules = [...document.querySelectorAll('style')].map((st) => st.textContent).join('\n');
            const fire = (type) => c.dispatchEvent(new Event(type, { cancelable: true, bubbles: true }));
            return {
                userSelect: cs.userSelect || cs.webkitUserSelect,
                touchAction: cs.touchAction,
                calloutRule: /canvas[^{]*\{[^}]*-webkit-touch-callout:\s*none/.test(rules),
                contextmenuBlocked: !fire('contextmenu'),
                selectstartBlocked: !fire('selectstart'),
                touchstartBlocked: !c.dispatchEvent(new TouchEvent('touchstart', { cancelable: true, bubbles: true })),
            };
        });
        check('no iOS text selection / copy callout on the canvas (CSS + handlers)', sel.userSelect === 'none' && sel.touchAction === 'none' && sel.calloutRule && sel.contextmenuBlocked && sel.selectstartBlocked && sel.touchstartBlocked, JSON.stringify(sel));
        await pg.tap('canvas', { position: { x: 195, y: 422 } });
        await pdbg('godMode', true);
        await sleep(400);
        let rep = await pdbg('layoutReport');
        const share = rep.arena.h / 844;
        check('390x844 portrait: arena is rotated and fills > 68% of the height', rep.rotated && share > 0.68, `arena ${Math.round(rep.arena.w)}x${Math.round(rep.arena.h)} = ${(share * 100).toFixed(0)}% of 844`);
        await pg.screenshot({ path: resolve(shots, '11-iphone-390x844-play.png') });

        // Real two-finger input through CDP: thumb 1 drags and HOLDS, thumb 2 taps and lifts.
        const cdp = await ctx.newCDPSession(pg);
        const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
        const t1 = (x, y) => ({ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 });
        await pdbg('teleport', 600, 290);
        await touch('touchStart', [t1(195, 600)]);
        for (let i = 1; i <= 6; i++) {
            await touch('touchMove', [t1(195, 600 - i * 12)]); // drag UP
            await sleep(30);
        }
        await sleep(300);
        const a0 = await pdbg('playerScreen');
        const before = await psnap();
        await sleep(300);
        const a1 = await pdbg('playerScreen');
        const realm0 = before.realm;
        const t2 = { x: 320, y: 300, id: 2, radiusX: 4, radiusY: 4, force: 1 };
        await touch('touchStart', [t1(195, 528), t2]); // thumb 2 down (CDP: touchStart lists all active points)
        await sleep(80);
        const mid = await psnap();
        await touch('touchEnd', [t2]); // CDP: touchEnd lists the points that LIFT -> thumb 2 only
        await sleep(60);
        const b0 = await pdbg('playerScreen');
        await sleep(400);
        const b1 = await pdbg('playerScreen');
        const after = await psnap();
        await touch('touchEnd', [t1(195, 528)]);
        await sleep(100);
        const released = await psnap();
        check('drag up on the rotated portrait arena moves the alchemist UP the screen', a1.y < a0.y - 20, `screen y ${a0.y.toFixed(0)} -> ${a1.y.toFixed(0)}`);
        check('multi-touch: thumb 2 tap shifts realm without interrupting thumb 1', mid.realm !== realm0 && after.touch.movePointerId !== null && after.touch.movePointerId === before.touch.movePointerId && b1.y < b0.y - 20 && released.touch.movePointerId === null, `realm ${realm0} -> ${mid.realm}; after thumb 2 lifted moved ${(b0.y - b1.y).toFixed(0)} px up; stick id ${before.touch.movePointerId}/${after.touch.movePointerId}/${released.touch.movePointerId}`);

        // Jackpot Cards must fit the phone with zero overlap.
        await pdbg('triggerDraft');
        await pg.waitForFunction(() => window.__GAME_DEBUG__.snapshot().draft === 'PICKING', null, { timeout: 6000 }).catch(() => {});
        await pdbg('flipCard', 1);
        await sleep(500);
        rep = await pdbg('layoutReport');
        const draftProblems = (d, vw, vh) => {
            const parts = Object.entries(d).filter(([k]) => k !== 'cardW');
            const out = [];
            for (const [k, b] of parts) if (b.x < 0 || b.y < 0 || b.x + b.w > vw + 1 || b.y + b.h > vh + 1) out.push(`${k} off-screen`);
            for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (rectHit(parts[i][1], parts[j][1])) out.push(`${parts[i][0]}×${parts[j][0]}`);
            return out;
        };
        const dp = draftProblems(rep.draft, 390, 844);
        check('390x844: Jackpot Cards header / 4x3 grid / suit footer fit with zero overlap', dp.length === 0 && rep.draft.cardW >= 70, dp.join(', ') || `cards ${rep.draft.cardW}px wide`);
        await pg.screenshot({ path: resolve(shots, '12-iphone-390x844-draft.png') });
        await pg.tap('canvas', { position: { x: 5, y: rep.draft.grid.y + rep.draft.grid.h / 2 } }); // margin beside the cards
        await sleep(150);
        check('phone: tapping outside the cards slam-stops the draft', ['REVEALING', 'AWARDING'].includes((await psnap()).draft), (await psnap()).draft);
        await ctx.close();

        // The desktop draft obeys the same rule.
        await ensurePlaying();
        await game.keyboard.press('KeyJ');
        await waitFor(() => window.__GAME_DEBUG__.snapshot().draft === 'PICKING', 6000).catch(() => {});
        const dd = draftProblems((await dbg('layoutReport')).draft, 1280, 720);
        check('1280x720: Jackpot Cards layout fits with zero overlap', dd.length === 0, dd.join(', '));
        await ensurePlaying();
        check('desktop 1280x720 never shows the rotate lock', (await snap()).rotateLock === false);

        const lctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
        const lp = await lctx.newPage();
        watch(lp, 'landscape');
        await lp.goto(`${base}/?seed=8&play`);
        await lp.waitForFunction(() => !!window.__GAME_DEBUG__, null, { timeout: 30_000 });
        await sleep(400);
        const l0 = await lp.evaluate(() => window.__GAME_DEBUG__.snapshot());
        await sleep(600);
        const l1 = await lp.evaluate(() => window.__GAME_DEBUG__.snapshot());
        const overlay = await lp.evaluate(() => ({ display: getComputedStyle(document.getElementById('rotate')).display, text: document.getElementById('rotate').innerText }));
        check('844x390 phone landscape: "ROTATE PHONE TO PORTRAIT" lock, simulation paused', l1.rotateLock && overlay.display === 'flex' && /ROTATE PHONE TO PORTRAIT/.test(overlay.text) && l1.simTime === l0.simTime, `display=${overlay.display} simTime ${l0.simTime.toFixed(2)} -> ${l1.simTime.toFixed(2)}`);
        await lp.screenshot({ path: resolve(shots, '13-iphone-landscape-844x390-lock.png') });
        await lctx.close();
    }

    // ------------------------------------------------------------ 13. health
    await sleep(500);
    const px2 = await dbg('samplePixels');
    check('still rendering after full playtest', px2.uniqueColors > 60, `${px2.uniqueColors} colours`);
    check('zero pageerror / console.error events', errors.length === 0, errors.slice(0, 5).join(' | '));
    check('zero console warnings (e.g. Pixi deprecations)', warnings.length === 0, warnings.slice(0, 3).join(' | '));
    writeFileSync(resolve(shots, 'e2e-report.json'), JSON.stringify({ base, fps: measured, results, errors, warnings, final: await snap() }, null, 2));
    await phoneCtx.close();
} catch (err) {
    failures++;
    console.error('E2E crashed:', err);
} finally {
    await browser.close();
    vite?.kill();
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : `\nALL ${results.length} CHECKS PASSED — screenshots in ./screenshots`);
process.exit(failures ? 1 : 0);
