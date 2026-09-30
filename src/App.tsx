import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { supabaseConfigured } from './lib/supabase';
import Layout from './components/Layout';
import { Alert, Spinner } from './components/ui';
import { ForgotPasswordPage, LoginPage, PendingPage, ResetPasswordPage, SetNewPasswordPage, homeFor } from './pages/auth/AuthPages';
import JudgeHome from './pages/judge/JudgeHome';
import AssignedTeamsPage from './pages/judge/AssignedTeamsPage';
import JudgeRubricsPage from './pages/judge/JudgeRubricsPage';
import EvaluationPage from './pages/judge/EvaluationPage';
import LeaderboardPage from './pages/LeaderboardPage';
import Dashboard from './pages/admin/Dashboard';
import TeamsPage from './pages/admin/TeamsPage';
import JudgesPage from './pages/admin/JudgesPage';
import ResultsPage from './pages/admin/ResultsPage';
import AdminEvaluationView from './pages/admin/AdminEvaluationView';
import AuditPage from './pages/admin/AuditPage';
import RubricManagementPage from './pages/admin/RubricManagementPage';
import RubricPreviewPage from './pages/admin/RubricPreviewPage';
import JudgeProgressPage from './pages/admin/JudgeProgressPage';

function RequireAuth({ children, admin, judge }: { children: ReactNode; admin?: boolean; judge?: boolean }) {
  const { session, profile, loading, isAdmin } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Checking your session…" />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (!profile) return <Spinner label="Loading your profile…" />;
  if (profile.status !== 'approved') return <Navigate to="/pending" replace />;
  if (profile.password_change_required) return <Navigate to="/set-new-password" replace />;
  if (admin && !isAdmin) return <Navigate to="/judge" replace />;
  if (judge && profile.role !== 'judge') return <Navigate to="/admin" replace />;
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
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/set-new-password" element={<SetNewPasswordPage />} />
      <Route path="/pending" element={<PendingPage />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="/" element={<Home />} />
        <Route path="/leaderboard" element={<RequireAuth admin><LeaderboardPage /></RequireAuth>} />
        <Route path="/judge" element={<RequireAuth><JudgeHome /></RequireAuth>} />
        <Route path="/judge/assigned-teams" element={<RequireAuth judge><AssignedTeamsPage /></RequireAuth>} />
        <Route path="/judge/rubrics" element={<RequireAuth judge><JudgeRubricsPage /></RequireAuth>} />
        <Route path="/evaluate/:teamId" element={<RequireAuth><EvaluationPage /></RequireAuth>} />
        <Route path="/rubrics/:templateId/preview" element={<RequireAuth><RubricPreviewPage /></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth admin><Dashboard /></RequireAuth>} />
        <Route path="/admin/teams" element={<RequireAuth admin><TeamsPage /></RequireAuth>} />
        <Route path="/admin/judges" element={<RequireAuth admin><JudgesPage /></RequireAuth>} />
        <Route path="/admin/judge-progress" element={<RequireAuth admin><JudgeProgressPage /></RequireAuth>} />
        <Route path="/admin/results" element={<RequireAuth admin><ResultsPage /></RequireAuth>} />
        <Route path="/admin/rubrics" element={<RequireAuth admin><RubricManagementPage /></RequireAuth>} />
        <Route path="/admin/rubrics/:templateId/preview" element={<RequireAuth admin><RubricPreviewPage /></RequireAuth>} />
        <Route path="/admin/evaluations/:id" element={<RequireAuth admin><AdminEvaluationView /></RequireAuth>} />
        <Route path="/admin/audit" element={<RequireAuth admin><AuditPage /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
