// Helpers shared by `npm run dev` and `npm run dev:stop`: who is holding a
// port, and is it a dev runner from this repo? Uses `lsof` and `ps`, which
// macOS and Linux both have.
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(
  /\/$/,
  '',
);
export const PORTS = { api: 4000, web: 3001 };

export function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer()
      .once('error', () => resolve(false))
      .once('listening', () => server.close(() => resolve(true)))
      .listen(port);
  });
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

// The process listening on a port, if any.
export function portHolder(port) {
  const pid = Number(
    run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).split('\n')[0],
  );
  return pid ? describe(pid) : null;
}

export function describe(pid) {
  const line = run('ps', [
    '-o',
    'ppid=,tty=,lstart=,command=',
    '-p',
    String(pid),
  ]);
  if (!line) return null;
  const [ppid, tty, ...rest] = line.trim().split(/\s+/);
  // lstart is five words: "Fri Oct 16 12:01:42 2026"
  const started = rest.slice(0, 5).join(' ');
  const command = rest.slice(5).join(' ');
  return { pid, ppid: Number(ppid), tty, started, command };
}

function cwdOf(pid) {
  const out = run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  return (
    out
      .split('\n')
      .find((l) => l.startsWith('n'))
      ?.slice(1) ?? ''
  );
}

// Walks up from a process to the `node scripts/dev.mjs` that started it,
// if that runner belongs to this repo.
export function devRunnerAbove(pid) {
  for (let p = pid, hops = 0; p > 1 && hops < 10; hops++) {
    const info = describe(p);
    if (!info) return null;
    if (/node .*scripts\/dev\.mjs/.test(info.command) && cwdOf(p) === REPO)
      return info;
    p = info.ppid;
  }
  return null;
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
