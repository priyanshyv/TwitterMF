// `npm run dev`: start Postgres + Redis, then the API and web app, with one
// short, prefixed line per log message. Ctrl+C stops everything.
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { styleText } from 'node:util';
import { devRunnerAbove, isPortFree, PORTS, portHolder } from './dev-lib.mjs';

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
  /^\[tsx\]/,
];

const APPS = [
  { name: 'api', color: 'cyan', workspace: 'api', script: 'dev' },
  { name: 'web', color: 'magenta', workspace: 'web', script: 'dev' },
  // Background jobs (fan-out, notifications): a separate process, so slow
  // jobs never slow down requests.
  { name: 'job', color: 'yellow', workspace: 'api', script: 'worker:dev' },
];

const dim = (s) => styleText('dim', s);

function fail(message, details = '') {
  console.error(`\n${styleText('red', '✗')} ${message}`);
  if (details) console.error(dim(details.trim()));
  process.exit(1);
}

// 0. The ports must be free. The usual reason they aren't: npm run dev is
//    already running in another terminal tab.
for (const [name, port] of Object.entries(PORTS)) {
  if (await isPortFree(port)) continue;
  const holder = portHolder(port);
  const runner = holder && devRunnerAbove(holder.pid);
  if (runner)
    fail(
      `npm run dev is already running (pid ${runner.pid}, terminal ${runner.tty}, started ${runner.started}).\n` +
        `  Use it at http://localhost:${PORTS.web}, or stop it with: npm run dev:stop`,
    );
  fail(
    `Port ${port} (${name}) is already in use` +
      (holder ? ` by pid ${holder.pid}:\n  ${holder.command}` : '.') +
      `\n  Stop that process, then run npm run dev again.`,
  );
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
console.log(styleText('green', '✓'));

// 3. Bring the database schema up to date (no-op when nothing changed).
process.stdout.write(dim('  applying migrations…      '));
const migrate = spawnSync(
  'npm',
  ['run', 'db:migrate', '--silent', '-w', 'api'],
  {
    encoding: 'utf8',
  },
);
if (migrate.status !== 0)
  fail('Database migrations failed.', migrate.stderr || migrate.stdout);
console.log(`${styleText('green', '✓')}\n`);

let stopping = false;
const children = [];

// 4. The API first, then the web app once the API answers /health. Next.js
//    is ready in a fraction of a second while Nest compiles for a few, so
//    starting both at once means an open browser tab reloads against an API
//    that isn't up yet. FORCE_COLOR keeps their colors even though their
//    output is piped through this script.
function start(app) {
  const child = spawn(
    'npm',
    ['run', app.script, '--silent', '-w', app.workspace],
    {
      env: { ...process.env, FORCE_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
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
  children.push(child);
  return child;
}

async function waitForApi(api, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (!stopping && api.exitCode === null && Date.now() < deadline) {
    try {
      // Any answer counts, even 503: the server is up and listening.
      await fetch(`http://localhost:${PORTS.api}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return false;
}

const [apiApp, webApp, workerApp] = APPS;
const api = start(apiApp);
if (await waitForApi(api)) {
  start(webApp);
  start(workerApp);
} else if (!stopping) {
  console.log(
    `\n${styleText('red', '✗')} The API didn't come up within 90 s; see its output above.`,
  );
  stopping = true;
  stopAll();
  process.exitCode = 1;
}

function stopAll() {
  for (const child of children)
    if (child.exitCode === null) child.kill('SIGTERM');
}

// Ctrl+C (or the terminal tab closing, SIGHUP): let each app shut down
// gracefully (closes DB connections), then exit. Without SIGHUP, closing the
// tab could leave the apps running in the background, holding the ports.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
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
