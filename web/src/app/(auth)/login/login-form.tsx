'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/password-input';
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
          className="h-11"
          id="username"
          name="username"
          autoComplete="username"
          required
          autoFocus
        />
      </FormField>
      <FormField id="password" label="Password" error={error}>
        <PasswordInput
          id="password"
          name="password"
          className="h-11"
          autoComplete="current-password"
          required
          aria-invalid={!!error}
        />
      </FormField>
      <Button
        type="submit"
        size="lg"
        className="mt-2 h-11 rounded-full text-[15px] font-bold"
        disabled={busy}
      >
        {busy ? 'Logging in…' : 'Log in'}
      </Button>
    </form>
  );
}
