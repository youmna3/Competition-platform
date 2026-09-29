import { describe, expect, it } from 'vitest';
import { navigationNeedsMenu } from './Layout';

describe('responsive primary navigation', () => {
  it('keeps tabs only when the measured header content fits', () => {
    expect(navigationNeedsMenu(1600, 230, 1050, 200)).toBe(false);
    expect(navigationNeedsMenu(1536, 230, 1050, 200)).toBe(true);
    expect(navigationNeedsMenu(1440, 230, 1050, 200)).toBe(true);
    expect(navigationNeedsMenu(1366, 230, 1050, 200)).toBe(true);
  });

  it('collapses judge navigation on tablet and mobile widths', () => {
    expect(navigationNeedsMenu(1024, 230, 320, 200)).toBe(false);
    expect(navigationNeedsMenu(768, 230, 320, 200)).toBe(true);
    expect(navigationNeedsMenu(375, 125, 320, 0)).toBe(true);
  });
});
