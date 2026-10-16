/**
 * "Jackpot Cards" 12-card roguelike draft. Pure model + the SPIN -> STOP -> SKIP flow table
 * from the starter, repurposed:
 *
 *   DEALING   (SPIN)  cards fly in            SPACE -> fast-forward the deal
 *   PICKING           click to flip            SPACE -> STOP: auto-reveal until a suit triples
 *   REVEALING (STOP)  scripted reveal running  SPACE -> SKIP: SequenceRunner.fastForward()
 *   AWARDING          fanfare + perk banner    SPACE -> SKIP
 *   DONE              back to combat
 *
 * 12 cards = 4 suits x 3, so by pigeonhole a triple is guaranteed within 9 flips.
 */
import type { StateDef } from '../../core/FSM';
import type { Rng } from '../rng';
import { SUITS, type Suit } from '../types';

export const DraftState = {
    DEALING: 'DEALING',
    PICKING: 'PICKING',
    REVEALING: 'REVEALING',
    AWARDING: 'AWARDING',
    DONE: 'DONE',
} as const;
export type DraftState = (typeof DraftState)[keyof typeof DraftState];

export type DraftEvent = 'DEALT' | 'MATCH' | 'STOP' | 'REVEALED' | 'AWARDED' | 'TIMEOUT';

export interface DraftHooks {
    deal(ctx: { signal: AbortSignal }): Promise<void>;
    autoReveal(ctx: { signal: AbortSignal }): Promise<void>;
    award(ctx: { signal: AbortSignal }): Promise<void>;
    done(): void;
}

/** Flow table. Hooks are the presentation; the table is the contract. */
export function draftStates(hooks: DraftHooks): Record<DraftState, StateDef<DraftState, DraftEvent>> {
    return {
        DEALING: {
            on: { DEALT: 'PICKING', TIMEOUT: 'PICKING' },
            timeoutMs: 6000,
            timeoutEvent: 'TIMEOUT',
            async enter(ctx) {
                await hooks.deal(ctx);
                ctx.send('DEALT');
            },
        },
        PICKING: { on: { MATCH: 'AWARDING', STOP: 'REVEALING' } },
        REVEALING: {
            on: { REVEALED: 'AWARDING', TIMEOUT: 'AWARDING' },
            timeoutMs: 12000,
            timeoutEvent: 'TIMEOUT',
            async enter(ctx) {
                await hooks.autoReveal(ctx);
                ctx.send('REVEALED');
            },
        },
        AWARDING: {
            on: { AWARDED: 'DONE', TIMEOUT: 'DONE' },
            timeoutMs: 8000,
            timeoutEvent: 'TIMEOUT',
            async enter(ctx) {
                await hooks.award(ctx);
                ctx.send('AWARDED');
            },
        },
        DONE: {
            on: {},
            enter() {
                hooks.done();
            },
        },
    };
}

export interface FlipResult {
    index: number;
    suit: Suit;
    /** Suit that just reached 3 revealed copies, if any. */
    matched: Suit | null;
}

export class JackpotCardsDraft {
    readonly cards: Suit[];
    readonly revealed: boolean[];
    private readonly counts: Record<Suit, number> = { CLUBS: 0, DIAMONDS: 0, HEARTS: 0, SPADES: 0 };
    matched: Suit | null = null;

    constructor(rng: Rng) {
        const deck: Suit[] = [];
        for (const s of SUITS) deck.push(s, s, s);
        this.cards = rng.shuffle(deck);
        this.revealed = deck.map(() => false);
    }

    get flips(): number {
        return this.revealed.filter(Boolean).length;
    }

    canFlip(i: number): boolean {
        return this.matched === null && i >= 0 && i < this.cards.length && !this.revealed[i];
    }

    /** Model state changes synchronously; the view animates afterwards (Rule 7). */
    flip(i: number): FlipResult | null {
        if (!this.canFlip(i)) return null;
        this.revealed[i] = true;
        const suit = this.cards[i];
        this.counts[suit]++;
        if (this.counts[suit] === 3) this.matched = suit;
        return { index: i, suit, matched: this.matched };
    }

    /** Slam-stop: flip remaining cards in reading order until a suit triples. */
    autoRevealPlan(): FlipResult[] {
        const out: FlipResult[] = [];
        for (let i = 0; i < this.cards.length && this.matched === null; i++) {
            const r = this.flip(i);
            if (r) out.push(r);
        }
        return out;
    }

    count(s: Suit): number {
        return this.counts[s];
    }
}
