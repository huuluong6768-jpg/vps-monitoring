'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

export function SetupForm() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    if (password.length < 8) {
      toast.error('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      toast.error('Passwords do not match.');
      return;
    }

    setLoading(true);
    const res = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      toast.error(data.error ?? 'Setup failed');
      return;
    }
    toast.success(`Welcome, ${data.username}!`);
    router.push('/dashboard');
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label className="label">Username</label>
        <input
          className="input"
          placeholder="admin"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          minLength={3}
          pattern="[a-zA-Z0-9_.\-]+"
          autoComplete="username"
        />
      </div>

      <div>
        <label className="label">Password</label>
        <div className="relative">
          <input
            className="input pr-11"
            type={show ? 'text' : 'password'}
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
          <button
            type="button"
            className="absolute inset-y-0 right-2 my-1.5 rounded-md px-2 text-ink-soft hover:bg-bg-muted hover:text-ink"
            onClick={() => setShow((s) => !s)}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div>
        <label className="label">Confirm password</label>
        <input
          className="input"
          type={show ? 'text' : 'password'}
          placeholder="Repeat your password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>

      <button type="submit" className="btn-primary w-full" disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
        {loading ? 'Creating account…' : 'Create admin account'}
      </button>

      <p className="text-center text-xs text-ink-soft">
        Once created, this account is the only way to sign in. Public sign-ups are disabled.
      </p>
    </form>
  );
}
