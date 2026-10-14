import { connection } from 'next/server';
import { Suspense } from 'react';
import { getHealth, type DependencyStatus } from '@/lib/api';
import styles from './page.module.css';

export default function Home() {
  return (
    <main className={styles.main}>
      <h1 className={styles.title}>TwitterMF</h1>
      <p className={styles.tagline}>
        A scalable Twitter clone, built one concept at a time.
      </p>
      <Suspense fallback={<p className={styles.status}>Checking API…</p>}>
        <ApiStatus />
      </Suspense>
    </main>
  );
}

async function ApiStatus() {
  // Health must be checked on every request, never baked in at build time.
  await connection();
  const health = await getHealth();

  if (!health) {
    return (
      <p className={styles.status}>
        <Dot ok={false} /> API: unreachable. Is <code>npm run dev</code>{' '}
        running?
      </p>
    );
  }

  return (
    <p className={styles.status}>
      <Item label="API" ok={health.status === 'ok'} text={health.status} />
      <Item label="DB" ok={health.db === 'up'} text={health.db} />
      <Item label="Redis" ok={health.redis === 'up'} text={health.redis} />
    </p>
  );
}

function Item(props: {
  label: string;
  ok: boolean;
  text: DependencyStatus | string;
}) {
  return (
    <span className={styles.item}>
      <Dot ok={props.ok} /> {props.label}: {props.text}
    </span>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden
      className={`${styles.dot} ${ok ? styles.up : styles.down}`}
    />
  );
}
