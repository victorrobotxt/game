import { Realm, type Theme } from '../engine/types';
import type { ProceduralAudio } from './ProceduralAudio';

/**
 * Generative soundtrack locked to the game's BeatClock. Every frame we look ~120 ms ahead and
 * schedule the 16th-notes that fall inside that window at exact AudioContext times, so the music
 * stays on the same grid the PERFECT window is judged on.
 *
 * Solar plays a major progression (I-V-vi-IV); Shadow plays the relative minor over the same notes
 * (vi-IV-I-V), so a realm shift changes the mood without a jarring key change.
 */
interface Style {
    /** MIDI note of the arpeggio's key root. */
    root: number;
    lead: OscillatorType;
    bass: OscillatorType;
    /** 1 = 16ths, 2 = 8ths. */
    arpEvery: 1 | 2;
    arpDecay: number;
    hats: boolean;
    snare: boolean;
    kickEvery: 1 | 2;
    /** Dotted-8th repeat of every arp note: TIME_ECHO hears its own echo. */
    echo: boolean;
}

const STYLES: Record<Theme, Style> = {
    PARALLEL_SYNC: { root: 60, lead: 'square', bass: 'triangle', arpEvery: 1, arpDecay: 0.12, hats: true, snare: true, kickEvery: 1, echo: false },
    CHAIN_OVERLOAD: { root: 64, lead: 'sawtooth', bass: 'sawtooth', arpEvery: 1, arpDecay: 0.08, hats: true, snare: true, kickEvery: 1, echo: false },
    ALCHEMY_CRAFT: { root: 62, lead: 'sine', bass: 'sine', arpEvery: 2, arpDecay: 0.4, hats: true, snare: false, kickEvery: 1, echo: false },
    TIME_ECHO: { root: 65, lead: 'square', bass: 'triangle', arpEvery: 2, arpDecay: 0.1, hats: true, snare: true, kickEvery: 1, echo: true },
    SHADOW_LENS: { root: 57, lead: 'triangle', bass: 'sine', arpEvery: 2, arpDecay: 0.28, hats: false, snare: false, kickEvery: 2, echo: false },
};

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const PROGRESSION: Record<Realm, number[]> = {
    SOLAR_ORDER: [0, 4, 5, 3],
    SHADOW_ALCHEMY: [5, 3, 0, 4],
};
const LOOKAHEAD = 0.12;

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export interface MusicInput {
    beats: number;
    bpm: number;
    theme: Theme;
    realm: Realm;
    /** 0..1: enemies on screen, instability, etc. Opens the filter and thickens the arp. */
    intensity: number;
    combo: number;
    /** Draft / game over: everything goes behind a low-pass. */
    muffled: boolean;
}

export class ProceduralMusic {
    private readonly audio: ProceduralAudio;
    private nextStep = -1;
    /** Notes scheduled so far (exposed to the e2e as proof the sequencer runs). */
    scheduled = 0;
    enabled = true;

    constructor(audio: ProceduralAudio) {
        this.audio = audio;
    }

    update(m: MusicInput) {
        if (!this.enabled || !this.audio.ready) return;
        const stepNow = m.beats * 4;
        const stepSec = 60 / m.bpm / 4;
        const ahead = LOOKAHEAD / stepSec;
        // Resync after a stall (tab hidden), a restart, or before the first note.
        if (this.nextStep < 0 || this.nextStep < stepNow - 1 || this.nextStep > stepNow + ahead + 4) this.nextStep = Math.ceil(stepNow);
        const base = this.audio.now;
        while (this.nextStep <= stepNow + ahead) {
            this.playStep(this.nextStep, base + (this.nextStep - stepNow) * stepSec, m);
            this.nextStep++;
        }
        this.audio.musicCutoff(m.muffled ? 650 : 1500 + 5000 * Math.min(1, m.intensity));
    }

    private degreeMidi(style: Style, degree: number, octave = 0): number {
        const d = ((degree % 7) + 7) % 7;
        return style.root + MAJOR[d] + 12 * (Math.floor(degree / 7) + octave);
    }

    private playStep(step: number, when: number, m: MusicInput) {
        const st = STYLES[m.theme];
        const a = this.audio;
        const inBeat = step % 4;
        const bar = Math.floor(step / 16);
        const chord = PROGRESSION[m.realm][bar % 4];
        const quiet = m.muffled ? 0.6 : 1;

        // Drums
        if (inBeat === 0 && (step / 4) % st.kickEvery === 0) {
            a.note(when, 150, 0.22, 'sine', 0.55 * quiet, 42);
            this.scheduled++;
        }
        if (st.snare && step % 8 === 4) a.hat(when, 0.16 * quiet, 0.12);
        if (st.hats && inBeat === 2) a.hat(when, 0.05 * quiet);
        if (st.hats && m.intensity > 0.5 && inBeat === 3) a.hat(when, 0.025 * quiet);

        // Bass: root on the bar's downbeats plus a syncopated push.
        if (step % 8 === 0 || step % 8 === 6) {
            a.note(when, midiHz(this.degreeMidi(st, chord, -2)), 0.3, st.bass, 0.2 * quiet);
            this.scheduled++;
        }

        // Arpeggio over chord tones; thins to 8ths when calm.
        const every = m.intensity < 0.15 ? 2 : st.arpEvery;
        if (step % every === 0) {
            const pattern = m.realm === Realm.SOLAR_ORDER ? [0, 2, 4, 7] : [0, 4, 2, 7];
            const idx = Math.floor(step / every) % pattern.length;
            const f = midiHz(this.degreeMidi(st, chord + pattern[idx]));
            const vol = (0.035 + 0.05 * Math.min(1, m.intensity)) * quiet;
            a.note(when, f, st.arpDecay, st.lead, vol);
            if (st.echo) a.note(when + (60 / m.bpm) * 0.75, f, st.arpDecay, st.lead, vol * 0.4);
            this.scheduled++;
        }

        // Combo sparkle: a high chord tone on each beat once you're on a streak.
        if (m.combo >= 3 && inBeat === 0 && !m.muffled) {
            a.note(when, midiHz(this.degreeMidi(st, chord + 4, 1)), 0.25, 'triangle', 0.05);
        }
    }
}
