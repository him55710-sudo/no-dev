// Pureobom's independent acceptance harness, not an upstream test suite.
// Real application actions, JWT verification, Drizzle and SQL; only Next's
// request cookie accessor is supplied by the harness. No payment calls.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { renderToStaticMarkup } from 'react-dom/server';
import { SWRConfig } from 'swr';

const request = vi.hoisted(() => ({ token: '' }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => name === 'session' && request.token ? { value: request.token } : undefined }),
}));

let sql: PGlite;
let socket: PGLiteSocketServer;
let actions: typeof import('@/app/(login)/actions');
let queries: typeof import('@/lib/db/queries');
let session: typeof import('@/lib/auth/session');
let client: typeof import('@/lib/db/drizzle')['client'];
let Page: typeof import('@/app/(dashboard)/dashboard/page')['default'];
let GET: typeof import('@/app/api/team/route')['GET'];

beforeAll(async () => {
  sql = await PGlite.create();
  await sql.exec(await readFile('lib/db/migrations/0000_soft_the_anarchist.sql', 'utf8'));
  socket = new PGLiteSocketServer({ db: sql, port: 0, host: '127.0.0.1', maxConnections: 10 });
  await socket.start();
  process.env.POSTGRES_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres`;
  process.env.AUTH_SECRET = 'pureobom-local-validation-not-a-production-secret';
  process.env.STRIPE_SECRET_KEY = 'sk_test_pureobom_fixture_no_payment_requests';
  actions = await import('@/app/(login)/actions');
  queries = await import('@/lib/db/queries');
  session = await import('@/lib/auth/session');
  ({ client } = await import('@/lib/db/drizzle'));
  ({ default: Page } = await import('@/app/(dashboard)/dashboard/page'));
  ({ GET } = await import('@/app/api/team/route'));
});

afterAll(async () => {
  await client?.end({ timeout: 3 });
  await socket?.stop();
  await sql?.close();
});

async function login(id: number) {
  request.token = await session.signToken({ user: { id }, expires: new Date(Date.now() + 60000).toISOString() });
}

beforeEach(async () => {
  await sql.exec(`
    TRUNCATE activity_logs, invitations, team_members, teams, users RESTART IDENTITY CASCADE;
    INSERT INTO users(id,name,email,password_hash,role) VALUES
      (1,'Team owner','owner@fixture.invalid','unused','member'),
      (2,'Read-only member','member@fixture.invalid','unused','owner'),
      (3,'Third member','third@fixture.invalid','unused','member'),
      (4,'Other team owner','other@fixture.invalid','unused','owner');
    INSERT INTO teams(id,name) VALUES (1,'First team'), (2,'Other team');
    INSERT INTO team_members(id,user_id,team_id,role) VALUES
      (1,1,1,'owner'), (2,2,1,'member'), (3,3,1,'member'), (4,4,2,'owner'), (5,2,2,'owner');
  `);
  await login(2);
});

async function snapshot() {
  return {
    members: (await sql.query('SELECT * FROM team_members ORDER BY id')).rows,
    invitations: (await sql.query('SELECT * FROM invitations ORDER BY id')).rows,
    activity: (await sql.query('SELECT * FROM activity_logs ORDER BY id')).rows,
  };
}
function invite() {
  const form = new FormData();
  form.set('email', 'new@fixture.invalid');
  form.set('role', 'member');
  return actions.inviteTeamMember({}, form);
}
function remove(memberId: number) {
  const form = new FormData();
  form.set('memberId', String(memberId));
  return actions.removeTeamMember({}, form);
}
async function markup(id: number) {
  await login(id);
  const user = await queries.getUser();
  const team = await queries.getTeamForUser();
  return renderToStaticMarkup(
    <SWRConfig value={{ provider: () => new Map(), fallback: { '/api/user': user, '/api/team': team }, revalidateOnMount: false }}>
      <Page />
    </SWRConfig>,
  );
}

describe('external Next.js team permissions — locked acceptance', () => {
  it('member reads the real team endpoint and its SQL-backed member list', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const team = await response.json();
    expect(team.id).toBe(1);
    expect(team.teamMembers.map((member: { userId: number }) => member.userId).sort()).toEqual([1, 2, 3]);
  });
  it('member direct server-action invitation is denied without database or audit mutation', async () => {
    const before = await snapshot();
    expect(await invite()).toHaveProperty('error');
    expect(await snapshot()).toEqual(before);
  });
  it('member direct removal is denied without database or audit mutation', async () => {
    const before = await snapshot();
    expect(await remove(3)).toHaveProperty('error');
    expect(await snapshot()).toEqual(before);
  });
  it('team owner can invite even when the account-wide role is member', async () => {
    await login(1);
    expect(await invite()).toHaveProperty('success');
    expect((await sql.query('SELECT team_id,invited_by FROM invitations')).rows).toEqual([{ team_id: 1, invited_by: 1 }]);
  });
  it('team owner can remove a member using real browser FormData', async () => {
    await login(1);
    expect(await remove(3)).toHaveProperty('success');
    expect((await sql.query('SELECT id FROM team_members WHERE id=3')).rows).toHaveLength(0);
    expect((await sql.query('SELECT action FROM activity_logs')).rows).toEqual([{ action: 'REMOVE_TEAM_MEMBER' }]);
  });
  it('owner of another team cannot remove a member from this team or record a successful mutation', async () => {
    await login(4);
    const before = await snapshot();
    expect(await remove(3)).toHaveProperty('error');
    expect(await snapshot()).toEqual(before);
  });
  it('unauthenticated direct action cannot invite', async () => {
    request.token = '';
    const before = await snapshot();
    await expect(invite()).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });
  it('member UI disables invitation and removal despite owning another team and the global owner label', async () => {
    const html = await markup(2);
    const email = html.match(/<input\b[^>]*\bname="email"[^>]*>/)?.[0];
    expect(email).toBeDefined();
    expect(email).toMatch(/\bdisabled(?:=|\s|>)/);
    const removeButtons = [...html.matchAll(/<button\b([^>]*)>Remove<\/button>/g)];
    expect(removeButtons.every((button) => /\bdisabled(?:=|\s|$)/.test(button[1]))).toBe(true);
    expect(html).toMatch(/team owner|read.only|읽기 전용/i);
  });
  it('team owner UI enables invitation despite the global member label', async () => {
    const html = await markup(1);
    const email = html.match(/<input\b[^>]*\bname="email"[^>]*>/)?.[0];
    expect(email).toBeDefined();
    expect(email).not.toMatch(/\bdisabled(?:=|\s|>)/);
    expect([...html.matchAll(/<button\b([^>]*)>Remove<\/button>/g)].some((button) => !/\bdisabled(?:=|\s|$)/.test(button[1]))).toBe(true);
  });
});
