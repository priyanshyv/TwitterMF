'use client';

import { Check, Loader2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api/client';
import type { UsernameAvailability } from '@/lib/api/types';

const USERNAME = /^[A-Za-z0-9_]{1,15}$/;

type Check =
  | { state: 'idle' | 'checking' | 'invalid' }
  | ({ state: 'done' } & UsernameAvailability);

export function SignupForm() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [result, setResult] = useState<UsernameAvailability | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const valid = USERNAME.test(username);

  // Ask the API 350ms after typing stops, not on every keystroke. Answers
  // for a name the user has since changed are ignored.
  useEffect(() => {
    if (!valid) return;
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const answer = await api<UsernameAvailability>(
          `/usernames/${username}`,
        );
        if (!stale) setResult(answer);
      } catch {
        // Leave it unchecked; sign-up itself still rejects a taken name.
      }
    }, 350);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [username, valid]);

  // Derived during render rather than stored, so it can never be out of
  // sync with what's in the input.
  const check: Check = !username
    ? { state: 'idle' }
    : !valid
      ? { state: 'invalid' }
      : result?.username === username
        ? { state: 'done', ...result }
        : { state: 'checking' };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setErrors({});
    try {
      await api('/auth/signup', {
        method: 'POST',
        body: {
          username,
          displayName: form.get('displayName'),
          password: form.get('password'),
        },
      });
      router.push('/');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.issues.length) {
        setErrors(
          Object.fromEntries(err.issues.map((i) => [i.path, i.message])),
        );
      } else {
        setErrors({
          username: err instanceof Error ? err.message : 'Sign-up failed',
        });
      }
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <FormField
        id="username"
        label="Username"
        error={errors.username}
        hint={<UsernameHint check={check} />}
      >
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
            @
          </span>
          <Input
            id="username"
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value.trim())}
            maxLength={15}
            autoComplete="username"
            className="pl-7"
            required
            autoFocus
            aria-invalid={
              check.state === 'invalid' ||
              (check.state === 'done' && !check.available)
            }
          />
        </div>
      </FormField>
      <FormField id="displayName" label="Name" error={errors.displayName}>
        <Input
          id="displayName"
          name="displayName"
          maxLength={50}
          autoComplete="name"
          required
        />
      </FormField>
      <FormField
        id="password"
        label="Password"
        error={errors.password}
        hint={
          <p className="text-sm text-muted-foreground">
            At least 8 characters.
          </p>
        }
      >
        <Input
          id="password"
          name="password"
          type="password"
          minLength={8}
          autoComplete="new-password"
          required
        />
      </FormField>
      <Button
        type="submit"
        disabled={
          busy ||
          (check.state === 'done' && !check.available) ||
          check.state === 'invalid'
        }
      >
        {busy ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  );
}

// Shows the answer, plus which layer gave it: the bloom filter alone, or the
// filter followed by a Postgres lookup.
function UsernameHint({ check }: { check: Check }) {
  const muted = 'text-sm text-muted-foreground';
  switch (check.state) {
    case 'idle':
      return (
        <p className={muted}>Letters, numbers and underscores, up to 15.</p>
      );
    case 'invalid':
      return (
        <p className="text-sm text-destructive">
          Use 1–15 letters, numbers or underscores.
        </p>
      );
    case 'checking':
      return (
        <p className={`${muted} flex items-center gap-1.5`}>
          <Loader2 className="size-3.5 animate-spin" /> Checking…
        </p>
      );
    case 'done':
      return (
        <div className="flex flex-col gap-0.5">
          <p
            className={`flex items-center gap-1.5 text-sm font-medium ${
              check.available
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-destructive'
            }`}
          >
            {check.available ? (
              <Check className="size-3.5" />
            ) : (
              <X className="size-3.5" />
            )}
            @{check.username} is {check.available ? 'available' : 'taken'}
          </p>
          <p className="text-xs text-muted-foreground">
            {check.checkedBy === 'bloom'
              ? 'Answered by the bloom filter alone: no database query.'
              : check.available
                ? 'Bloom filter said "maybe" (a false positive); Postgres says it’s free.'
                : 'Bloom filter said "maybe"; Postgres confirmed it.'}
          </p>
        </div>
      );
  }
}
