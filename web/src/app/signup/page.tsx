import { AuthCard } from '@/components/auth-card';
import { SignupForm } from './signup-form';

export default function SignupPage() {
  return (
    <AuthCard
      title="Create your account"
      description="Pick a username; we'll check it as you type."
      footer={{ text: 'Have an account?', linkText: 'Log in', href: '/login' }}
    >
      <SignupForm />
    </AuthCard>
  );
}
