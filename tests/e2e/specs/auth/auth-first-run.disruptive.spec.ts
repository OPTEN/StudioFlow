import { AdminApi } from '../../support/api';
import { dockerCtl } from '../../support/docker-ctl';
import { send } from '../../support/http';
import { waitUntil } from '../../support/shell';
import { ensureHealthy, readSetupCode, resetAdminAccount, setupRequired, waitForSetupCode } from '../../support/stack';
import { t } from '../../support/tags';
import { expect, test } from '../../support/ui/fixtures';
import { RegiePage } from '../../support/ui/regie';
import { uniqueIp } from '../../support/fixtures';

/**
 * AUTH - the first-run setup of the Regie account (issue #4; E2E-AUTH-30 ... 33). The tests delete the account of the
 * harness with `reset-admin`, create it again in the browser, restart the API and change the password. They run one
 * after the other and always put the harness account (stackConfig().admin) back.
 */

test.describe.configure({ mode: 'serial' });
// The texts below are the English ones; the default project still runs in de-CH until the suite is converted (#20).
test.use({ locale: 'en-US' });

const CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const NEW_PASSWORD = 'e2e-Other-Passw0rd-2026';

test.afterAll(async ({ config }) => {
  test.setTimeout(300_000);
  // A failed test may have left the stack without an account or with another password: start from the harness state.
  const login = await send({ method: 'POST', url: `${config.apiDirect}/api/auth/login`, headers: { 'X-Forwarded-For': uniqueIp() }, json: config.admin });
  if (login.status !== 200) {
    await resetAdminAccount();
    await waitUntil('the first-run setup is open again', async () => (await setupRequired()) === true, { timeoutMs: 60_000, intervalMs: 1000 });
  }
  await ensureHealthy();
});

test.describe('AUTH first-run setup', () => {
  test('E2E-AUTH-30 [stack] reset-admin ends the sessions and reopens the first-run setup with a new code', t.disruptive('@p0'), async ({ config }) => {
    test.setTimeout(240_000);
    const session = await AdminApi.login(config.baseURL, config.admin);
    expect((await session.getSession()).status, 'signed in before the reset').toBe(200);
    const codeBefore = await readSetupCode();

    await resetAdminAccount();
    await waitUntil('the first-run setup is open', async () => (await setupRequired()) === true, { timeoutMs: 60_000, intervalMs: 1000 });

    expect((await session.getSession()).status, 'the old session is refused').toBe(401);
    const login = await send({ method: 'POST', url: `${config.apiDirect}/api/auth/login`, headers: { 'X-Forwarded-For': uniqueIp() }, json: config.admin });
    expect(login.status, 'there is no account to sign in to').toBe(401);
    const code = await waitForSetupCode();
    expect(code).toMatch(CODE_PATTERN);
    expect(code, 'a new code').not.toBe(codeBefore);
  });

  test('E2E-AUTH-31 [regie ui] without an account the Regie leads to the first-run setup; the code, a username and a password create the account and sign it in', t.disruptive('@p0'), async ({ page, config }) => {
    test.setTimeout(240_000);
    await page.goto('/');
    await expect(page).toHaveURL(/\/setup$/);
    await page.goto('/login');
    await expect(page, 'the login leads to the setup while no account exists').toHaveURL(/\/setup$/);
    await expect(page.getByRole('heading', { name: 'First-run setup' })).toBeVisible();

    const code = await waitForSetupCode();
    await page.getByLabel('Setup code').fill('AAAA-AAAA');
    await page.getByLabel('Username', { exact: true }).fill(config.admin.username);
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByLabel('Repeat password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('The password needs at least 12 characters.'), 'the browser checks the rules without a request').toBeVisible();

    await page.getByLabel('Password', { exact: true }).fill(config.admin.password);
    await page.getByLabel('Repeat password').fill(config.admin.password);
    const wrong = page.waitForResponse((response) => response.url().endsWith('/api/auth/setup') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create account' }).click();
    expect((await wrong).status(), 'a wrong code is refused').toBe(403);
    await expect(page.getByText('The setup code is not correct.')).toBeVisible();

    await page.getByLabel('Setup code').fill(code.toLowerCase());
    const right = page.waitForResponse((response) => response.url().endsWith('/api/auth/setup') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create account' }).click();
    expect((await right).status(), 'the right code creates the account').toBe(200);
    await page.waitForURL((url) => url.pathname === '/');
    await new RegiePage(page, config).waitReady();
    expect(await setupRequired(), 'the first-run setup is closed for good').toBe(false);
    expect(await readSetupCode(), 'the code is no longer valid').toBeUndefined();
    await AdminApi.login(config.baseURL, config.admin);
  });

  test('E2E-AUTH-32 [stack] after an API restart the account remains and the first-run setup stays closed', t.disruptive('@p0'), async ({ page, config }) => {
    test.setTimeout(240_000);
    await dockerCtl.restart('api');
    await ensureHealthy();

    expect(await setupRequired(), 'the account survived the restart').toBe(false);
    expect(await readSetupCode(), 'the API logged no setup code after the restart').toBeUndefined();
    const attempt = await send({ method: 'POST', url: `${config.apiDirect}/api/auth/setup`, headers: { 'X-Forwarded-For': uniqueIp() }, json: { setupCode: 'AAAA-AAAA', username: 'intruder', password: 'An-Intruder-Passw0rd-1' } });
    expect(attempt.status, 'a further setup is a conflict').toBe(409);
    expect(attempt.json().code).toBe('setup_closed');
    await page.goto('/setup');
    await expect(page, 'the setup page leads to the login').toHaveURL(/\/login$/);
    expect((await send({ method: 'POST', url: `${config.apiDirect}/api/auth/login`, headers: { 'X-Forwarded-For': uniqueIp() }, json: config.admin })).status, 'the account still signs in').toBe(200);
  });

  test('E2E-AUTH-33 [regie ui] the password change in the production menu ends the other sessions and keeps this one', t.disruptive('@p1'), async ({ page, config }) => {
    test.setTimeout(240_000);
    const other = await AdminApi.login(config.baseURL, config.admin);
    const regie = new RegiePage(page, config);
    await regie.loginViaApi();
    await page.goto('/');
    await regie.waitReady();

    await page.getByRole('button', { name: /^Production .*, menu$/ }).click();
    await page.getByRole('button', { name: 'Change password' }).click();
    await page.getByLabel('Current password').fill(config.admin.password);
    await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel('Repeat new password').fill(NEW_PASSWORD);
    const changed = page.waitForResponse((response) => response.url().endsWith('/api/auth/password') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Change password' }).click();
    expect((await changed).status()).toBe(204);
    await expect(page.getByText('Password changed.')).toBeVisible();

    expect((await other.getSession()).status, 'the other session ended').toBe(401);
    const old = await send({ method: 'POST', url: `${config.apiDirect}/api/auth/login`, headers: { 'X-Forwarded-For': uniqueIp() }, json: config.admin });
    expect(old.status, 'the old password no longer works').toBe(401);
    const renewed = await AdminApi.login(config.baseURL, { username: config.admin.username, password: NEW_PASSWORD }, undefined);
    expect((await renewed.getSession()).status).toBe(200);
    expect((await page.request.get(`${config.baseURL}/api/auth/me`)).status(), 'this browser session continues').toBe(200);

    // Back to the harness password.
    const back = await renewed.call('POST', '/api/auth/password', { json: { currentPassword: NEW_PASSWORD, newPassword: config.admin.password } });
    expect(back.status).toBe(204);
  });
});
