// Jevtown as an MCP server over stdio: an agent writes the texts, the town reads them. A client
// launches it as `node /absolute/path/to/jevtown/mcp/server.js`; see "Use it from an agent (MCP)" in
// the README.
//
// The Jev key comes from the environment, or from .env.local next to package.json, the file
// `npm run check` reads; variables the client sets win over the file. It is never printed.
// stdout carries MCP messages and nothing else, one per line; everything else goes to stderr.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

// Before anything else runs: whatever the engine or Node prints with console.* must not reach the
// client as a broken protocol line, so the stream's own write goes to stderr and only `out` is stdout.
const out = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);
const log = (text) => process.stderr.write(`${text}\n`);

const { pickProvider, ask } = await import('../public/shared/jev.js');
const { createServer } = await import('./protocol.js');
const { createTools, INSTRUCTIONS } = await import('./tools.js');

const envFile = fileURLToPath(new URL('../.env.local', import.meta.url));
try {
  process.loadEnvFile(envFile);
} catch (error) {
  if (error.code !== 'ENOENT') log(`Jevtown MCP: could not read ${envFile}: ${error.message}`);
}

/** A setting from the environment; a negative or unreadable value falls back, with a word on stderr. */
function numberFrom(env, name, fallback) {
  if (env[name] === undefined || env[name] === '') return fallback;
  const value = Number(env[name]);
  if (value >= 0) return value;
  log(`Jevtown MCP: ${name}=${env[name]} is not a number of 0 or more; using ${fallback}.`);
  return fallback;
}

const provider = pickProvider(process.env);
const budgetUsd = numberFrom(process.env, 'JEVTOWN_MCP_DAILY_BUDGET_USD', 1);
const maxSeconds = numberFrom(process.env, 'JEVTOWN_MCP_MAX_SECONDS', 45);
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const server = createServer({
  info: { name: 'jevtown', title: 'Jevtown', version },
  instructions: INSTRUCTIONS,
  tools: createTools({ send: (request, retries) => ask(provider, request, retries), budgetUsd, maxSeconds, envFile, now: Date.now }),
  write: (message) => out(`${JSON.stringify(message)}\n`),
  log,
});

log(['Jevtown MCP server', provider ? `Jev via ${provider.label}` : 'no Jev key', budgetUsd ? `$${budgetUsd.toFixed(2)} a day` : 'no daily limit', maxSeconds ? `${maxSeconds} s` : 'no time limit'].join(' · '));

// A promise nobody awaited is a bug to see in the log, not a reason to drop the client's other calls.
process.on('unhandledRejection', (error) => log(`Jevtown MCP: ${error?.stack ?? error}`));

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => server.receive(line));
// The client closes stdin to shut the server down: calls in flight are dropped, and the process leaves once stdout is flushed.
lines.on('close', () => {
  server.stop();
  out('', () => process.exit(0));
});
