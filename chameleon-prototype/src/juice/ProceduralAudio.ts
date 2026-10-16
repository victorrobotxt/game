/**
 * Zero-asset WebAudio synth. Everything is oscillators, noise buffers and envelopes.
 * The AudioContext is created lazily on the first user gesture (autoplay policy).
 */
type Wave = OscillatorType;

export class ProceduralAudio {
    private ctx: AudioContext | null = null;
    private master: GainNode | null = null;
    private noise: AudioBuffer | null = null;
    private musicBus: GainNode | null = null;
    private musicFilter: BiquadFilterNode | null = null;
    muted = false;

    /** Call from a pointer/key handler. Safe to call repeatedly. */
    unlock(): void {
        try {
            if (!this.ctx) {
                const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
                if (!Ctor) return;
                this.ctx = new Ctor();
                this.master = this.ctx.createGain();
                this.master.gain.value = 0.35;
                const comp = this.ctx.createDynamicsCompressor();
                this.master.connect(comp).connect(this.ctx.destination);
                // Music bus: its own low-pass so drafts can muffle it and shifts can sweep it.
                this.musicFilter = this.ctx.createBiquadFilter();
                this.musicFilter.type = 'lowpass';
                this.musicFilter.frequency.value = 4000;
                this.musicFilter.Q.value = 2;
                this.musicBus = this.ctx.createGain();
                this.musicBus.gain.value = 0.55;
                this.musicBus.connect(this.musicFilter).connect(this.master);
                const len = this.ctx.sampleRate;
                this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
                const data = this.noise.getChannelData(0);
                for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
            }
            if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
        } catch {
            this.ctx = null;
        }
    }

    get ready(): boolean {
        return !!this.ctx && this.ctx.state === 'running' && !this.muted;
    }

    setMuted(m: boolean) {
        this.muted = m;
        if (this.master) this.master.gain.value = m ? 0 : 0.35;
    }

