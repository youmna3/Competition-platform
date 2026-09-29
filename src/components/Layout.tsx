import clsx from 'clsx';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, BookOpen, ClipboardCheck, History, LayoutDashboard, LogIn, LogOut, Menu, Trophy, Users, UsersRound, X } from 'lucide-react';
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
      <span className={clsx('hidden h-8 w-px sm:block', !inverted && 'xl:hidden 2xl:block', inverted ? 'bg-white/30' : 'bg-slate-200')} aria-hidden />
      <span className={clsx('hidden leading-tight sm:block', !inverted && 'xl:hidden 2xl:block')}>
        <span className={clsx('block text-sm font-semibold', inverted ? 'text-white' : 'text-slate-900')}>DEMI · DECI</span>
        <span className={clsx('block text-[11px] font-medium', inverted ? 'text-white/75' : 'text-slate-500')}>Judging Platform</span>
      </span>
    </Link>
  );
}

export default function Layout() {
  const { profile, isAdmin, isApproved, signOut, session } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    const desktop = window.matchMedia('(min-width: 1600px)');
    const closeOnDesktop = (event: MediaQueryListEvent) => { if (event.matches) setOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    desktop.addEventListener('change', closeOnDesktop);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      desktop.removeEventListener('change', closeOnDesktop);
    };
  }, [open]);

  const items: NavItem[] = [];
  if (isAdmin) {
    items.push(
      { to: '/admin', label: 'Dashboard', icon: <LayoutDashboard size={16} />, end: true },
      { to: '/admin/teams', label: 'Teams', icon: <UsersRound size={16} /> },
      { to: '/admin/judges', label: 'Judges', icon: <Users size={16} /> },
      { to: '/admin/results', label: 'Evaluations', icon: <BarChart3 size={16} /> },
      { to: '/admin/rubrics', label: 'Rubric Management', icon: <BookOpen size={16} /> },
      { to: '/admin/audit', label: 'Audit log', icon: <History size={16} /> },
    );
  }
  if (isApproved) items.push({ to: '/judge', label: 'My evaluations', icon: <ClipboardCheck size={16} /> });
  if (isApproved) items.push({ to: '/leaderboard', label: 'Leaderboard', icon: <Trophy size={16} /> });

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="brand-stripe h-1" aria-hidden />
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6">
          <Brand />
          <nav className="hidden min-w-0 items-center gap-1 min-[1600px]:flex" aria-label="Primary navigation">
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
          </nav>
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            {session ? (
              <>
                <div className="hidden text-right sm:block">
                  <p className="max-w-[180px] truncate text-sm font-medium text-slate-900">{profile?.full_name || profile?.email}</p>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    {profile?.role === 'admin' ? 'Administrator' : 'Judge'}
                    {profile && profile.status !== 'approved' && ` · ${profile.status}`}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    await signOut();
                    navigate('/login');
                  }}
                  className="hidden rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 sm:block"
                  title="Sign out"
                  aria-label="Sign out"
                >
                  <LogOut size={18} />
                </button>
              </>
            ) : (
              <Link to="/login" className="hidden items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 sm:flex">
                <LogIn size={16} /> Sign in
              </Link>
            )}
            <button
              className="rounded-full p-2 text-slate-600 hover:bg-slate-100 min-[1600px]:hidden"
              onClick={() => setOpen((o) => !o)}
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              aria-controls="responsive-navigation"
            >
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
        {open && (
          <div id="responsive-navigation" className="max-h-[calc(100vh-4.25rem)] overflow-y-auto border-t border-slate-200 bg-white px-4 py-3 min-[1600px]:hidden">
            <nav className="mx-auto grid max-w-7xl gap-1" aria-label="Responsive navigation">
              {session && (
                <div className="mb-2 min-w-0 rounded-xl bg-slate-50 px-3 py-2 sm:hidden">
                  <p className="truncate text-sm font-medium text-slate-900">{profile?.full_name || profile?.email}</p>
                  <p className="truncate text-xs text-slate-500">{profile?.email}</p>
                </div>
              )}
              {items.map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  end={i.end}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    clsx('flex items-center gap-2 rounded-full px-3 py-2.5 text-sm font-medium', isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-100')
                  }
                >
                  {i.icon}
                  {i.label}
                </NavLink>
              ))}
              {session ? (
                <button
                  onClick={async () => {
                    setOpen(false);
                    await signOut();
                    navigate('/login');
                  }}
                  className="flex min-w-0 items-center gap-2 rounded-full px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  <LogOut className="shrink-0" size={16} /> Sign out
                </button>
              ) : (
                <NavLink to="/login" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-full px-3 py-2.5 text-sm font-medium text-brand-700">
                  <LogIn size={16} /> Sign in
                </NavLink>
              )}
            </nav>
          </div>
        )}
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
