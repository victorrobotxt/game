import gsap from 'gsap';
import { FSM } from '../src/core/FSM';
import { CommandQueue } from '../src/core/CommandQueue';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name: string, ok: boolean) => { console.log(ok ? 'PASS' : 'FAIL', name); if (!ok) fails++; };

// 1. Spam: 1000 SPINs in one tick -> exactly one transition
{
  let enters = 0;
  const fsm = new FSM<'IDLE' | 'BUSY', 'GO' | 'DONE'>({
    IDLE: { on: { GO: 'BUSY' } },
    BUSY: { on: { DONE: 'IDLE' }, async enter(ctx) { enters++; await sleep(20); ctx.send('DONE'); } },
  }, 'IDLE', 'IDLE');
  let accepted = 0;
  for (let i = 0; i < 1000; i++) if (fsm.send('GO')) accepted++;
  await sleep(40);
  check('spam -> 1 transition, back to IDLE', accepted === 1 && enters === 1 && fsm.state === 'IDLE');
}

// 2. Stale async: state left early, late completion must not move the machine
{
  const fsm = new FSM<'A' | 'B' | 'C', 'toB' | 'toC' | 'late'>({
    A: { on: { toB: 'B' } },
    B: { on: { toC: 'C', late: 'A' }, async enter(ctx) { await sleep(30); ctx.send('late'); } },
    C: { on: { late: 'A' } },
  }, 'A', 'A');
  fsm.send('toB'); fsm.send('toC');
  await sleep(50);
  check('stale ctx.send ignored (stays in C)', fsm.state === 'C');
}

// 3. Throwing enter -> error state, watchdog -> recovery
{
  const fsm = new FSM<'IDLE' | 'BAD' | 'HANG' | 'ERR', 'bad' | 'hang' | 'timeout' | 'ok'>({
    IDLE: { on: { bad: 'BAD', hang: 'HANG' } },
    BAD: { on: {}, async enter() { throw new Error('boom'); } },
    HANG: { on: { timeout: 'IDLE' }, timeoutMs: 30, timeoutEvent: 'timeout', enter() { return new Promise(() => {}); } },
    ERR: { on: { ok: 'IDLE' } },
  }, 'IDLE', 'ERR');
  const origErr = console.error; console.error = () => {};
  fsm.send('bad'); await sleep(5);
  console.error = origErr;
  check('rejected enter -> ERR', fsm.state === 'ERR');
  fsm.send('ok'); fsm.send('hang');
  const origWarn = console.warn; console.warn = () => {};
  await sleep(50); console.warn = origWarn;
  check('hung state -> watchdog back to IDLE', fsm.state === 'IDLE');
}

// 4. Queue: fastForward lands every command at its END value quickly
{
  const q = new CommandQueue();
  const obj = { a: 0, b: 0, c: 0 };
  q.add('a', (c) => c.play(gsap.to(obj, { a: 100, duration: 5 })));
  q.add('b', async (c) => { await c.wait(5); obj.b = 1; });
  q.add('c', (c) => c.play(gsap.to(obj, { c: 7, duration: 5 })));
  const t0 = Date.now();
  const p = q.run();
  await sleep(30);
  q.fastForward(); q.fastForward(); q.skip(); // spam
  await p;
  check(`fastForward -> final state in ${Date.now() - t0}ms`, obj.a === 100 && obj.b === 1 && obj.c === 7 && Date.now() - t0 < 300);
  check('queue idle after drain', !q.busy);
}

// 5. skip() only skips current; non-skippable ignores skip
{
  const q = new CommandQueue();
  const obj = { x: 0, y: 0 };
  q.add('x', (c) => c.play(gsap.to(obj, { x: 1, duration: 5 })));
  q.add('y', (c) => c.play(gsap.to(obj, { y: 1, duration: 0.15 })), { skippable: false });
  const p = q.run();
  await sleep(20); q.skip();
  await sleep(20);
  check('skip() finished current only', obj.x === 1 && obj.y < 1);
  q.fastForward();
  await sleep(20);
  check('non-skippable command keeps running', obj.y < 1);
  await p;
  check('non-skippable completed naturally', obj.y === 1);
}

// 6. Hanging / throwing command -> watchdog, queue continues
{
  const q = new CommandQueue();
  let after = false;
  const w = console.warn, e = console.error; console.warn = () => {}; console.error = () => {};
  q.add('hang', () => new Promise(() => {}), { timeoutMs: 40 });
  q.add('throw', () => { throw new Error('x'); });
  q.add('after', () => { after = true; });
  await q.run();
  console.warn = w; console.error = e;
  check('hung + throwing commands do not block queue', after);
}

// 7. clear() mid-drain, then reuse: no double loops
{
  const q = new CommandQueue();
  let runs = 0;
  q.add('long', (c) => c.wait(5));
  q.add('never', () => { runs += 100; });
  const p1 = q.run();
  await sleep(10); q.clear();
  q.add('next', () => { runs++; });
  await q.run(); await p1;
  check('clear() drops old queue, new run executes once', runs === 1);
}

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
