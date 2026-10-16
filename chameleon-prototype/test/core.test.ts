import { it, expect } from 'vitest';

// The starter's stress script (FSM spam / stale async / watchdog / skip / clear) run under vitest.
it('FSM + SequenceRunner stress suite passes', async () => {
    const exit = process.exit;
    let code = -1;
    (process as { exit: (c?: number) => void }).exit = (c?: number) => {
        code = c ?? 0;
    };
    try {
        await import('./stress-core');
    } finally {
        process.exit = exit;
    }
    expect(code).toBe(0);
}, 20000);
