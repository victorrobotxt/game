import { FSM } from '../core/FSM';
import { SequenceRunner } from '../core/SequenceRunner';
import {
    DraftState,
    JackpotCardsDraft,
    draftStates,
    type DraftEvent,
} from '../engine/easter-eggs/JackpotCardsDraft';
import type { Rng } from '../engine/rng';
import type { Suit } from '../engine/types';
import { SUIT_INFO } from '../engine/Upgrades';
import type { ProceduralAudio } from '../juice/ProceduralAudio';
import type { DraftView } from './DraftView';

/**
 * Glue between the pure draft model/FSM and the DraftView. Input funnel:
 *   DEALING   SPACE -> fastForward deal
 *   PICKING   click -> flip one;  SPACE -> STOP (auto-reveal)
 *   REVEALING SPACE -> SKIP (fastForward every queued flip)
 *   AWARDING  SPACE -> SKIP
 */
export class DraftPresenter {
    private fsm: FSM<DraftState, DraftEvent> | null = null;
    model: JackpotCardsDraft | null = null;
    readonly queue = new SequenceRunner();
    private readonly view: DraftView;
    private readonly rng: Rng;
    private readonly audio: ProceduralAudio;
    private readonly tierOf: (s: Suit) => number;
    private onDone: (suit: Suit | null) => void = () => {};
    lastAward: Suit | null = null;

    constructor(view: DraftView, rng: Rng, audio: ProceduralAudio, tierOf: (s: Suit) => number) {
        this.view = view;
        this.rng = rng;
        this.audio = audio;
        this.tierOf = tierOf;
        view.onCardTap = (i) => this.tapCard(i);
    }

    get state(): DraftState | 'CLOSED' {
        return this.fsm?.state ?? 'CLOSED';
    }

    get active(): boolean {
        return this.fsm !== null && this.fsm.state !== DraftState.DONE;
    }

    open(onDone: (suit: Suit | null) => void) {
        this.queue.clear();
        this.onDone = onDone;
        const model = (this.model = new JackpotCardsDraft(this.rng));
        const view = this.view;
        view.reset();
        this.syncTally();
        view.setSubtitle('Dealing…');
        this.fsm = new FSM<DraftState, DraftEvent>(
            draftStates({
                deal: async () => {
                    this.queue.add('deal', (c) => c.play(view.deal((i) => this.audio.deal(i % 4))));
                    await this.queue.run();
                    view.pickable = true;
                    view.setSubtitle('Match 3 of a suit  ·  click cards  ·  SPACE = slam-stop auto-reveal');
                },
                autoReveal: async () => {
                    view.pickable = false;
                    view.setSubtitle('SLAM STOP!  ·  SPACE again = skip');
                    for (const r of model.autoRevealPlan()) {
                        this.queue.add(`reveal-${r.index}`, async (c) => {
                            this.audio.cardFlip();
                            await c.play(view.flip(r.index, r.suit));
                            this.syncTally();
                            await c.wait(0.1);
                        });
                    }
                    await this.queue.run();
                    this.syncTally(); // final state set unconditionally
                },
                award: async () => {
                    const suit = model.matched!;
                    this.lastAward = suit;
                    const idx = model.cards.flatMap((s, i) => (s === suit && model.revealed[i] ? [i] : []));
                    view.pickable = false;
                    view.setSubtitle('');
                    this.audio.fanfare();
                    this.queue.add('celebrate', (c) => c.play(view.celebrate(suit, idx, this.tierOf(suit) + 1)));
                    this.queue.add('close', (c) => c.play(view.close()), { skippable: true });
                    await this.queue.run();
                },
                done: () => {
                    this.queue.clear();
                    view.visible = false;
                    const suit = model.matched;
                    this.fsm = null;
                    this.onDone(suit);
                },
            }),
            DraftState.DEALING,
            DraftState.DONE,
        );
    }

    /** Tally + "one away" highlight. The model is the truth; the view only mirrors it. */
    private syncTally() {
        const m = this.model;
        const revealed = m ? m.cards.flatMap((suit, index) => (m.revealed[index] ? [{ index, suit }] : [])) : [];
        this.view.setTally(this.counts(), revealed, this.tierOf);
        const hot = this.view.hot;
        if (hot && this.fsm?.state === DraftState.PICKING && !m?.matched)
            this.view.setSubtitle(`${SUIT_INFO[hot].glyph} ${SUIT_INFO[hot].name} is one card away  ·  ${SUIT_INFO[hot].perk}`);
    }

    private counts(): Record<Suit, number> {
        const m = this.model;
        return {
            CLUBS: m?.count('CLUBS') ?? 0,
            DIAMONDS: m?.count('DIAMONDS') ?? 0,
            HEARTS: m?.count('HEARTS') ?? 0,
            SPADES: m?.count('SPADES') ?? 0,
        };
    }

    tapCard(i: number) {
        const fsm = this.fsm;
        const model = this.model;
        if (!fsm || !model || fsm.state !== DraftState.PICKING) return;
        const r = model.flip(i); // model first, synchronously
        if (!r) return;
        this.audio.cardFlip();
        this.queue.add(`flip-${i}`, async (c) => {
            await c.play(this.view.flip(i, r.suit));
            this.syncTally();
        });
        void this.queue.run().then(() => {
            if (r.matched && this.fsm === fsm) fsm.send('MATCH');
        });
    }

    /** Leave mid-draft without awarding (attract mode handing control back). */
    abort() {
        const fsm = this.fsm;
        if (!fsm) return;
        this.onDone = () => {};
        this.queue.clear();
        fsm.force(DraftState.DONE);
        this.fsm = null;
        this.view.pickable = false;
        this.view.visible = false;
    }

    /** SPACE / phone button. */
    primary() {
        const fsm = this.fsm;
        if (!fsm) return;
        switch (fsm.state) {
            case DraftState.PICKING:
                fsm.send(this.model?.matched ? 'MATCH' : 'STOP');
                break;
            case DraftState.DEALING:
            case DraftState.REVEALING:
            case DraftState.AWARDING:
                this.queue.fastForward();
                break;
        }
    }
}
