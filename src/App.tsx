import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { supabaseConfigured } from './lib/supabase';
import Layout from './components/Layout';
import { Alert, Spinner } from './components/ui';
import { ForgotPasswordPage, LoginPage, PendingPage, ResetPasswordPage, SignupPage, homeFor } from './pages/auth/AuthPages';
import JudgeHome from './pages/judge/JudgeHome';
import EvaluationPage from './pages/judge/EvaluationPage';
import LeaderboardPage from './pages/LeaderboardPage';
import Dashboard from './pages/admin/Dashboard';
import TeamsPage from './pages/admin/TeamsPage';
import JudgesPage from './pages/admin/JudgesPage';
import ResultsPage from './pages/admin/ResultsPage';
import AdminEvaluationView from './pages/admin/AdminEvaluationView';
import AuditPage from './pages/admin/AuditPage';

function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { session, profile, loading, isAdmin } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Checking your session…" />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (!profile) return <Spinner label="Loading your profile…" />;
  if (profile.status !== 'approved') return <Navigate to="/pending" replace />;
  if (admin && !isAdmin) return <Navigate to="/judge" replace />;
  return <>{children}</>;
}

function Home() {
  const { session, profile, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!session) return <Navigate to="/login" replace />;
  if (!profile) return <Spinner label="Loading your profile…" />;
  return <Navigate to={homeFor(profile)} replace />;
}

export default function App() {
  if (!supabaseConfigured) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <Alert tone="error" title="Supabase is not configured">
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see <code>.env.example</code> and the README), then rebuild.
        </Alert>
      </div>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/pending" element={<PendingPage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/judge" element={<RequireAuth><JudgeHome /></RequireAuth>} />
        <Route path="/evaluate/:teamId" element={<RequireAuth><EvaluationPage /></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth admin><Dashboard /></RequireAuth>} />
        <Route path="/admin/teams" element={<RequireAuth admin><TeamsPage /></RequireAuth>} />
        <Route path="/admin/judges" element={<RequireAuth admin><JudgesPage /></RequireAuth>} />
        <Route path="/admin/results" element={<RequireAuth admin><ResultsPage /></RequireAuth>} />
        <Route path="/admin/evaluations/:id" element={<RequireAuth admin><AdminEvaluationView /></RequireAuth>} />
        <Route path="/admin/audit" element={<RequireAuth admin><AuditPage /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
