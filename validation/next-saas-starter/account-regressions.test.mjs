// Independent regression checks for the pinned external app. Application code,
// bcrypt, JWT, SQL and Stripe webhook signatures are real. Next request cookies
// and redirects are supplied here; Stripe remote methods return explicit fixtures.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import https from 'node:https';
import { NextRequest } from 'next/server';
import { createFixtureDatabase } from './database.mjs';

const request = vi.hoisted(() => ({ token: '', options: undefined }));
vi.mock('next/headers', () => ({ cookies: async () => ({
  get: name => name === 'session' && request.token ? { value: request.token } : undefined,
  set: (name, value, options) => { if (name === 'session') { request.token = value; request.options = options; } },
  delete: name => { if (name === 'session') request.token = ''; },
}) }));
vi.mock('next/navigation', () => ({ redirect: path => { throw Error(`FIXTURE_REDIRECT:${path}`); } }));

const password = 'Fixture-Password-Only';
const newPassword = 'Fixture-Changed-Password';
const webhookSecret = 'whsec_local_fixture_only';
let sql, actions, session, queries, payments, webhook, checkout, client, passwordHash;
let denyHttps;
const mocks = [];
const remote = (object, method, value) => {
  const mock = vi.spyOn(object, method).mockResolvedValue(value);
  mocks.push(mock);
  return mock;
};
const form = fields => { const data = new FormData(); for (const [key, value] of Object.entries(fields)) data.set(key, value); return data; };
const rows = async (query, params = []) => (await sql.query(query, params)).rows;
const snapshot = async () => ({
  users: await rows('SELECT * FROM users ORDER BY id'),
  teams: await rows('SELECT * FROM teams ORDER BY id'),
  memberships: await rows('SELECT * FROM team_members ORDER BY id'),
  activity: await rows('SELECT * FROM activity_logs ORDER BY id'),
});
const authenticate = async (id = 2) => { await session.setSession({ id }); };

beforeAll(async () => {
  sql = await createFixtureDatabase(process.cwd(), true);
  await sql.exec(await readFile('lib/db/migrations/0000_soft_the_anarchist.sql', 'utf8'));
  process.env.POSTGRES_URL = sql.connectionString;
  process.env.AUTH_SECRET = 'local-account-regression-signing-key';
  process.env.STRIPE_SECRET_KEY = 'sk_test_local_no_payment_requests';
  process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
  process.env.BASE_URL = 'http://127.0.0.1:43210';
  denyHttps = vi.spyOn(https, 'request').mockImplementation(() => { throw Error('External HTTPS is forbidden in this regression fixture'); });
  actions = await import('@/app/(login)/actions');
  session = await import('@/lib/auth/session');
  queries = await import('@/lib/db/queries');
  payments = await import('@/lib/payments/stripe');
  webhook = await import('@/app/api/stripe/webhook/route');
  checkout = await import('@/app/api/stripe/checkout/route');
  ({ client } = await import('@/lib/db/drizzle'));
  passwordHash = await session.hashPassword(password);
}, 60000);

beforeEach(async () => {
  while (mocks.length) mocks.pop().mockRestore();
  denyHttps.mockClear();
  request.token = '';
  request.options = undefined;
  await sql.exec('TRUNCATE activity_logs, invitations, team_members, teams, users RESTART IDENTITY CASCADE');
  await sql.query("INSERT INTO users(name,email,password_hash,role) VALUES ('Owner','owner@fixture.invalid',$1,'member'),('Member','member@fixture.invalid',$1,'owner')", [passwordHash]);
  await sql.exec("INSERT INTO teams(name) VALUES ('Current team'),('Other team'); INSERT INTO team_members(user_id,team_id,role) VALUES (1,1,'owner'),(2,1,'member'),(2,2,'owner')");
});
afterAll(async () => {
  while (mocks.length) mocks.pop().mockRestore();
  denyHttps?.mockRestore();
  await client?.end({ timeout: 3 });
  await sql?.close();
});

