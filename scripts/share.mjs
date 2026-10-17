// Serves a production build of the web app, plus the API behind it, on one public HTTPS URL through a
// Cloudflare quick tunnel, so the demo opens from any network. The URL works only while this process is
// running. Stop with Ctrl+C.
//
// Quick tunnels are anonymous: when the PC is offline for a while (sleep, lost Wi-Fi), Cloudflare deletes
// the tunnel and its URL stops working for good. This script then opens a new tunnel, points the API at
// it and prints the new URL, which is also written to storage/share/url.txt.
//
// --watch keeps the same URL while the code changes: the API reloads on save and the web app is rebuilt.
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { connect as tcpConnect, createServer } from 'node:net';
import { join, resolve } from 'node:path';
import concurrently from 'concurrently';
import { ragCommand } from './rag.mjs';

const root = resolve(import.meta.dirname, '..');
const WEB_PORT = 4173;
const API_PORT = 4000; // the /api proxy target in apps/web/vite.config.ts
const outDir = resolve(root, 'storage/share');
const watch = process.argv.includes('--watch');
const local = [`http://localhost:${WEB_PORT}`, `http://127.0.0.1:${WEB_PORT}`];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findCloudflared() {
  const candidates = [process.env.CLOUDFLARED, join(process.env.LOCALAPPDATA ?? '', 'TransAxis', 'bin', 'cloudflared.exe')];
  const found = candidates.find((c) => c && existsSync(c));
  if (found) return found;
  return spawnSync('cloudflared', ['--version'], { stdio: 'ignore' }).status === 0 ? 'cloudflared' : null;
}

const portFree = (port) =>
  new Promise((ok) => {
    const s = createServer()
      .once('error', () => ok(false))
      .once('listening', () => s.close(() => ok(true)))
      .listen(port);
  });

function fail(message) {
  console.error(`[share] ${message}`);
  process.exit(1);
}

/**
 * Asks Windows not to sleep while the link is up (a sleeping PC takes the link down). The request
 * belongs to the helper's thread, so it ends when the helper is stopped. Encoded to avoid quoting issues.
 */
