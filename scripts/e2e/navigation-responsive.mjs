import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const email = process.env.TEST_ADMIN_EMAIL;
const password = process.env.TEST_ADMIN_PASSWORD;
const mockedSession = !email || !password;

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
const context = await browser.newContext();
if (mockedSession) {
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'navigation-test@example.com',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: 'Navigation Test Administrator' },
    created_at: new Date().toISOString(),
  };
  const session = {
    access_token: 'navigation-layout-test-token',
    refresh_token: 'navigation-layout-test-refresh',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user,
  };
  await context.addInitScript(({ storageKey, sessionValue }) => {
    localStorage.setItem(storageKey, JSON.stringify(sessionValue));
  }, { storageKey: 'sb-kdkwctsqfpwreebhftyn-auth-token', sessionValue: session });
  await context.route('**/auth/v1/user', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) }));
  await context.route('**/rest/v1/**', (route) => {
    const url = new URL(route.request().url());
    const isProfile = url.pathname.endsWith('/profiles');
    const body = isProfile ? {
      id: user.id,
      email: user.email,
      full_name: user.user_metadata.full_name,
      role: 'admin',
      status: 'approved',
      password_change_required: false,
      created_at: new Date().toISOString(),
    } : [];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Content-Range': isProfile ? '0-0/1' : '*/0' },
      body: JSON.stringify(body),
    });
  });
}
const page = await context.newPage();
const results = [];
try {
  if (!mockedSession) {
    await page.goto(`${base}/login`);
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/admin(?:$|\/)/);
  }

  const cases = [
    ...[375, 768, 1024].map((physicalWidth) => ({ physicalWidth, zoom: 1 })),
    ...[1366, 1440, 1920].flatMap((physicalWidth) => [1, 1.1, 1.25].map((zoom) => ({ physicalWidth, zoom }))),
  ];
  const expectedItems = ['Dashboard', 'Teams', 'Judges', 'Evaluations', 'Rubric Management', 'Audit log', 'My evaluations', 'Leaderboard'];
  for (const entry of cases) {
    const effectiveWidth = Math.floor(entry.physicalWidth / entry.zoom);
    await page.setViewportSize({ width: effectiveWidth, height: entry.physicalWidth === 375 ? 812 : 900 });
    await page.goto(`${base}/admin/rubrics`);
    await page.getByTestId('rubric-management').waitFor();
    await page.evaluate(() => document.fonts.ready);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    const row = await page.getByTestId('header-row').boundingBox();
    const menuButton = page.getByRole('button', { name: 'Open menu' });
    const primary = page.getByRole('navigation', { name: 'Primary navigation' });
    const compact = await menuButton.isVisible();
    const primaryVisible = await primary.isVisible();
    if (overflow || Math.round(row?.height ?? 0) !== 64 || compact === primaryVisible) {
      const offenders = await page.evaluate(() => [...document.querySelectorAll('body *')]
        .map((element) => ({ tag: element.tagName, className: element.getAttribute('class') ?? '', right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width }))
        .filter((box) => box.right > window.innerWidth + 1)
        .sort((a, b) => b.right - a.right)
        .slice(0, 3));
      throw new Error(`Header layout failed at ${entry.physicalWidth}px/${entry.zoom}: overflow=${overflow}, height=${row?.height}, menu=${compact}, tabs=${primaryVisible}, offenders=${JSON.stringify(offenders)}`);
    }
    if (effectiveWidth >= 768 && !(await page.getByText('Judging Platform', { exact: true }).first().isVisible())) {
      throw new Error(`Platform name hidden at ${entry.physicalWidth}px/${entry.zoom}`);
    }

    if (compact) {
      const brand = await page.getByTestId('header-brand').boundingBox();
      const account = await page.getByTestId('header-account').boundingBox();
      const button = await menuButton.boundingBox();
      if (!brand || !account || !button || brand.x + brand.width > account.x || account.x + account.width > button.x) {
        throw new Error(`Compact header overlap at ${entry.physicalWidth}px/${entry.zoom}`);
      }
      await menuButton.click();
      const responsive = page.getByRole('navigation', { name: 'Responsive navigation' });
      for (const item of expectedItems) await responsive.getByRole('link', { name: item, exact: true }).waitFor();
      if (await responsive.getByRole('link', { name: 'Rubric Management', exact: true }).getAttribute('aria-current') !== 'page') {
        throw new Error(`Active menu item missing at ${entry.physicalWidth}px/${entry.zoom}`);
      }
      await page.getByRole('button', { name: 'Close menu' }).click();
      if (await responsive.isVisible()) throw new Error(`Menu did not close at ${entry.physicalWidth}px/${entry.zoom}`);
    } else {
      const brand = await page.getByTestId('header-brand').boundingBox();
      const nav = await primary.boundingBox();
      const account = await page.getByTestId('header-account').boundingBox();
      if (!brand || !nav || !account || brand.x + brand.width > nav.x || nav.x + nav.width > account.x) {
        throw new Error(`Expanded header overlap at ${entry.physicalWidth}px/${entry.zoom}`);
      }
      for (const item of expectedItems) await primary.getByRole('link', { name: item, exact: true }).waitFor();
      if (await primary.getByRole('link', { name: 'Rubric Management', exact: true }).getAttribute('aria-current') !== 'page') {
        throw new Error(`Active tab missing at ${entry.physicalWidth}px/${entry.zoom}`);
      }
    }
    results.push({ ...entry, effectiveWidth, mode: compact ? 'menu' : 'tabs', overflow: false });
  }
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
