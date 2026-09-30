export interface PageResult<T> { rows: T[]; total: number }
export interface PageRequest { page: number; pageSize: number }

export function pageRange({ page, pageSize }: PageRequest) {
  const from = (Math.max(1, page) - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

export function resetPage(setPage: (page: number) => void) {
  setPage(1);
}