function keepAwake() {
  if (process.platform !== 'win32') return null;
  // 2147483649 = ES_CONTINUOUS | ES_SYSTEM_REQUIRED. Written in decimal because Windows PowerShell reads
  // 0x80000001 as a negative Int32, which the uint parameter rejects.
  const script =
    `Add-Type -Namespace TransAxis -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'; ` +
    `[TransAxis.Power]::SetThreadExecutionState(2147483649) | Out-Null; while ($true) { Start-Sleep -Seconds 3600 }`;
  return spawn('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

const cloudflared = findCloudflared();
if (!cloudflared) {
  fail(
    'cloudflared not found. Install it with `winget install --id Cloudflare.cloudflared`, or put ' +
      'cloudflared.exe in %LOCALAPPDATA%\\TransAxis\\bin, or set CLOUDFLARED to its path.',
  );
}
for (const port of [API_PORT, WEB_PORT]) {
  if (!(await portFree(port))) fail(`Port ${port} is in use. Stop \`npm run dev\` (or whatever holds it) and retry.`);
}

console.log('[share] Building the web app…');
if (spawnSync('npm run build -w @transaxis/web', { cwd: root, stdio: 'inherit', shell: true }).status !== 0) {
  fail('Web build failed.');
}

mkdirSync(outDir, { recursive: true });
const tunnelLog = createWriteStream(join(outDir, 'cloudflared.log'));

/** Starts cloudflared. `url` resolves once it prints the public address; `lost` once the tunnel is gone. */
function openTunnel() {
  // HTTP/2 over TCP 443 gets through networks that drop the UDP that QUIC, the default, needs. Quick
  // tunnels don't fall back from QUIC on their own.
  const proc = spawn(cloudflared, ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${WEB_PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let markLost;
  const lost = new Promise((ok) => (markLost = ok));
  const url = new Promise((ok, reject) => {
    let seen = '';
    const timer = setTimeout(() => reject(new Error('cloudflared did not report a URL within 60 s')), 60_000);
    const onData = (chunk) => {
      tunnelLog.write(chunk); // keep draining both pipes for the tunnel's lifetime
      const text = chunk.toString();
      if (seen.length < 20_000) seen += text;
      const m = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/.exec(seen);
      if (m) {
        clearTimeout(timer);
        ok(m[0]);
      }
      // Cloudflare has deleted the quick tunnel; cloudflared would retry forever without recovering.
      if (text.includes('Tunnel not found')) markLost('Cloudflare dropped the tunnel after the connection was lost');
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`cloudflared exited with code ${code}`));
      markLost(`cloudflared exited with code ${code}`);
    });
  });
  return { proc, url, lost, markLost };
}

/** Opens a quick tunnel, retrying while the network or Cloudflare is unavailable. */
async function connect(maxAttempts = Infinity) {
  for (let attempt = 1; !stopping; attempt++) {
    const t = openTunnel();
    try {
      return { ...t, url: await t.url };
    } catch (err) {
      t.proc.kill();
      if (attempt >= maxAttempts) fail(`${err.message}. See storage/share/cloudflared.log.`);
      const wait = Math.min(60, 3 * attempt);
      console.warn(`[share] ${err.message}; retrying in ${wait} s…`);
      await sleep(wait * 1000);
    }
  }
  return null;
}

// Refresh and logout accept only the public origin (and local ones), so the API restarts with each new URL.
// Restarts are handled here, not by concurrently, which would also restart an API stopped on purpose.
function startApi(publicUrl, restarts = 0) {
  const api = concurrently(
    [
      {
        name: 'api',
        command: watch ? 'npm run dev -w @transaxis/api' : 'npm run start -w @transaxis/api',
        prefixColor: 'blue',
        // The tunnel and the preview proxy are trusted for client IPs.
        env: { API_PORT: String(API_PORT), WEB_ORIGIN: publicUrl, EXTRA_WEB_ORIGINS: local.join(','), TRUST_PROXY: 'loopback' },
      },
    ],
    { cwd: root },
  );
  const ended = () => {
    if (api !== current.api || stopping) return; // replaced for a new URL
    if (!watch || restarts >= 5) return shutdown('The API stopped.', 1);
    console.warn('[share] The API stopped; restarting it…');
    setTimeout(() => {
      if (api === current.api && !stopping) current.api = startApi(publicUrl, restarts + 1);
    }, 2000);
  };
  api.result.then(ended, ended);
  return api;
}

let stopping = false;
let renewing = false;
const current = { tunnel: null, api: null };

console.log('[share] Opening a Cloudflare quick tunnel…');
current.tunnel = await connect(3);
current.api = startApi(current.tunnel.url);
const web = concurrently(
  [
    { name: 'web', command: `npm run preview -w @transaxis/web -- --host 127.0.0.1 --port ${WEB_PORT} --strictPort`, prefixColor: 'green' },
    // Preview serves dist straight from disk, so each rebuild is live at the same URL.
    ...(watch ? [{ name: 'build', command: 'npm exec -w @transaxis/web -- vite build --watch', prefixColor: 'magenta' }] : []),
  ],
  // In watch mode a crash in one process must not take the tunnel (and its URL) down with it.
  { cwd: root, killOthersOn: watch ? [] : ['failure', 'success'], restartTries: watch ? 5 : 0, restartDelay: 2000 },
);
web.result.then(
  () => shutdown('The web server stopped.'),
  () => shutdown('The web server stopped.', 1),
);
// Document search and the assistant. If this service stops, the rest of the demo keeps working.
const ragSpec = ragCommand({ reload: watch });
const rag = ragSpec ? concurrently([ragSpec], { cwd: root, restartTries: 3, restartDelay: 3000 }) : null;
rag?.result.catch(() => console.warn('[share] The document service stopped; the assistant is unavailable until the next run.'));
const awake = keepAwake();

function shutdown(message, code = 0) {
  if (stopping) return;
  stopping = true;
  console.error(`[share] ${message} Shutting down.`);
  for (const c of [...(current.api?.commands ?? []), ...web.commands, ...(rag?.commands ?? [])]) c.kill();
  current.tunnel.proc.kill();
  awake?.kill();
  // Exit before concurrently's restart delay, or it would bring the web server back up.
  setTimeout(() => process.exit(code), 1500);
}

async function renew(reason) {
  if (stopping || renewing) return;
  renewing = true;
  console.warn(`[share] ${reason}; ${current.tunnel.url} no longer works. Opening a new tunnel…`);
  current.tunnel.proc.kill();
  const tunnel = await connect();
  if (!tunnel) return;
  if (stopping) return void tunnel.proc.kill();
  const old = current.api;
  current.tunnel = tunnel;
  writeFileSync(join(outDir, 'url.txt'), `${tunnel.url}\n`);
  current.api = null; // the old API's exit is expected, not a reason to stop or restart
  for (const c of old.commands) c.kill();
  await old.result.catch(() => {});
  for (let i = 0; i < 20 && !(await portFree(API_PORT)); i++) await sleep(500);
  if (stopping) return void tunnel.proc.kill();
  current.api = startApi(tunnel.url);
  renewing = false;
  tunnel.lost.then(renew);
  await announce(tunnel.url, true);
}

// The edge can take a few seconds to route a new tunnel; report the URL once it answers end to end.
async function announce(publicUrl, renewed = false) {
  let reachable = false;
  for (let i = 0; i < 45 && !reachable && publicUrl === current.tunnel.url; i++) {
    try {
      reachable = (await fetch(`${publicUrl}/api/v1/health`, { signal: AbortSignal.timeout(5000) })).ok;
    } catch {
      /* not routable yet */
    }
    if (!reachable) await sleep(2000);
  }
  if (publicUrl !== current.tunnel.url) return;
  console.log(
    reachable
      ? `
  TransAxis is ${renewed ? 'live again, at a NEW address:' : 'live at'}  ${publicUrl}
  (also ${local[0]} on this machine)

  Opens from any network while this process runs. Ctrl+C stops it; the next run gets a new URL.
  ${watch ? 'Watching for code changes: they go live at the same URL. ' : ''}${awake ? 'This PC is kept awake while sharing.' : ''}
  If the PC goes offline long enough for Cloudflare to drop the tunnel, a new URL is opened and printed here.
  Demo sign-in: dispatch@kaveri.demo / Demo@12345 (all roles are listed in the README).
`
      : `
  [share] Tunnel URL ${publicUrl} did not answer within 90 s. It may still come up; otherwise check
  the api/web output above and storage/share/cloudflared.log.
`,
  );
}

/** cloudflared reaches Cloudflare on port 7844 (TCP for HTTP/2). Some networks, such as campus Wi-Fi, block it. */
const edgeReachable = () =>
  new Promise((ok) => {
    const sock = tcpConnect({ host: 'region1.v2.argotunnel.com', port: 7844, timeout: 5000 });
    const done = (v) => {
      sock.destroy();
      ok(v);
    };
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });

/**
 * A quick tunnel can also stay registered but stop carrying traffic. When the public URL fails five checks
 * in a row while the local server and Cloudflare both answer, open a new tunnel instead. If the network
 * blocks the tunnel port, a new tunnel would not help either, so just say so and wait for a better network.
 */
function watchdog() {
  const answers = async (u) => {
    try {
      return (await fetch(u, { signal: AbortSignal.timeout(10_000) })).ok;
    } catch {
      return false;
    }
  };
  let failures = 0;
  let blocked = false;
  setInterval(async () => {
    if (stopping || renewing) return;
    const tunnel = current.tunnel;
    if (await answers(`${tunnel.url}/api/v1/health`)) {
      if (blocked) console.log(`[share] The link works again: ${tunnel.url}`);
      failures = 0;
      blocked = false;
      return;
    }
    // Offline, or our own server is down: a new tunnel would not help.
    if (!(await answers(`${local[1]}/api/v1/health`)) || !(await answers('https://www.cloudflare.com/cdn-cgi/trace'))) return;
    if (!(await edgeReachable())) {
      if (!blocked) {
        console.warn('[share] This network blocks Cloudflare Tunnel (port 7844), so the public link is down. It comes back by itself on a network that allows it, such as home Wi-Fi or a phone hotspot.');
      }
      blocked = true;
      failures = 0;
      return;
    }
    if (++failures >= 5 && tunnel === current.tunnel) {
      failures = 0;
      tunnel.markLost('The public URL stopped answering');
    }
  }, 60_000).unref();
}

writeFileSync(join(outDir, 'url.txt'), `${current.tunnel.url}\n`);
current.tunnel.lost.then(renew);
watchdog();
await announce(current.tunnel.url);
