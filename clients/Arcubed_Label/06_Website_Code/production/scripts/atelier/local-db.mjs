// A private local copy of the Arcubed Supabase database, for end-to-end tests
// (see scripts/atelier/README.md). PGlite (Postgres in-process) + every real
// migration, PostgREST in front, and a tiny proxy at a Supabase-style URL
// (/rest/v1). Nothing here talks to the real project.
//
// Tools are NOT project dependencies (the storefront never needs them):
//   PGLITE_DIR      a folder where @electric-sql/pglite and
//                   @electric-sql/pglite-socket are npm-installed
//   POSTGREST_BIN   a PostgREST v12+ binary
//   DATA_DIR        where the database lives (default: ./.local-db, ignored)
//
//   PGLITE_DIR=… POSTGREST_BIN=… node scripts/atelier/local-db.mjs [--reset]
// It writes DATA_DIR/env.local with the URL and the two local keys.
import { createRequire } from "node:module"; import fs from "node:fs"; import path from "node:path";
import http from "node:http"; import crypto from "node:crypto"; import { spawn } from "node:child_process";
const req = createRequire(path.join(process.env.PGLITE_DIR ?? ".", "package.json"));
const { PGlite } = await import(req.resolve("@electric-sql/pglite"));
const { PGLiteSocketServer } = await import(req.resolve("@electric-sql/pglite-socket"));
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const MIG = process.env.MIGRATIONS ?? path.join(ROOT, "supabase/migrations");
const HERE = path.resolve(process.env.DATA_DIR ?? path.join(ROOT, ".local-db"));
fs.mkdirSync(HERE, { recursive: true });
const DATA = path.join(HERE, "data");
if (process.argv.includes("--reset")) fs.rmSync(DATA, { recursive: true, force: true });
const fresh = !fs.existsSync(DATA);
const db = await PGlite.create(DATA);
if (fresh) {
  await db.exec(`
    create role anon nologin noinherit; create role authenticated nologin noinherit;
    create role service_role nologin noinherit bypassrls;
    create role authenticator login noinherit; grant anon, authenticated, service_role to authenticator;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to service_role;
    alter default privileges in schema public grant all on sequences to service_role;
    alter default privileges in schema public grant all on functions to service_role;`);
  const files = fs.readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    try { await db.exec(fs.readFileSync(path.join(MIG, f), "utf8")); console.log("applied", f); }
    catch (e) { console.error("FAILED", f, e.message); process.exit(1); }
  }
  await db.exec(`grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role;`);
}
const sock = new PGLiteSocketServer({ db, port: 54329, host: "127.0.0.1", maxConnections: 20 });
await sock.start();
const SECRET = "local-only-arcubed-test-secret-0123456789abcdef";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role) => { const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ role, iss: "local", iat: 1700000000, exp: 4100000000 });
  return `${h}.${p}.${crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`; };
const ANON = jwt("anon"), SERVICE = jwt("service_role");
fs.writeFileSync(path.join(HERE, "postgrest.conf"), `db-uri = "postgres://postgres@127.0.0.1:54329/postgres"
db-schemas = "public"
db-anon-role = "anon"
db-pool = 1
db-prepared-statements = false
db-channel-enabled = false
jwt-secret = "${SECRET}"
server-host = "127.0.0.1"
server-port = 54330
log-level = "error"
`);
const pgrst = spawn(process.env.POSTGREST_BIN ?? "postgrest", [path.join(HERE, "postgrest.conf")], { stdio: ["ignore", "inherit", "inherit"] });
process.on("exit", () => pgrst.kill());
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { pgrst.kill(); process.exit(0); });
// Supabase-style front door: /rest/v1/* -> PostgREST. Every request must carry one of our two keys.
http.createServer((rq, rs) => {
  const key = rq.headers.apikey;
  if (key !== ANON && key !== SERVICE) { rs.writeHead(401); return rs.end('{"message":"bad apikey"}'); }
  if (!rq.url.startsWith("/rest/v1")) { rs.writeHead(404); return rs.end("{}"); }
  const up = http.request({ host: "127.0.0.1", port: 54330, path: rq.url.replace(/^\/rest\/v1/, "") || "/", method: rq.method, headers: { ...rq.headers, host: "127.0.0.1:54330" } }, (ur) => {
    rs.writeHead(ur.statusCode, ur.headers); ur.pipe(rs); });
  up.on("error", (e) => { rs.writeHead(502); rs.end(JSON.stringify({ message: e.message })); });
  rq.pipe(up);
}).listen(54321, "127.0.0.1");
fs.writeFileSync(path.join(HERE, "env.local"), `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON}
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${ANON}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE}
`);
// Local-only SQL door for test assertions (127.0.0.1:54322, POST body = SQL).
http.createServer(async (rq, rs) => {
  let body = ""; for await (const ch of rq) body += ch;
  try { const r = await db.query(body); rs.writeHead(200, { "content-type": "application/json" }); rs.end(JSON.stringify(r.rows)); }
  catch (e) { rs.writeHead(400); rs.end(JSON.stringify({ error: e.message })); }
}).listen(54322, "127.0.0.1");
console.log("local supabase ready on http://127.0.0.1:54321 (fresh: " + fresh + ")");
