import { redirect } from 'next/navigation';
import { isSetupComplete } from '@/lib/setup';
import { LoginForm } from './LoginForm';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ShieldCheck } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (!(await isSetupComplete())) {
    redirect('/setup');
  }

  return (
    <main className="relative min-h-screen">
      <div className="fixed right-4 top-4 z-50">
        <ThemeToggle className="bg-bg-card/90 border border-border shadow-card" />
      </div>
      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-8 px-6 py-12">
        <Logo />

        <div className="card card-pad w-full animate-fade-in">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Welcome back</h1>
            <p className="mt-1 text-sm text-ink-muted">Sign in to manage your VPS fleet.</p>
          </div>
          <LoginForm />
        </div>

        <div className="flex items-center gap-2 text-xs text-ink-soft">
          <ShieldCheck className="h-3.5 w-3.5" />
          Self-hosted · Open source
        </div>
      </div>
    </main>
  );
}
