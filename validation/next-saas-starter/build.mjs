// A real Next production build with explicit local pricing response fixtures.
// It does not validate Stripe connectivity, payments, or production credentials.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { readFile, writeFile, lstat } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createFixtureDatabase } from "./database.mjs";

assert.ok(
  process.argv[2] && process.argv[3],
  "Pass disposable build clone and report label.",
);
const source = resolve(process.argv[2]),
  label = process.argv[3];
assert.match(
  relative(tmpdir(), source),
  /^pureobom-production-[\w-]+[/\\]project$/,
);
assert.match(label, /^[a-z0-9-]+$/);
assert.ok((await lstat(resolve(source, ".git"))).isDirectory());
const fromSource = createRequire(resolve(source, "package.json"));
const manifest = JSON.parse(
  await readFile(resolve(source, "package.json"), "utf8"),
);
assert.equal(manifest.scripts.build, "next build");
const exec = promisify(execFile);
const git = async (...args) =>
  (
    await exec("git", ["-C", source, ...args], {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout;
const tracked = (await git("ls-files", "-z")).split("\0").filter(Boolean);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashes = async () =>
  Object.fromEntries(
    await Promise.all(
      tracked.map(async (path) => [
        path,
        hash(await readFile(resolve(source, path))),
      ]),
    ),
  );
const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  source,
  label,
  head: (await git("rev-parse", "HEAD")).trim(),
  before: await hashes(),
  beforeStatus: await git("status", "--porcelain"),
  requests: [],
  scope:
    "Unmodified app code and actual Next production compiler/prerenderer. Real disposable PostgreSQL. Only Stripe GET prices/products responses use a local fixture; no live payment integration or production deployment. Google font downloads may use the normal Next build path.",
};
const products = [
  {
    id: "prod_fixture_base",
    name: "Base",
    active: true,
    object: "product",
    default_price: "price_fixture_base",
  },
  {
    id: "prod_fixture_plus",
    name: "Plus",
    active: true,
    object: "product",
    default_price: "price_fixture_plus",
  },
];
const prices = products.map((product, index) => ({
  id: product.default_price,
  object: "price",
  active: true,
  product,
  currency: "usd",
  unit_amount: index ? 1200 : 800,
  recurring: { interval: "month", trial_period_days: 7 },
  type: "recurring",
}));
let phase = "sdk-probe";
const pricing = createServer((req, res) => {
  const path = new URL(req.url, "http://127.0.0.1").pathname;
  report.requests.push({ phase, method: req.method, path });
  const data =
    path === "/v1/prices" ? prices : path === "/v1/products" ? products : null;
  if (req.method !== "GET" || !data) {
    res.writeHead(400);
    res.end("Unsupported fixture request");
    return;
  }
  res.writeHead(200, {
    "content-type": "application/json",
    "request-id": "req_local_build_fixture",
  });
  res.end(JSON.stringify({ object: "list", data, has_more: false, url: path }));
});
let sql;
let log = "";
try {
  sql = await createFixtureDatabase(source, true);
  await sql.exec(
    await readFile(
      resolve(source, "lib/db/migrations/0000_soft_the_anarchist.sql"),
      "utf8",
    ),
  );
  report.database = sql.description;
  await new Promise((done) => pricing.listen(0, "127.0.0.1", done));
  const env = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    POSTGRES_URL: sql.connectionString,
    AUTH_SECRET: "pureobom-build-fixture-no-production-secret",
    STRIPE_SECRET_KEY: "sk_test_pureobom_local_build_fixture",
    PUREOBOM_BUILD_STRIPE_PORT: String(pricing.address().port),
    NODE_OPTIONS: `--require "${resolve(dirname(fileURLToPath(import.meta.url)), "build-stripe-preload.cjs").replaceAll("\\", "/")}"`,
  };
  const probe = await exec(
    process.execPath,
    [
      "-e",
      `const assert=require('node:assert/strict');
const https=require('node:https');
assert.throws(()=>https.request({host:'api.stripe.com',method:'POST',path:'/v1/checkout/sessions'}),/Unexpected Stripe operation/);
const Stripe=require('stripe');const s=new Stripe(process.env.STRIPE_SECRET_KEY);
Promise.all([s.prices.list({active:true}),s.products.list({active:true})]).then(r=>{
  assert.ok(r.every(x=>x.data.length===2));
  console.log('Real Stripe SDK received both local pricing responses; unsupported write rejected before transmission');
}).catch(e=>{console.error(e);process.exitCode=1})`,
    ],
    { cwd: source, env, windowsHide: true, timeout: 20000 },
  );
  report.sdkProbe = probe.stdout.trim();
  phase = "next-build";
  const args = [fromSource.resolve("next/dist/bin/next"), "build"];
  report.command = [process.execPath, ...args];
  const child = spawn(process.execPath, args, {
    cwd: source,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const capture = (chunk) => {
    const text = chunk.toString();
    log += text;
    process.stdout.write(text);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  report.exitCode = await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("close", done);
  });
  report.after = await hashes();
  report.afterStatus = await git("status", "--porcelain");
  report.automaticSourceChanges = Object.keys(report.before).filter(
    (path) => report.before[path] !== report.after[path],
  );
  if (report.exitCode === 0) {
    report.buildId = (
      await readFile(resolve(source, ".next/BUILD_ID"), "utf8")
    ).trim();
    report.prerender = JSON.parse(
      await readFile(resolve(source, ".next/prerender-manifest.json"), "utf8"),
    );
    assert.ok(
      report.requests.some(
        (r) => r.phase === "next-build" && r.path === "/v1/prices",
      ),
    );
    assert.ok(
      report.requests.some(
        (r) => r.phase === "next-build" && r.path === "/v1/products",
      ),
    );
  }
  process.exitCode = report.exitCode === 0 ? 0 : 1;
} catch (error) {
  report.error = String(error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(source, "..", label + ".log"), log);
  await writeFile(
    resolve(source, "..", label + ".json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  pricing.closeAllConnections();
  await new Promise((done) => pricing.close(done));
  await sql?.close();
  console.log(
    JSON.stringify({
      report: resolve(source, "..", label + ".json"),
      exitCode: report.exitCode,
      error: report.error,
      requests: report.requests,
    }),
  );
}
