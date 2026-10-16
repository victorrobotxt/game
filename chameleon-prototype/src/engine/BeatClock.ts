import type { Theme } from './types';

/** ± seconds around a beat that count as an on-beat (PERFECT) shift. */
export const PERFECT_WINDOW = 0.13;

/** Each preset has its own tempo; the whole game (sim, music, HUD dials, player ring) follows it. */
export const THEME_BPM: Record<Theme, number> = {
    PARALLEL_SYNC: 100,
    CHAIN_OVERLOAD: 124,
    ALCHEMY_CRAFT: 92,
    TIME_ECHO: 108,
    SHADOW_LENS: 84,
};

/**
 * "Two offices, one clock." Position is counted in beats, not seconds, so a tempo change
 * keeps the bar position continuous and the music never jumps.
 * The World advances it while simulating; main.ts advances it while the sim is paused
 * (draft, hit-stop, game over) so the beat and the music never stop.
 */
export class BeatClock {
    bpm: number;
    beats = 0;

    constructor(bpm: number) {
        this.bpm = bpm;
    }

    get period(): number {
        return 60 / this.bpm;
    }

    advance(dt: number) {
        this.beats += (dt * this.bpm) / 60;
    }

    /** 0..1 inside the current beat; 0 = on the beat. */
    get phase(): number {
        return this.beats - Math.floor(this.beats);
    }

    /** Seconds to the nearest beat. */
    error(): number {
        const f = this.phase;
        return Math.min(f, 1 - f) * this.period;
    }

    /** PERFECT window expressed as a fraction of a beat. */
    get windowPhase(): number {
        return PERFECT_WINDOW / this.period;
    }
}
