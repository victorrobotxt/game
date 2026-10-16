import { Container, Sprite, Text, type Texture } from 'pixi.js';
import { ObjectPool } from './ObjectPool';

export const MAX_PARTICLES = 250;
export const MAX_LABELS = 40;
export const HIT_STOP_MS = 45;

interface Particle {
    sprite: Sprite;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    drag: number;
    grow: number;
    baseScale: number;
}

export interface Label {
    text: Text;
    vy: number;
    life: number;
    maxLife: number;
    baseScale: number;
}

/**
 * Screen shake (quadratic trauma), hit-stop and pre-allocated particles + floating labels.
 * After construction nothing here allocates: bursts that exceed the pool are simply dropped.
 */
export class JuiceManager {
    readonly particleLayer = new Container();
    readonly labelLayer = new Container();
    readonly particles: ObjectPool<Particle>;
    readonly labels: ObjectPool<Label>;
    trauma = 0;
    private hitStopUntil = 0;
    shakeX = 0;
    shakeY = 0;
    shakeRot = 0;
    private seed = 0;

    constructor(glow: Texture) {
        this.particles = new ObjectPool(MAX_PARTICLES, () => {
            const sprite = new Sprite(glow);
            sprite.anchor.set(0.5);
            sprite.blendMode = 'add';
            sprite.visible = false;
            this.particleLayer.addChild(sprite);
            return { sprite, vx: 0, vy: 0, life: 0, maxLife: 1, drag: 2, grow: 0, baseScale: 1 };
        });
        this.labels = new ObjectPool(MAX_LABELS, () => {
            const text = new Text({
                text: '',
                style: {
                    fontFamily: 'Verdana, DejaVu Sans, sans-serif',
                    fontSize: 22,
                    fontWeight: 'bold',
                    fill: 0xffffff,
                    stroke: { color: 0x120818, width: 5 },
                    align: 'center',
                },
            });
            text.anchor.set(0.5);
            text.visible = false;
            this.labelLayer.addChild(text);
            return { text, vy: 0, life: 0, maxLife: 1, baseScale: 1 };
        });
    }

    /** Reduced shake / flash mode (accessibility): shake is scaled down and hit-stop is skipped. */
    calm = false;

    addTrauma(amount: number) {
        this.trauma = Math.min(this.calm ? 0.35 : 1, this.trauma + amount * (this.calm ? 0.25 : 1));
    }

    hitStop(now: number, ms = HIT_STOP_MS) {
        if (this.calm) return;
        this.hitStopUntil = Math.max(this.hitStopUntil, now + ms);
    }

    isFrozen(now: number): boolean {
        return now < this.hitStopUntil;
    }

    burst(x: number, y: number, count: number, color: number, speed = 260, life = 0.7, scale = 0.5) {
        for (let i = 0; i < count; i++) {
            const p = this.particles.acquire();
            if (!p) return;
            const a = Math.random() * Math.PI * 2;
            const s = speed * (0.3 + Math.random() * 0.9);
            p.vx = Math.cos(a) * s;
            p.vy = Math.sin(a) * s;
            p.life = p.maxLife = life * (0.6 + Math.random() * 0.6);
            p.drag = 3;
            p.grow = -0.5;
            p.baseScale = scale * (0.5 + Math.random() * 0.8);
            p.sprite.position.set(x, y);
            p.sprite.tint = color;
            p.sprite.visible = true;
        }
    }

    ring(x: number, y: number, radius: number, count: number, color: number, life = 0.45) {
        for (let i = 0; i < count; i++) {
            const p = this.particles.acquire();
            if (!p) return;
            const a = (i / count) * Math.PI * 2;
            p.vx = Math.cos(a) * radius * 2.4;
            p.vy = Math.sin(a) * radius * 2.4;
            p.life = p.maxLife = life;
            p.drag = 4.5;
            p.grow = 0;
            p.baseScale = 0.35;
            p.sprite.position.set(x, y);
            p.sprite.tint = color;
            p.sprite.visible = true;
        }
    }

    label(x: number, y: number, str: string, color: number, size = 1, life = 0.9): Label | null {
        const l = this.labels.acquire();
        if (!l) return null;
        l.text.text = str;
        l.text.style.fill = color;
        l.text.position.set(x, y);
        l.vy = -70;
        l.life = l.maxLife = life;
        l.baseScale = size;
        l.text.visible = true;
        return l;
    }

    /** Update a live label in place (one escalating "CHAIN xN" per cascade instead of a pile). */
    relabel(l: Label, str: string, color: number, size: number, life = 0.9): boolean {
        if (!this.labels.active.has(l)) return false;
        l.text.text = str;
        l.text.style.fill = color;
        l.life = l.maxLife = life;
        l.baseScale = size;
        l.vy = -40;
        return true;
    }

    /**
     * Keep floating labels out of a rect (in labelLayer coordinates), e.g. the preset banner:
     * a label that drifts into it is pushed to the nearer edge.
     */
    avoid(r: { x: number; y: number; w: number; h: number }) {
        for (const l of this.labels.all) {
            if (!this.labels.active.has(l)) continue;
            const t = l.text;
            const hw = t.width / 2;
            const hh = t.height / 2;
            if (t.x + hw < r.x || t.x - hw > r.x + r.w || t.y + hh < r.y || t.y - hh > r.y + r.h) continue;
            t.y = t.y < r.y + r.h / 2 ? r.y - hh - 2 : r.y + r.h + hh + 2;
        }
    }

    /** Screen-space-independent bounds of the live labels (labelLayer coordinates). */
    liveLabels(): Text[] {
        const out: Text[] = [];
        for (const l of this.labels.all) if (this.labels.active.has(l)) out.push(l.text);
        return out;
    }

    update(dt: number) {
        this.trauma = Math.max(0, this.trauma - dt * 1.4);
        const shake = this.trauma * this.trauma;
        this.seed += dt * 40;
        this.shakeX = shake * 22 * Math.sin(this.seed * 1.7 + 0.3) * Math.cos(this.seed * 0.9);
        this.shakeY = shake * 22 * Math.sin(this.seed * 2.3 + 1.1);
        this.shakeRot = shake * 0.012 * Math.sin(this.seed * 1.3);

        for (const p of this.particles.all) {
            if (!this.particles.active.has(p)) continue;
            p.life -= dt;
            if (p.life <= 0) {
                p.sprite.visible = false;
                this.particles.release(p);
                continue;
            }
            const k = Math.exp(-p.drag * dt);
            p.vx *= k;
            p.vy *= k;
            p.sprite.x += p.vx * dt;
            p.sprite.y += p.vy * dt;
            const t = p.life / p.maxLife;
            p.sprite.alpha = Math.min(1, t * 1.6);
            p.sprite.scale.set(p.baseScale * (1 + p.grow * (1 - t)));
        }
        for (const l of this.labels.all) {
            if (!this.labels.active.has(l)) continue;
            l.life -= dt;
            if (l.life <= 0) {
                l.text.visible = false;
                this.labels.release(l);
                continue;
            }
            l.vy *= Math.exp(-2.5 * dt);
            l.text.y += l.vy * dt;
            const t = 1 - l.life / l.maxLife;
            const pop = t < 0.12 ? 0.6 + (t / 0.12) * 0.6 : 1.2 - Math.min(0.2, (t - 0.12) * 1.2);
            l.text.scale.set(l.baseScale * pop);
            l.text.alpha = l.life < 0.25 ? l.life / 0.25 : 1;
        }
    }
}