    private tone(freq: number, dur: number, opts: { type?: Wave; vol?: number; to?: number; delay?: number; attack?: number } = {}) {
        if (!this.ready) return;
        const ctx = this.ctx!;
        const t0 = ctx.currentTime + (opts.delay ?? 0);
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = opts.type ?? 'sine';
        osc.frequency.setValueAtTime(freq, t0);
        if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t0 + dur);
        const vol = opts.vol ?? 0.3;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol, t0 + (opts.attack ?? 0.005));
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g).connect(this.master!);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
    }

    private burst(dur: number, opts: { vol?: number; from?: number; to?: number; delay?: number; q?: number } = {}) {
        if (!this.ready || !this.noise) return;
        const ctx = this.ctx!;
        const t0 = ctx.currentTime + (opts.delay ?? 0);
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = opts.q ?? 1;
        filter.frequency.setValueAtTime(opts.from ?? 4000, t0);
        filter.frequency.exponentialRampToValueAtTime(opts.to ?? 120, t0 + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(opts.vol ?? 0.5, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(filter).connect(g).connect(this.master!);
        src.start(t0, Math.random() * 0.5);
        src.stop(t0 + dur + 0.02);
    }

    /** Pitch climbs a major scale with the pickup streak. */
    coin(streak: number) {
        const scale = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24];
        const semi = scale[Math.min(streak - 1, scale.length - 1)] ?? 0;
        const f = 880 * Math.pow(2, semi / 12);
        this.tone(f, 0.09, { type: 'square', vol: 0.08 });
        this.tone(f * 1.5, 0.14, { type: 'sine', vol: 0.12, delay: 0.04 });
    }

    /** Sub-bass drop + airy sweep. Perfect beats get a bell on top. */
    shift(perfect: boolean, toShadow: boolean) {
        this.tone(toShadow ? 110 : 160, 0.45, { type: 'sine', vol: 0.55, to: 38 });
        this.burst(0.25, { vol: 0.18, from: 6000, to: 300 });
        if (perfect) this.tone(toShadow ? 1318 : 1568, 0.35, { type: 'triangle', vol: 0.15 });
    }

    denied() {
        this.tone(140, 0.08, { type: 'square', vol: 0.06 });
    }

    explosion(size: number, chain: number) {
        const s = Math.min(1, size);
        this.burst(0.35 + s * 0.4, { vol: 0.35 + s * 0.3, from: 3000 + chain * 200, to: 60 });
        this.tone(90 - Math.min(chain, 10) * 3, 0.3, { type: 'sine', vol: 0.4, to: 30 });
    }

    hit() {
        this.tone(420, 0.05, { type: 'square', vol: 0.05, to: 200 });
    }

    hurt() {
        this.tone(220, 0.25, { type: 'sawtooth', vol: 0.22, to: 70 });
        this.burst(0.15, { vol: 0.2, from: 1500, to: 200 });
    }

    cardFlip() {
        this.burst(0.05, { vol: 0.4, from: 9000, to: 2000, q: 4 });
        this.tone(1800, 0.03, { type: 'square', vol: 0.04 });
    }

    deal(i: number) {
        this.burst(0.04, { vol: 0.15, from: 7000, to: 3000, delay: i * 0.02 });
    }

    /** Arpeggiated major chord fanfare (root, 3rd, 5th, octave, then a held chord). */
    fanfare() {
        const root = 523.25;
        const steps = [0, 4, 7, 12, 16, 19, 24];
        steps.forEach((s, i) => this.tone(root * Math.pow(2, s / 12), 0.22, { type: 'square', vol: 0.09, delay: i * 0.075 }));
        for (const s of [0, 4, 7, 12]) this.tone(root * Math.pow(2, s / 12), 1.1, { type: 'triangle', vol: 0.12, delay: 0.55, attack: 0.02 });
    }

    powerup() {
        [0, 7, 12, 19].forEach((s, i) => this.tone(660 * Math.pow(2, s / 12), 0.15, { type: 'triangle', vol: 0.14, delay: i * 0.05 }));
    }

    ui() {
        this.tone(1200, 0.04, { type: 'triangle', vol: 0.08 });
    }

    // ---------------------------------------------------------- music primitives (absolute times)

    get now(): number {
        return this.ctx?.currentTime ?? 0;
    }

    /** Smoothly move the music low-pass cutoff (Hz). */
    musicCutoff(hz: number, smoothing = 0.08) {
        if (!this.ctx || !this.musicFilter) return;
        this.musicFilter.frequency.setTargetAtTime(hz, this.ctx.currentTime, smoothing);
    }

    /** Filter dip-and-recover: the "whoosh" under a realm shift. */
    musicSweep() {
        if (!this.ctx || !this.musicFilter) return;
        const f = this.musicFilter.frequency;
        const t = this.ctx.currentTime;
        f.cancelScheduledValues(t);
        f.setValueAtTime(f.value, t);
        f.exponentialRampToValueAtTime(260, t + 0.06);
        f.exponentialRampToValueAtTime(Math.max(300, f.value), t + 0.45);
    }

    note(when: number, freq: number, dur: number, type: Wave, vol: number, glideTo?: number) {
        if (!this.ready || !this.musicBus) return;
        const ctx = this.ctx!;
        const t0 = Math.max(when, ctx.currentTime);
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g).connect(this.musicBus);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
    }

    hat(when: number, vol: number, dur = 0.04) {
        if (!this.ready || !this.noise || !this.musicBus) return;
        const ctx = this.ctx!;
        const t0 = Math.max(when, ctx.currentTime);
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = dur > 0.08 ? 1200 : 7000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(hp).connect(g).connect(this.musicBus);
        src.start(t0, Math.random() * 0.5);
        src.stop(t0 + dur + 0.02);
    }
}

export const audio = new ProceduralAudio();
