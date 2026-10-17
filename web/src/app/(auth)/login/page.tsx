import { AuthCard } from '@/components/auth-card';
import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <AuthCard
      title="Log in"
      description="Welcome back."
      footer={{
        text: 'New here?',
        linkText: 'Create an account',
        href: '/signup',
      }}
    >
      <LoginForm />
    </AuthCard>
  );
}
