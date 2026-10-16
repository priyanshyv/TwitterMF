// `npm run dev:stop`: stops a running `npm run dev` from this repo, wherever
// it was started (another terminal tab, a closed editor window...). It sends
// Ctrl+C (SIGINT), so the apps shut down gracefully.
import { styleText } from 'node:util';
import { devRunnerAbove, isAlive, PORTS, portHolder } from './dev-lib.mjs';

const runners = new Map();
const strangers = [];
for (const [name, port] of Object.entries(PORTS)) {
  const holder = portHolder(port);
  if (!holder) continue;
  const runner = devRunnerAbove(holder.pid);
  if (runner) runners.set(runner.pid, runner);
  else strangers.push({ name, port, holder });
}

if (runners.size === 0 && strangers.length === 0) {
  console.log('Nothing to stop: ports 4000 and 3001 are free.');
  process.exit(0);
}

for (const runner of runners.values()) {
  console.log(
    `Stopping npm run dev (pid ${runner.pid}, ${runner.tty}, started ${runner.started})…`,
  );
  process.kill(runner.pid, 'SIGINT');
}
const deadline = Date.now() + 15_000;
while ([...runners.keys()].some(isAlive) && Date.now() < deadline)
  await new Promise((r) => setTimeout(r, 200));
const stillUp = [...runners.keys()].filter(isAlive);
if (stillUp.length)
  console.log(
    styleText(
      'yellow',
      `Still running after 15 s; force it with: kill -9 ${stillUp.join(' ')}`,
    ),
  );
else if (runners.size) console.log(styleText('green', '✓ Stopped.'));

// Never kill something we didn't start: it might be another project.
for (const { name, port, holder } of strangers)
  console.log(
    styleText(
      'yellow',
      `Port ${port} (${name}) is held by pid ${holder.pid}, not by npm run dev:`,
    ) +
      `\n  ${holder.command}\n  Stop it yourself if it's safe: kill ${holder.pid}`,
  );
