/**
 * Table-driven finite state machine that cannot be soft-locked by input spam.
 *
 * Guarantees:
 *  1. Events not listed in the current state's `on` table are IGNORED (never queued).
 *  2. Async work started in a state can only move the machine while that state is still
 *     current: ctx.send() is bound to an epoch, stale completions are dropped.
 *  3. Leaving a state aborts ctx.signal, so its in-flight work can bail out early.
 *  4. Every state may declare a watchdog (timeoutMs + timeoutEvent).
 *  5. A throw/reject in enter() routes to `errorState` instead of freezing.
 *  6. send() from exit() or a listener is dropped (no half-finished transitions).
 */
export interface StateContext<E extends string> {
    readonly signal: AbortSignal;
    send(event: E): void;
}

export interface StateDef<S extends string, E extends string> {
    on: Partial<Record<E, S>>;
    enter?(ctx: StateContext<E>): void | Promise<void>;
    exit?(): void;
    timeoutMs?: number;
    timeoutEvent?: E;
}

export type Listener<S extends string, E extends string> = (to: S, from: S, event: E | 'FORCE') => void;

export class FSM<S extends string, E extends string> {
    private readonly states: Record<S, StateDef<S, E>>;
    private readonly errorState: S;
    private readonly listeners = new Set<Listener<S, E>>();
    private current: S;
    private epoch = 0;
    private abort = new AbortController();
    private watchdog?: ReturnType<typeof setTimeout>;
    private transitioning = false;

    constructor(states: Record<S, StateDef<S, E>>, initial: S, errorState: S) {
        this.states = states;
        this.errorState = errorState;
        this.current = initial;
        this.enter(initial);
    }

    get state(): S {
        return this.current;
    }

    /** Use this to enable/disable UI (buttons, cursor) - never duplicate the table in views. */
    can(event: E): boolean {
        return !this.transitioning && this.states[this.current].on[event] !== undefined;
    }

    /** Returns true if the event caused a transition. Safe to call any number of times. */
    send(event: E): boolean {
        if (this.transitioning) return false;
        const to = this.states[this.current].on[event];
        if (to === undefined) return false;
        this.transition(to, event);
        return true;
    }

    /** Escape hatch for errors / server resync. Bypasses the table. */
    force(to: S): void {
        if (this.transitioning) return;
        this.transition(to, 'FORCE');
    }

    onChange(listener: Listener<S, E>): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private transition(to: S, event: E | 'FORCE') {
        const from = this.current;
        this.transitioning = true;
        try {
            clearTimeout(this.watchdog);
            this.abort.abort();
            this.states[from].exit?.();
        } catch (err) {
            console.error(`[FSM] exit(${from}) threw`, err);
        }
        this.current = to;
        try {
            this.listeners.forEach((l) => l(to, from, event));
        } catch (err) {
            console.error('[FSM] listener threw', err);
        }
        this.transitioning = false;
        this.enter(to);
    }

    private enter(state: S) {
        const epoch = ++this.epoch;
        this.abort = new AbortController();
        const def = this.states[state];
        const ctx: StateContext<E> = {
            signal: this.abort.signal,
            send: (e) => {
                if (epoch === this.epoch) this.send(e);
            },
        };
        if (def.timeoutMs !== undefined && def.timeoutEvent !== undefined) {
            const ev = def.timeoutEvent;
            this.watchdog = setTimeout(() => {
                console.warn(`[FSM] watchdog fired in ${state}`);
                ctx.send(ev);
            }, def.timeoutMs);
        }
        try {
            const result = def.enter?.(ctx);
            if (result instanceof Promise) result.catch((err) => this.fail(epoch, state, err));
        } catch (err) {
            this.fail(epoch, state, err);
        }
    }

    private fail(epoch: number, state: S, err: unknown) {
        if (epoch !== this.epoch) return; // state already left; nothing to recover
        console.error(`[FSM] enter(${state}) failed`, err);
        if (state !== this.errorState) this.force(this.errorState);
    }
}
