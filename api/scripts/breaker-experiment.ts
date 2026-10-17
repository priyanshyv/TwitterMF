// Circuit breaker lab: what a dead dependency costs with and without one.
// Run from the repo root:  npm run lab:breaker
// No services needed: the "search engine" here is simulated.
import CircuitBreaker from 'opossum';

const REQUESTS = 20;
const TIMEOUT_MS = 300; // how long we wait before calling a request failed

// A dependency that has stopped answering: requests hang (a dead host
// usually looks like this, not like a quick error).
let healthy = false;
const search = () =>
  healthy
    ? new Promise((resolve) => setTimeout(() => resolve('results'), 5))
    : new Promise(() => {}); // never answers

const withTimeout = <T>(p: Promise<T>) =>
  Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS),
    ),
  ]);

async function run(label: string, call: () => Promise<unknown>) {
  const times: number[] = [];
  const t0 = performance.now();
  for (let i = 0; i < REQUESTS; i++) {
    const t = performance.now();
    await call().catch(() => 'fallback'); // the caller falls back either way
    times.push(performance.now() - t);
  }
  return {
    setup: label,
    'total (ms)': Math.round(performance.now() - t0),
    'slowest (ms)': Math.round(Math.max(...times)),
    'last 10 avg (ms)': (
      times.slice(-10).reduce((a, b) => a + b, 0) / 10
    ).toFixed(2),
  };
}

const breaker = new CircuitBreaker(search, {
  timeout: TIMEOUT_MS,
  errorThresholdPercentage: 50,
  volumeThreshold: 5,
  resetTimeout: 1_000,
});
const events: string[] = [];
const t0 = performance.now();
const at = () => `${Math.round(performance.now() - t0)} ms`;
breaker.on('open', () => events.push(`${at()}: open (failing fast)`));
breaker.on('halfOpen', () =>
  events.push(`${at()}: half-open (one trial call)`),
);
breaker.on('close', () => events.push(`${at()}: closed (back to normal)`));

console.log(
  `The search engine has stopped answering. ${REQUESTS} requests in a row, each waits at most ${TIMEOUT_MS} ms:\n`,
);
console.table([
  await run('timeout only, no breaker', () => withTimeout(search())),
  await run('circuit breaker', () => breaker.fire()),
]);

console.log('\nNow the search engine recovers. The breaker notices by itself:');
healthy = true;
await new Promise((r) => setTimeout(r, 1_100)); // past resetTimeout
await breaker.fire().catch(() => {});
await breaker.fire();
console.log(events.map((e) => `  ${e}`).join('\n'));
console.log(
  '\nWithout a breaker every request pays the full timeout, so a dead dependency makes' +
    '\nevery page slow (and ties up a connection each). With one, after 5 failures the' +
    '\nrest fail in microseconds, the fallback answers, and a single trial call later' +
    '\ndetects the recovery.',
);
breaker.shutdown();
