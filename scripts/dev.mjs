// `npm run dev`: start Postgres + Redis, then the API and web app, with one
// short, prefixed line per log message. Ctrl+C stops everything.
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { styleText } from 'node:util';

const COMPOSE = ['compose', '-f', 'infra/docker-compose.yml'];

// Startup banner lines that say nothing useful on every run.
const NOISE = [
  /^\s*$/,
  /^- Network:/,
  /^- Environments:/,
  /Running next\.config/,
  /Cache Components enabled/,
  /Partial Prefetching enabled/,
  /Starting compilation in watch mode/,
  /File change detected/,
];

const APPS = [
  { name: 'api', color: 'cyan', workspace: 'api' },
  { name: 'web', color: 'magenta', workspace: 'web' },
];

const dim = (s) => styleText('dim', s);

function fail(message, details = '') {
  console.error(`\n${styleText('red', '✗')} ${message}`);
  if (details) console.error(dim(details.trim()));
  process.exit(1);
}

// 1. Docker must be running before anything else.
if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
  fail(
    'Docker is not running. Open Docker Desktop, wait for it to start, then run npm run dev again.',
  );
}

// 2. Postgres + Redis. `--wait` blocks until their healthchecks pass.
process.stdout.write(dim('  starting postgres + redis… '));
const up = spawnSync('docker', [...COMPOSE, 'up', '-d', '--wait'], {
  encoding: 'utf8',
});
if (up.status !== 0)
  fail('Postgres or Redis failed to start.', up.stderr || up.stdout);
console.log(`${styleText('green', '✓')}\n`);

let stopping = false;

// 3. API and web side by side. FORCE_COLOR keeps their colors even though
//    their output is piped through this script.
const children = APPS.map((app) => {
  const child = spawn('npm', ['run', 'dev', '--silent', '-w', app.workspace], {
    env: { ...process.env, FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const prefix = `${styleText(app.color, app.name)} ${dim('│')} `;
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => {
      // Strip screen-clearing codes and ignore known banner noise.
      const clean = line.replace(/\x1b\[(2J|3J|H)/g, '');
      const plain = clean.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim();
      if (NOISE.some((re) => re.test(plain))) return;
      console.log(prefix + clean);
    });
  }
  child.on('exit', (code) => {
    if (stopping) return;
    stopping = true;
    console.log(
      `\n${styleText('red', '✗')} ${app.name} exited (code ${code}). Stopping the rest.`,
    );
    stopAll();
    process.exitCode = code ?? 1;
  });
  return child;
});

function stopAll() {
  for (const child of children)
    if (child.exitCode === null) child.kill('SIGTERM');
}

// Ctrl+C: let each app shut down gracefully (closes DB connections), then exit.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    console.log(
      dim(
        '\n  stopping… (postgres + redis keep running; npm run infra:down stops them)',
      ),
    );
    stopAll();
  });
}
