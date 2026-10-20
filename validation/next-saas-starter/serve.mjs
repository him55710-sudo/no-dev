// Runs the external app against a disposable, loopback-only SQL database.
// The application source and payment implementation remain unchanged.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { createFixtureDatabase } from './database.mjs';
const source = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Pass the prepared external source directory.');
const interactive = process.argv.includes('--interactive');
const production = process.argv.includes('--production');
const buildId = production ? (await readFile(resolve(source, '.next/BUILD_ID'), 'utf8')).trim() : undefined;
const snapshots = [];
let stopWaiting;
const fromSource = createRequire(resolve(source, 'package.json'));
const { hash } = fromSource('bcryptjs');
const { SignJWT } = fromSource('jose');
const sql = await createFixtureDatabase(source, interactive);
try {
  await sql.exec(await readFile(resolve(source, 'lib/db/migrations/0000_soft_the_anarchist.sql'), 'utf8'));
  const password = await hash('Fixture-Password-Only', 10);
  await sql.query("INSERT INTO users(id,name,email,password_hash,role) VALUES (1,'Fixture owner','owner@fixture.invalid',$1,'member'),(2,'Fixture member','member@fixture.invalid',$1,'owner')", [password]);
  await sql.exec("INSERT INTO teams(id,name) VALUES (1,'Local validation team'); INSERT INTO team_members(id,user_id,team_id,role) VALUES (1,1,1,'owner'),(2,2,1,'member')");
} catch (error) { await sql.close(); throw error; }
const probe = createServer();
await new Promise(done => probe.listen(0, '127.0.0.1', done));
const port = probe.address().port;
await new Promise(done => probe.close(done));
const secret = 'pureobom-local-http-fixture-not-a-production-secret';
const child = spawn(process.execPath, [fromSource.resolve('next/dist/bin/next'), production ? 'start' : 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: source, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, POSTGRES_URL: sql.connectionString, AUTH_SECRET: secret, STRIPE_SECRET_KEY: 'sk_test_pureobom_fixture_no_payment_requests', NEXT_TELEMETRY_DISABLED: '1' },
});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  stopWaiting?.();
  if (child.exitCode === null && child.pid) {
    if (process.platform === 'win32') await new Promise(done => {
      const kill = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      kill.on('exit', done);
    });
    else child.kill('SIGTERM');
  }
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
    } catch { /* Allow the actual Next server to become ready. */ }
    await new Promise(done => setTimeout(done, 1000));
  }
  assert.equal(result?.status, 200, 'Actual Next HTTP route did not become ready');
  assert.equal(result.body.id, 1);
  assert.deepEqual(result.body.teamMembers.map(member => member.userId).sort(), [1, 2]);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), kind: production ? 'actual-next-production-http' : 'actual-next-dev-http', buildId, url: `http://127.0.0.1:${port}`, teamStatus: result.status, teamId: result.body.id, members: result.body.teamMembers.map(member => ({ userId: member.userId, role: member.role })), note: 'Synthetic SQL data and JWT; real Next HTTP cookies, middleware, query and serialization. Build evidence is separate; no payment call.' }));
  if (interactive) {
    const snapshot = async () => {
      const value = {
        at: new Date().toISOString(),
        members: (await sql.query('SELECT id,user_id,team_id,role FROM team_members ORDER BY id')).rows,
        invitations: (await sql.query('SELECT team_id,email,role,invited_by,status FROM invitations ORDER BY id')).rows,
        activity: (await sql.query('SELECT team_id,user_id,action FROM activity_logs ORDER BY id')).rows,
      };
      snapshots.push(value);
      console.log(JSON.stringify({ databaseSnapshot: value }));
    };
    await snapshot();
    console.log(JSON.stringify({
      browser: `http://127.0.0.1:${port}/sign-in`,
      fixtureAccounts: ['member@fixture.invalid', 'owner@fixture.invalid'],
      fixturePassword: 'Fixture-Password-Only',
      database: sql.description,
      instruction: 'Use the actual app UI. Send snapshot to record SQL state, or stop to save the report and close the local server. No real accounts or payments.',
    }));
    const terminal = createInterface({ input: process.stdin });
    let timer;
    try {
      await new Promise(done => {
        stopWaiting = done;
        timer = setTimeout(done, 60 * 60 * 1000);
        if (closing) done();
        terminal.on('line', line => {
          if (line.trim() === 'stop') done();
          else if (line.trim() === 'snapshot' && !closing)
            void snapshot().catch(error => console.error(String(error)));
        });
      });
      if (!closing) await snapshot();
      const reportPath = resolve(source, '..', 'next-browser-report.json');
      await writeFile(reportPath, JSON.stringify({
        checkedAt: new Date().toISOString(),
        source,
        kind: production ? 'actual-next-production-browser-fixture' : 'actual-next-dev-browser-fixture',
        buildId,
        database: sql.description,
        teamProbe: { status: result.status, teamId: result.body.id },
        snapshots,
        scope: 'SQL snapshots and HTTP startup probe only. Browser UI observations and build provenance must be recorded separately. Synthetic accounts/database; payments and production credentials are not verified.',
      }, null, 2) + '\n');
      console.log(`BROWSER FIXTURE REPORT ${reportPath}`);
    } finally {
      clearTimeout(timer);
      terminal.close();
      stopWaiting = undefined;
    }
  }
} finally { await close(); }
