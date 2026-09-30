import { useEffect } from 'react';
import { Button, Select } from './ui';

export const PAGE_SIZES = [20, 50, 100] as const;

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export default function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  useEffect(() => {
    if (page > pages) onPageChange(pages);
  }, [page, pages, onPageChange]);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(total, safePage * pageSize);
  const candidates = [...new Set([1, safePage - 1, safePage, safePage + 1, pages])].filter((value) => value >= 1 && value <= pages);
  return <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
    <div className="flex items-center gap-2 text-slate-600"><span>{start}–{end} of {total}</span><Select aria-label="Rows per page" className="w-24 py-1.5" value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</Select></div>
    <div className="flex flex-wrap items-center gap-1"><Button size="sm" variant="secondary" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)}>Previous</Button>{candidates.map((candidate, index) => <span key={candidate} className="contents">{index > 0 && candidate - candidates[index - 1] > 1 && <span className="px-1 text-slate-400">…</span>}<Button size="sm" variant={candidate === safePage ? 'primary' : 'ghost'} aria-current={candidate === safePage ? 'page' : undefined} onClick={() => onPageChange(candidate)}>{candidate}</Button></span>)}<Button size="sm" variant="secondary" disabled={safePage >= pages} onClick={() => onPageChange(safePage + 1)}>Next</Button></div>
  </div>;
}
