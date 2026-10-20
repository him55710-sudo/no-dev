// Disposable database for external-app validation. Never connects to user data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:net';

export async function createFixtureDatabase(source, nativeOnly = false) {
  const fromSource = createRequire(resolve(source, 'package.json'));
  const bin = process.env.PUREOBOM_TEST_POSTGRES_BIN;
  if (!bin) {
    assert.ok(!nativeOnly, 'Interactive browser validation requires PUREOBOM_TEST_POSTGRES_BIN; PGlite socket multiplexing is not reliable for this concurrent Next workload.');
    const { PGlite } = fromSource('@electric-sql/pglite');
    const { PGLiteSocketServer } = fromSource('@electric-sql/pglite-socket');
    const sql = await PGlite.create();
    const socket = new PGLiteSocketServer({ db: sql, port: 0, host: '127.0.0.1', maxConnections: 10 });
    try { await socket.start(); } catch (error) { await sql.close(); throw error; }
    return {
      connectionString: `postgresql://postgres:postgres@${socket.getServerConn()}/postgres`,
      description: { kind: 'PGlite socket', concurrencyVerified: false },
      exec: text => sql.exec(text),
      query: (text, params) => sql.query(text, params),
      close: async () => { await socket.stop(); await sql.close(); },
    };
  }

  const directory = await mkdtemp(resolve(tmpdir(), 'pureobom-pg-data-'));
  const data = resolve(directory, 'data');
  const passwordFile = resolve(directory, 'password.txt');
  const password = randomBytes(24).toString('hex');
  await writeFile(passwordFile, password + '\n', { mode: 0o600 });
  const exec = promisify(execFile);
  const executable = name => resolve(bin, name + (process.platform === 'win32' ? '.exe' : ''));
  const run = (name, args) => exec(executable(name), args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  // A background Windows server can inherit pg_ctl's pipe handles. Waiting for
  // execFile's close event would then keep setup pending after pg_ctl exits.
  const control = args => new Promise((done, reject) => {
    const child = spawn(executable('pg_ctl'), args, { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done() : reject(Error(`pg_ctl exited ${code}; inspect ${directory}`)));
  });
  const version = (await run('postgres', ['--version'])).stdout.trim();
  const probe = createServer();
  await new Promise(done => probe.listen(0, '127.0.0.1', done));
  const port = probe.address().port;
  await new Promise(done => probe.close(done));
  const init = await run('initdb', ['-D', data, '-U', 'fixture', '--pwfile=' + passwordFile, '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--encoding=UTF8', '--locale=C']);
  await writeFile(resolve(directory, 'init.log'), init.stdout + init.stderr);
  try {
    await control(['-D', data, '-l', resolve(directory, 'server.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
  } catch (error) {
    await control(['-D', data, '-m', 'fast', '-w', 'stop']).catch(() => {});
    throw error;
  }
  const connectionString = `postgresql://fixture:${password}@127.0.0.1:${port}/postgres`;
  const client = fromSource('postgres')(connectionString, { max: 4, onnotice: () => {} });
  return {
    connectionString,
    description: { kind: 'PostgreSQL', version, directory, port },
    exec: text => client.unsafe(text).simple(),
    query: async (text, params = []) => ({ rows: [...await client.unsafe(text, params)] }),
    close: async () => {
      try { await client.end({ timeout: 3 }); }
      finally { await control(['-D', data, '-m', 'fast', '-w', 'stop']); }
    },
  };
}
