import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Clock, MailCheck, ShieldX, Trophy } from 'lucide-react';
import { supabase, errorMessage } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { Brand } from '@/components/Layout';

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
        <Brand inverted to="/leaderboard" />
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
        <div className="flex justify-end px-4 py-4 sm:px-8">
          <Link to="/leaderboard" className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50">
            <Trophy size={16} /> Leaderboard
          </Link>
        </div>
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

export function homeFor(profile: { role: string; status: string } | null) {
  if (!profile) return '/login';
  if (profile.status !== 'approved') return '/pending';
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

  if (!loading && session && profile) return <Navigate to={from && profile.status === 'approved' ? from : homeFor(profile)} replace />;

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
      footer={<>New judge? <Link to="/signup" className="font-semibold text-brand-600 hover:underline">Create an account</Link></>}
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

export function SignupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'confirm' | 'pending' | null>(null);
  const navigate = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: name.trim() }, emailRedirectTo: `${window.location.origin}/pending` },
    });
    setBusy(false);
    if (error) return setError(error.message);
    if (data.session) navigate('/pending', { replace: true });
    else setDone('confirm');
  };

  if (done) {
    return (
      <AuthShell title="Check your inbox" footer={<Link to="/login" className="font-semibold text-brand-600 hover:underline">Back to sign in</Link>}>
        <div className="flex flex-col items-center text-center">
          <MailCheck className="mb-3 h-10 w-10 text-brand-600" />
          <p className="text-sm text-slate-600">
            We sent a confirmation link to <strong>{email}</strong>. After confirming, an administrator must approve your judge account before you can access teams.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Judge registration"
      subtitle="Accounts are activated after administrator approval"
      footer={<>Already registered? <Link to="/login" className="font-semibold text-brand-600 hover:underline">Sign in</Link></>}
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Full name" required>
          <Input required maxLength={200} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="E-mail" required>
          <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" hint="At least 8 characters" required>
          <Input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm password" required>
          <Input type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={busy}>Create account</Button>
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
  const { session } = useAuth();
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
    else navigate('/', { replace: true });
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
            : <>Thanks for registering, <strong>{profile?.full_name || session.user.email}</strong>. An administrator needs to approve your account and assign teams before you can start judging. This page updates automatically.</>}
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
