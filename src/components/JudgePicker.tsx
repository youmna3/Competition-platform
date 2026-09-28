import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Profile } from '@/lib/types';
import { Input } from './ui';

export default function JudgePicker({ judges, selected, onChange, counts }: {
  judges: Profile[]; selected: Set<string>; onChange: (next: Set<string>) => void; counts?: Map<string, number>;
}) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return judges
      .filter((j) => !s || j.full_name.toLowerCase().includes(s) || j.email.toLowerCase().includes(s))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [judges, q]);
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  return (
    <div className="rounded-lg border border-slate-200">
      <div className="relative border-b border-slate-200 p-2">
        <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input className="pl-8" placeholder="Search judges…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto">
        {list.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-500">No approved judges found.</li>}
        {list.map((j) => (
          <li key={j.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" checked={selected.has(j.id)} onChange={() => toggle(j.id)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">{j.full_name || j.email}</span>
                <span className="block truncate text-xs text-slate-500">{j.email}{j.role === 'admin' && ' · admin'}</span>
              </span>
              {counts && <span className="text-xs text-slate-400">{counts.get(j.id) ?? 0} teams</span>}
            </label>
          </li>
        ))}
      </ul>
      <p className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500">{selected.size} selected — every selected judge must submit before the team's score is official.</p>
    </div>
  );
}