describe('existing authentication and account behavior', () => {
  it('signs in using real bcrypt and issues a verifiable, HTTP-only session', async () => {
    await expect(actions.signIn({}, form({ email: 'member@fixture.invalid', password }))).rejects.toThrow('FIXTURE_REDIRECT:/dashboard');
    expect((await session.verifyToken(request.token)).user.id).toBe(2);
    expect(request.options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax' });
    expect(await rows('SELECT team_id,user_id,action FROM activity_logs')).toEqual([{ team_id: 1, user_id: 2, action: 'SIGN_IN' }]);
  });
  it('rejects a wrong password without writes or a session', async () => {
    const before = await snapshot();
    expect(await actions.signIn({}, form({ email: 'member@fixture.invalid', password: 'Wrong-Fixture-Password' }))).toHaveProperty('error');
    expect(request.token).toBe('');
    expect(await snapshot()).toEqual(before);
  });
  it('creates a new account, team, owner membership and session', async () => {
    await expect(actions.signUp({}, form({ email: 'new@fixture.invalid', password }))).rejects.toThrow('FIXTURE_REDIRECT:/dashboard');
    const [user] = await rows("SELECT * FROM users WHERE email='new@fixture.invalid'");
    expect(await session.comparePasswords(password, user.password_hash)).toBe(true);
    expect(await rows('SELECT team_id,role FROM team_members WHERE user_id=$1', [user.id])).toEqual([{ team_id: 3, role: 'owner' }]);
    expect((await session.verifyToken(request.token)).user.id).toBe(user.id);
  });
  it('accepts an invitation into its existing team as a member', async () => {
    await sql.exec("INSERT INTO invitations(team_id,email,role,invited_by,status) VALUES (1,'invited@fixture.invalid','member',1,'pending')");
    await expect(actions.signUp({}, form({ email: 'invited@fixture.invalid', password, inviteId: '1' }))).rejects.toThrow('FIXTURE_REDIRECT:/dashboard');
    const id = (await session.verifyToken(request.token)).user.id;
    expect(await rows('SELECT team_id,role FROM team_members WHERE user_id=$1', [id])).toEqual([{ team_id: 1, role: 'member' }]);
    expect(await rows('SELECT status FROM invitations WHERE id=1')).toEqual([{ status: 'accepted' }]);
  });
  it('lets a member update only their own account and logs the current team', async () => {
    await authenticate();
    const ownerBefore = await rows('SELECT * FROM users WHERE id=1');
    expect(await actions.updateAccount({}, form({ name: 'Renamed member', email: 'renamed@fixture.invalid' }))).toHaveProperty('success');
    expect(await rows('SELECT name,email FROM users WHERE id=2')).toEqual([{ name: 'Renamed member', email: 'renamed@fixture.invalid' }]);
    expect(await rows('SELECT * FROM users WHERE id=1')).toEqual(ownerBefore);
    expect(await rows('SELECT team_id,user_id,action FROM activity_logs')).toEqual([{ team_id: 1, user_id: 2, action: 'UPDATE_ACCOUNT' }]);
  });
  it('rejects unauthenticated account changes without writes', async () => {
    const before = await snapshot();
    await expect(actions.updateAccount({}, form({ name: 'No session', email: 'none@fixture.invalid' }))).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });
  it('changes a member password and keeps the old password from authenticating', async () => {
    await authenticate();
    expect(await actions.updatePassword({}, form({ currentPassword: password, newPassword, confirmPassword: newPassword }))).toHaveProperty('success');
    const [user] = await rows('SELECT password_hash FROM users WHERE id=2');
    expect(await session.comparePasswords(password, user.password_hash)).toBe(false);
    expect(await session.comparePasswords(newPassword, user.password_hash)).toBe(true);
    expect(await rows('SELECT team_id,action FROM activity_logs')).toEqual([{ team_id: 1, action: 'UPDATE_PASSWORD' }]);
  });
  it.each([
    { currentPassword: 'Wrong-Fixture-Password', newPassword, confirmPassword: newPassword },
    { currentPassword: password, newPassword: password, confirmPassword: password },
    { currentPassword: password, newPassword, confirmPassword: 'Different-Confirmation' },
  ])('rejects invalid password changes without writes (%j)', async fields => {
    await authenticate();
    const before = await snapshot();
    expect(await actions.updatePassword({}, form(fields))).toHaveProperty('error');
    expect(await snapshot()).toEqual(before);
  });
  it('signs out a member and records the current team', async () => {
    await authenticate();
    await actions.signOut();
    expect(request.token).toBe('');
    expect(await rows('SELECT team_id,user_id,action FROM activity_logs')).toEqual([{ team_id: 1, user_id: 2, action: 'SIGN_OUT' }]);
  });
  it('rejects account deletion with a wrong password without writes', async () => {
    await authenticate();
    const before = await snapshot();
    expect(await actions.deleteAccount({}, form({ password: 'Wrong-Fixture-Password' }))).toHaveProperty('error');
    expect(await snapshot()).toEqual(before);
  });
  it('soft-deletes the authenticated account and clears its session', async () => {
    await authenticate();
    await expect(actions.deleteAccount({}, form({ password }))).rejects.toThrow('FIXTURE_REDIRECT:/sign-in');
    expect(request.token).toBe('');
    const [user] = await rows('SELECT email,deleted_at FROM users WHERE id=2');
    expect(user.email).toBe('member@fixture.invalid-2-deleted');
    expect(user.deleted_at).not.toBeNull();
    expect(await rows('SELECT id FROM team_members WHERE user_id=2 AND team_id=1')).toEqual([]);
    await authenticate();
    expect(await queries.getUser()).toBeNull();
  });
});

describe('existing payment integration with remote responses supplied by fixtures', () => {
  it('constructs checkout for the current account and redirects to the supplied session', async () => {
    await authenticate();
    const create = remote(payments.stripe.checkout.sessions, 'create', { url: 'https://checkout.stripe.com/c/pay/fixture_only' });
    const team = await queries.getTeamForUser();
    await expect(payments.createCheckoutSession({ team, priceId: 'price_fixture' })).rejects.toThrow('FIXTURE_REDIRECT:https://checkout.stripe.com/c/pay/fixture_only');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ mode: 'subscription', client_reference_id: '2', line_items: [{ price: 'price_fixture', quantity: 1 }], subscription_data: { trial_period_days: 14 } }));
    expect(denyHttps).not.toHaveBeenCalled();
  });
  it('sends unauthenticated checkout to sign-up without a Stripe request', async () => {
    const create = remote(payments.stripe.checkout.sessions, 'create', {});
    await expect(payments.createCheckoutSession({ team: null, priceId: 'price_fixture' })).rejects.toThrow('FIXTURE_REDIRECT:/sign-up?redirect=checkout&priceId=price_fixture');
    expect(create).not.toHaveBeenCalled();
    expect(denyHttps).not.toHaveBeenCalled();
  });
  it('records subscription details returned by checkout and issues the account session', async () => {
    remote(payments.stripe.checkout.sessions, 'retrieve', { customer: { id: 'cus_fixture' }, subscription: 'sub_fixture', client_reference_id: '2' });
    remote(payments.stripe.subscriptions, 'retrieve', { id: 'sub_fixture', status: 'active', items: { data: [{ price: { product: { id: 'prod_fixture', name: 'Fixture plan' } } }] } });
    const checkoutRequest = new NextRequest('http://127.0.0.1:43210/api/stripe/checkout?session_id=cs_fixture');
    const response = await checkout.GET(checkoutRequest);
    // NextRequest normalizes a loopback IP to localhost in this Next version.
    // Require the original request's origin and the dashboard destination.
    expect(response.headers.get('location')).toBe(new URL('/dashboard', checkoutRequest.url).href);
    expect(await rows('SELECT stripe_customer_id,stripe_subscription_id,stripe_product_id,plan_name,subscription_status FROM teams WHERE id=1')).toEqual([{ stripe_customer_id: 'cus_fixture', stripe_subscription_id: 'sub_fixture', stripe_product_id: 'prod_fixture', plan_name: 'Fixture plan', subscription_status: 'active' }]);
    expect((await session.verifyToken(request.token)).user.id).toBe(2);
    expect(denyHttps).not.toHaveBeenCalled();
  });
  it('rejects an invalid webhook signature without modifying subscription data', async () => {
    const before = await snapshot();
    const response = await webhook.POST(new NextRequest('http://127.0.0.1:43210/api/stripe/webhook', { method: 'POST', body: '{}', headers: { 'stripe-signature': 'invalid-fixture-signature' } }));
    expect(response.status).toBe(400);
    expect(await snapshot()).toEqual(before);
    expect(denyHttps).not.toHaveBeenCalled();
  });
  it('verifies a signed cancellation webhook and clears only the matching team subscription', async () => {
    await sql.exec("UPDATE teams SET stripe_customer_id='cus_fixture',stripe_subscription_id='sub_fixture',stripe_product_id='prod_fixture',plan_name='Fixture plan',subscription_status='active' WHERE id=1");
    const otherBefore = await rows('SELECT * FROM teams WHERE id=2');
    const payload = JSON.stringify({ id: 'evt_fixture', type: 'customer.subscription.deleted', data: { object: { id: 'sub_fixture', customer: 'cus_fixture', status: 'canceled' } } });
    const signature = payments.stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    const response = await webhook.POST(new NextRequest('http://127.0.0.1:43210/api/stripe/webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': signature } }));
    expect(response.status).toBe(200);
    expect(await rows('SELECT stripe_subscription_id,stripe_product_id,plan_name,subscription_status FROM teams WHERE id=1')).toEqual([{ stripe_subscription_id: null, stripe_product_id: null, plan_name: null, subscription_status: 'canceled' }]);
    expect(await rows('SELECT * FROM teams WHERE id=2')).toEqual(otherBefore);
    expect(denyHttps).not.toHaveBeenCalled();
  });
});
