import gsap from 'gsap';

/**
 * Handed to every presentation command. Commands MUST await animations through
 * ctx.play()/ctx.wait() so that skip() can fast-forward them.
 *
 * Rule: skipping means "jump to the final visual state", never "don't run".
 * A skipped command still executes; its tweens just complete instantly.
 */
export class CommandContext {
    private readonly abort = new AbortController();
    private readonly anims = new Set<gsap.core.Animation>();
    readonly speed: number;

    constructor(speed: number) {
        this.speed = speed;
    }

    get skipped(): boolean {
        return this.abort.signal.aborted;
    }

    /** Hook non-GSAP cleanup (Howler sounds, particles) to skip. */
    get signal(): AbortSignal {
        return this.abort.signal;
    }

    /** Await a tween/timeline. On skip it is jumped to its end - never kill()ed, which would hang the promise. */
    play(anim: gsap.core.Animation): Promise<void> {
        anim.timeScale(anim.timeScale() * this.speed);
        if (this.skipped) {
            anim.totalProgress(1);
            return Promise.resolve();
        }
        this.anims.add(anim);
        return new Promise<void>((resolve) => {
            const done = () => {
                this.anims.delete(anim);
                this.abort.signal.removeEventListener('abort', done);
                resolve();
            };
            this.abort.signal.addEventListener('abort', done);
            anim.then(done); // .then() keeps the tween's own onComplete intact
        });
    }

    /** Skippable delay that respects gsap.globalTimeline pause (e.g. pause popup). */
    wait(seconds: number): Promise<void> {
        return this.play(gsap.delayedCall(seconds, () => {}));
    }

    skip(): void {
        if (this.skipped) return;
        const running = [...this.anims];
        this.abort.abort();
        for (const anim of running) anim.totalProgress(1);
    }
}

export type Command = (ctx: CommandContext) => void | Promise<void>;

export interface CommandOptions {
    /** Non-skippable commands ignore skip()/fastForward() (e.g. a mandatory big-win minimum). */
    skippable?: boolean;
    /** Watchdog: a command that hangs longer than this is force-skipped and the queue moves on. */
    timeoutMs?: number;
}

interface Entry {
    name: string;
    run: Command;
    skippable: boolean;
    timeoutMs: number;
}

export class CommandQueue {
    private readonly entries: Entry[] = [];
    private current: Entry | null = null;
    private ctx: CommandContext | null = null;
    private draining: Promise<void> | null = null;
    private fastForwarding = false;
    private generation = 0;
    /** Turbo mode: multiplies the timeScale of everything played via ctx.play(). */
    speed = 1;

    add(name: string, run: Command, opts: CommandOptions = {}): this {
        this.entries.push({ name, run, skippable: opts.skippable ?? true, timeoutMs: opts.timeoutMs ?? 10_000 });
        return this;
    }

    /** Drain the queue. Calling it again while draining returns the same promise. */
    run(): Promise<void> {
        return (this.draining ??= this.drain());
    }

    get busy(): boolean {
        return this.draining !== null;
    }

    /** Fast-forward the current command only. */
    skip(): void {
        if (this.current?.skippable) this.ctx?.skip();
    }

    /** Fast-forward the current command and every queued one to their end states. */
    fastForward(): void {
        this.fastForwarding = true;
        this.skip();
    }

    /** Hard reset (screen change, server resync). An in-flight drain() exits without touching new state. */
    clear(): void {
        this.generation++;
        this.entries.length = 0;
        this.ctx?.skip();
        this.ctx = null;
        this.current = null;
        this.draining = null;
        this.fastForwarding = false;
    }

    private async drain(): Promise<void> {
        const generation = this.generation;
        try {
            while (this.entries.length && generation === this.generation) {
                const entry = this.entries.shift()!;
                const ctx = new CommandContext(this.speed);
                this.current = entry;
                this.ctx = ctx;
                if (this.fastForwarding && entry.skippable) ctx.skip();
                await this.execute(entry, ctx);
            }
        } finally {
            if (generation === this.generation) {
                this.current = null;
                this.ctx = null;
                this.draining = null;
                this.fastForwarding = false;
            }
        }
    }

    private async execute(entry: Entry, ctx: CommandContext): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const watchdog = new Promise<void>((resolve) => {
            timer = setTimeout(() => {
                console.warn(`[CommandQueue] "${entry.name}" timed out - forcing`);
                ctx.skip();
                resolve();
            }, entry.timeoutMs);
        });
        try {
            await Promise.race([Promise.resolve().then(() => entry.run(ctx)), watchdog]);
        } catch (err) {
            console.error(`[CommandQueue] "${entry.name}" threw`, err);
            ctx.skip();
        } finally {
            clearTimeout(timer);
        }
    }
}
