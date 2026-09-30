import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('responsive primary navigation', () => {
  const layout = readFileSync(new URL('./Layout.tsx', import.meta.url), 'utf8');

  it('renders every permitted tab in a visible wrapping navigation row', () => {
    expect(layout).toContain('flex w-full flex-wrap items-center');
    for (const label of ['Dashboard','Teams','Judges','Judge Progress','Evaluations','Rubric Management','Audit Log','My Evaluations','Leaderboard','Sign Out']) {
      expect(layout).toContain(label);
    }
  });

  it('has no expandable or hamburger navigation', () => {
    expect(layout).not.toContain('compactNavigation');
    expect(layout).not.toContain('responsive-navigation');
    expect(layout).not.toContain('aria-expanded');
  });
});
