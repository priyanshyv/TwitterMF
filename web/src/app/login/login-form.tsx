'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api/client';

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      await api('/auth/login', {
        method: 'POST',
        body: {
          username: form.get('username'),
          password: form.get('password'),
        },
      });
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log in');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <FormField id="username" label="Username">
        <Input
          id="username"
          name="username"
          autoComplete="username"
          required
          autoFocus
        />
      </FormField>
      <FormField id="password" label="Password" error={error}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={!!error}
        />
      </FormField>
      <Button type="submit" disabled={busy}>
        {busy ? 'Logging in…' : 'Log in'}
      </Button>
    </form>
  );
}
