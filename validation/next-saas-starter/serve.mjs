// Runs the external app against a disposable, loopback-only SQL database.
// The application source and payment implementation remain unchanged.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
const source = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Pass the prepared external source directory.');
const fromSource = createRequire(resolve(source, 'package.json'));
const { PGlite } = fromSource('@electric-sql/pglite');
const { PGLiteSocketServer } = fromSource('@electric-sql/pglite-socket');
const { hash } = fromSource('bcryptjs');
const { SignJWT } = fromSource('jose');
const sql = await PGlite.create();
await sql.exec(await readFile(resolve(source, 'lib/db/migrations/0000_soft_the_anarchist.sql'), 'utf8'));
const password = await hash('Fixture-Password-Only', 10);
await sql.query("INSERT INTO users(id,name,email,password_hash,role) VALUES (1,'Fixture owner','owner@fixture.invalid',$1,'member'),(2,'Fixture member','member@fixture.invalid',$1,'owner')", [password]);
await sql.exec("INSERT INTO teams(id,name) VALUES (1,'Local validation team'); INSERT INTO team_members(id,user_id,team_id,role) VALUES (1,1,1,'owner'),(2,2,1,'member')");
const socket = new PGLiteSocketServer({ db: sql, port: 0, host: '127.0.0.1', maxConnections: 10 });
await socket.start();
const probe = createServer();
await new Promise(done => probe.listen(0, '127.0.0.1', done));
const port = probe.address().port;
await new Promise(done => probe.close(done));
const secret = 'pureobom-local-http-fixture-not-a-production-secret';
const child = spawn(process.execPath, [fromSource.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: source, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, POSTGRES_URL: `postgresql://postgres:postgres@${socket.getServerConn()}/postgres`, AUTH_SECRET: secret, STRIPE_SECRET_KEY: 'sk_test_pureobom_fixture_no_payment_requests', NEXT_TELEMETRY_DISABLED: '1' },
});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  if (child.exitCode === null && child.pid) {
    if (process.platform === 'win32') await new Promise(done => {
      const kill = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      kill.on('exit', done);
    });
    else child.kill('SIGTERM');
  }
  await socket.stop();
  await sql.close();
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
child.once('exit', () => void close());
try {
  const until = Date.now() + 120000;
  let result;
  while (Date.now() < until && child.exitCode === null) {
    try {
      const token = await new SignJWT({ user: { id: 2 }, expires: new Date(Date.now() + 60000).toISOString() }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1m').sign(new TextEncoder().encode(secret));
      const response = await fetch(`http://127.0.0.1:${port}/api/team`, { headers: { cookie: `session=${token}` }, signal: AbortSignal.timeout(30000) });
      if (response.ok) { result = { status: response.status, body: await response.json() }; break; }
    } catch { /* Allow the actual dev server to become ready. */ }
    await new Promise(done => setTimeout(done, 1000));
  }
  assert.equal(result?.status, 200, 'Actual Next HTTP route did not become ready');
  assert.equal(result.body.id, 1);
  assert.deepEqual(result.body.teamMembers.map(member => member.userId).sort(), [1, 2]);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), kind: 'actual-next-dev-http', url: `http://127.0.0.1:${port}`, teamStatus: result.status, teamId: result.body.id, members: result.body.teamMembers.map(member => ({ userId: member.userId, role: member.role })), note: 'Synthetic SQL data and JWT; real Next HTTP cookies, middleware, query and serialization. No payment call or production build.' }));
} finally { await close(); }
