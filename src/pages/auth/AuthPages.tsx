import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Clock, ShieldX } from 'lucide-react';
import { supabase, errorMessage } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { Brand } from '@/components/Layout';
import { acceptMyInvitation, completeRequiredPasswordChange } from '@/lib/api';

function BrandPanel() {
  return (
    <div className="relative flex flex-col justify-between overflow-hidden bg-brand-600 px-6 py-8 text-white sm:px-10 lg:min-h-screen lg:py-12">
      {/* iSchool graphic elements: planet rings, dots and plus marks in brand colours */}
      <svg className="pointer-events-none absolute -right-24 -top-24 hidden h-80 w-80 lg:block" viewBox="0 0 200 200" aria-hidden>
        <circle cx="100" cy="100" r="100" fill="#FFD700" />
        <circle cx="100" cy="100" r="93" fill="#FF7F1C" />
        <circle cx="100" cy="100" r="78" fill="#056FEC" />
        <circle cx="100" cy="100" r="59" fill="#FF7F1C" />
        <circle cx="100" cy="100" r="42" fill="#056FEC" />
        <circle cx="100" cy="100" r="14" fill="#FFD700" />
      </svg>
      <svg className="pointer-events-none absolute -bottom-40 -left-40 hidden h-[28rem] w-[28rem] lg:block" viewBox="0 0 200 200" aria-hidden>
        <circle cx="100" cy="100" r="98" fill="none" stroke="#05ACFF" strokeWidth="1.5" strokeDasharray="2 6" />
        <circle cx="100" cy="100" r="70" fill="none" stroke="#05ACFF" strokeWidth="1.5" opacity=".6" />
      </svg>
      <svg className="pointer-events-none absolute bottom-24 right-12 hidden h-10 w-10 lg:block" viewBox="0 0 24 24" aria-hidden>
        <path d="M12 3v18M3 12h18" stroke="#FFD700" strokeWidth="4" strokeLinecap="round" />
      </svg>
      <span className="pointer-events-none absolute right-[18%] top-[46%] hidden h-3 w-3 rounded-full bg-orange-500 lg:block" aria-hidden />
      <span className="pointer-events-none absolute bottom-[34%] right-[30%] hidden h-2 w-2 rounded-full bg-amber-300 lg:block" aria-hidden />

      <span className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full border-[14px] border-orange-500 lg:hidden" aria-hidden />
      <span className="pointer-events-none absolute right-6 top-6 h-4 w-4 rounded-full bg-amber-300 lg:hidden" aria-hidden />
      <div className="relative">
        <Brand inverted to="/login" />
      </div>
      <div className="relative mt-8 max-w-md lg:mt-0">
        <p className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-300" /> Stage 3 · Official judging
        </p>
        <h2 className="mt-4 text-3xl font-semibold leading-tight sm:text-4xl">
          Today&apos;s Generation,<br />
          <span className="text-amber-300">Tomorrow&apos;s Tech Leaders</span>
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-white/80">
          Digital rubrics, independent judging and live leaderboards for the DEMI and DECI competitions across Alexandria, Cairo, Monufia, Assiut and Suez.
        </p>
      </div>
      <p className="relative mt-8 hidden text-xs text-white/60 lg:block">© {new Date().getFullYear()} iSchool Ltd.</p>
    </div>
  );
}

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-slate-50 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <BrandPanel />
      <div className="flex flex-col">
        <div className="brand-stripe h-1 lg:hidden" aria-hidden />
        <div className="h-16" aria-hidden />
        <div className="flex flex-1 items-center justify-center px-4 pb-16 sm:px-8">
          <div className="w-full max-w-md">
            <div className="mb-6">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
              {subtitle && <p className="mt-2 text-sm text-slate-500">{subtitle}</p>}
            </div>
            <Card className="p-6 sm:p-8">{children}</Card>
            {footer && <div className="mt-6 text-center text-sm text-slate-600">{footer}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function homeFor(profile: { role: string; status: string; password_change_required?: boolean } | null) {
  if (!profile) return '/login';
  if (profile.status !== 'approved') return '/pending';
  if (profile.password_change_required) return '/set-new-password';
  return profile.role === 'admin' ? '/admin' : '/judge';
}

export function LoginPage() {
  const { session, profile, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  if (!loading && session && profile) return <Navigate to={from && profile.status === 'approved' && !profile.password_change_required ? from : homeFor(profile)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message === 'Invalid login credentials' ? 'Incorrect e-mail or password.' : error.message);
    else navigate(from ?? '/', { replace: true });
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle="Judges and administrators of the DEMI & DECI competitions"
      footer="Accounts are created and invited by competition administrators."
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="E-mail" required>
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" required>
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-brand-600 hover:underline">Forgot password?</Link>
        </div>
        <Button type="submit" className="w-full" size="lg" loading={busy}>Sign in</Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  };
  return (
    <AuthShell title="Reset password" footer={<Link to="/login" className="font-semibold text-brand-600 hover:underline">Back to sign in</Link>}>
      {sent ? (
        <Alert tone="success" title="E-mail sent">If an account exists for {email}, a reset link is on its way.</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="E-mail" required>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full" loading={busy}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { session, refreshProfile } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(errorMessage(error));
    else {
      try {
        if (new URLSearchParams(window.location.search).get('invitation') === '1') await acceptMyInvitation();
        await refreshProfile();
        navigate('/', { replace: true });
      } catch (activationError) {
        setError(errorMessage(activationError));
      }
    }
  };
  return (
    <AuthShell title="Choose a new password">
      {!session ? (
        <Alert tone="warning">Open this page from the link in your password-reset e-mail.</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="New password" hint="At least 8 characters" required>
            <Input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full" loading={busy}>Update password</Button>
        </form>
      )}
    </AuthShell>
  );
}

export function SetNewPasswordPage() {
  const { session, profile, loading, refreshProfile, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  if (loading) return null;
  if (!session) return <Navigate to="/login" replace />;
  if (profile && !profile.password_change_required) return <Navigate to={homeFor(profile)} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      return setError('Use at least 12 characters with uppercase, lowercase, a number and a symbol.');
    }
    if (password !== confirmPassword) return setError('The passwords do not match.');
    setBusy(true);
    try {
      await completeRequiredPasswordChange(password);
      await refreshProfile();
      navigate('/', { replace: true });
    } catch (changeError) {
      setError(errorMessage(changeError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Set a new password" subtitle="You must replace the temporary password before accessing the judging platform.">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="New password" hint="At least 12 characters, including uppercase, lowercase, a number and a symbol" required>
          <Input type="password" required minLength={12} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        <Field label="Confirm new password" required>
          <Input type="password" required minLength={12} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        </Field>
        <Button type="submit" className="w-full" loading={busy}>Set password and continue</Button>
        <Button type="button" variant="ghost" className="w-full" onClick={() => void signOut()}>Sign out</Button>
      </form>
    </AuthShell>
  );
}

export function PendingPage() {
  const { session, profile, loading, signOut, refreshProfile } = useAuth();
  const [checking, setChecking] = useState(false);
  if (loading) return null;
  if (!session) return <Navigate to="/login" replace />;
  if (profile?.status === 'approved') return <Navigate to={homeFor(profile)} replace />;
  const blocked = profile?.status === 'rejected' || profile?.status === 'disabled';
  return (
    <AuthShell title={blocked ? 'Access not available' : 'Awaiting approval'}>
      <div className="flex flex-col items-center text-center">
        {blocked ? <ShieldX className="mb-3 h-10 w-10 text-rose-500" /> : <Clock className="mb-3 h-10 w-10 text-amber-500" />}
        <p className="text-sm text-slate-600">
          {blocked
            ? 'Your judge account has been deactivated or was not approved. Contact the competition administrator if you believe this is a mistake.'
            : <>Your invited account for <strong>{profile?.full_name || session.user.email}</strong> is not active yet. Open the invitation link, set your password, or contact an administrator if the link expired.</>}
        </p>
        <div className="mt-6 flex gap-2">
          {!blocked && (
            <Button variant="secondary" loading={checking} onClick={async () => { setChecking(true); await refreshProfile(); setChecking(false); }}>
              Check again
            </Button>
          )}
          <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </div>
    </AuthShell>
  );
}
