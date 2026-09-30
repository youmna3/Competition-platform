import clsx from 'clsx';
import type { ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Activity, BarChart3, BookOpen, ClipboardCheck, History, LayoutDashboard, ListChecks, LogIn, LogOut, Trophy, Users, UsersRound } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

interface NavItem { to: string; label: string; icon: ReactNode; end?: boolean }

/** iSchool primary logo + product name. `inverted` = white logo for blue backgrounds. */
export function Brand({ inverted = false, to = '/' }: { inverted?: boolean; to?: string }) {
  return (
    <Link to={to} className="flex min-w-0 shrink-0 items-center gap-3" aria-label="iSchool Judging Platform — home">
      <img
        src={inverted ? '/brand/ischool-logo-white.svg' : '/brand/ischool-logo.svg'}
        alt="iSchool"
        className="h-8 w-auto sm:h-9"
        width={inverted ? 108 : 125}
        height={36}
      />
      <span className={clsx('hidden h-8 w-px sm:block', inverted ? 'bg-white/30' : 'bg-slate-200')} aria-hidden />
      <span className="hidden leading-tight sm:block">
        <span className={clsx('block text-sm font-semibold', inverted ? 'text-white' : 'text-slate-900')}>DEMI · DECI</span>
        <span className={clsx('block text-[11px] font-medium', inverted ? 'text-white/75' : 'text-slate-500')}>Judging Platform</span>
      </span>
    </Link>
  );
}

export default function Layout() {
  const { profile, isAdmin, isApproved, signOut, session } = useAuth();
  const navigate = useNavigate();

  const items: NavItem[] = [];
  if (isAdmin) {
    items.push(
      { to: '/admin', label: 'Dashboard', icon: <LayoutDashboard size={16} />, end: true },
      { to: '/admin/teams', label: 'Teams', icon: <UsersRound size={16} /> },
      { to: '/admin/judges', label: 'Judges', icon: <Users size={16} /> },
      { to: '/admin/judge-progress', label: 'Judge Progress', icon: <Activity size={16} /> },
      { to: '/admin/results', label: 'Evaluations', icon: <BarChart3 size={16} /> },
      { to: '/admin/rubrics', label: 'Rubric Management', icon: <BookOpen size={16} /> },
      { to: '/admin/audit', label: 'Audit Log', icon: <History size={16} /> },
    );
  }
  if (isApproved) items.push({ to: '/judge', label: 'My Evaluations', icon: <ClipboardCheck size={16} />, end: true });
  if (isApproved && !isAdmin) items.push({ to: '/judge/assigned-teams', label: 'Assigned Teams', icon: <ListChecks size={16} /> });
  if (isApproved && !isAdmin) items.push({ to: '/judge/rubrics', label: 'Rubrics', icon: <BookOpen size={16} /> });
  if (isAdmin) items.push({ to: '/leaderboard', label: 'Leaderboard', icon: <Trophy size={16} /> });

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="brand-stripe h-1" aria-hidden />
        <div data-testid="header-row" className="mx-auto flex max-w-[1600px] flex-col gap-2 px-4 py-2 sm:px-6">
          <div className="flex min-h-12 min-w-0 items-center justify-between gap-3">
            <div data-testid="header-brand" className="shrink-0"><Brand /></div>
            {session ? <div data-testid="header-account" className="min-w-0 text-right">
              <p className="max-w-[240px] truncate text-sm font-medium text-slate-900">{profile?.full_name || profile?.email}</p>
              <p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">{profile?.role === 'admin' ? 'Administrator' : 'Judge'}{profile && profile.status !== 'approved' && ` · ${profile.status}`}</p>
            </div> : <Link to="/login" className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"><LogIn size={16}/> Sign in</Link>}
          </div>
          {session && <nav className="flex w-full flex-wrap items-center gap-1 border-t border-slate-100 pt-2" aria-label="Primary navigation">
            {items.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                end={i.end}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition',
                    isActive ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-brand-50 hover:text-brand-700',
                  )
                }
              >
                {i.icon}
                {i.label}
              </NavLink>
            ))}
            <button
              onClick={async () => { await signOut(); navigate('/login'); }}
              className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <LogOut size={16}/> Sign Out
            </button>
          </nav>}
          </div>
      </header>
      <main className="mx-auto min-h-[calc(100vh-10rem)] w-full min-w-0 max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-5 text-xs text-slate-500 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2.5">
            <img src="/brand/ischool-icon.svg" alt="" className="h-6 w-auto" width={20} height={24} />
            <span>DEMI · DECI Stage 3 Judging Platform</span>
          </div>
          <span>© {new Date().getFullYear()} iSchool Ltd. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}
