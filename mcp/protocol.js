// The Model Context Protocol, as much of it as a server of two tools needs, written by hand so the
// repository keeps no runtime dependencies. It knows nothing about Jevtown: it gets the tools and a
// way to write a message, and answers the lines a client sends.
//
// MCP 2026-07-28 is stateless: every request names its protocol version and the client's capabilities
// in `_meta`, and there is no handshake. Clients of 2025-11-25 and earlier open with `initialize`,
// which selects their revision for the rest of this process. The server answers both.
// https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning

export const MODERN = ['2026-07-28'];
export const LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const VERSION = 'io.modelcontextprotocol/protocolVersion';
const CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
const SERVER_INFO = 'io.modelcontextprotocol/serverInfo';
/**
 * The caching hints 2026-07-28 requires on server/discover and tools/list. The list does not change
 * while the process runs; a short hint lets a client see new tools soon after the server is updated.
 */
const CACHE_HINT = { ttlMs: 5 * 60 * 1000, cacheScope: 'public' };

/** A JSON-RPC error to answer with. */
const rpcError = (code, message, data) => Object.assign(new Error(message), { code, data });
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = (id) => typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));
/** Revisions are dates, so a later one compares greater. */
const since = (version, revision) => version >= revision;

/**
 * createServer({ info, instructions, tools, write, log }) → { receive(line), stop() }.
 * info: { name, title, version }. tools: [{ name, title, description, inputSchema, outputSchema,
 * annotations, run(args, { signal, progress }) → { text, structured } }]; a thrown error becomes a
 * tool error, with its stack logged unless it is marked `mistake`. write(message) sends one message
 * object; log(text) writes to stderr.
 */
export function createServer({ info, instructions, tools, write, log = () => {} }) {
  let legacy = null; // the revision an `initialize` chose for this process
  const inFlight = new Map(); // JSON of a tools/call id → its AbortController

  // Error codes must be integers: whatever else was thrown is a bug of this server, an Internal error.
  const failure = (id, error) => ({ jsonrpc: '2.0', ...(isId(id) ? { id } : {}), error: { code: Number.isInteger(error.code) ? error.code : -32603, message: error.message, ...(error.data !== undefined ? { data: error.data } : {}) } });
  const invalid = (id) => failure(id, rpcError(-32600, 'Invalid Request'));
  const infoFor = (version) => (since(version, '2025-06-18') ? info : { name: info.name, version: info.version });

  /** The revision a request is served under, or the error it gets. */
  function eraOf(params) {
    const meta = params?._meta;
    if (isObject(meta) && meta[VERSION] !== undefined) {
      const requested = meta[VERSION];
      if (!MODERN.includes(requested)) throw rpcError(-32022, 'Unsupported protocol version', { supported: MODERN, requested: String(requested) });
      if (!isObject(meta[CAPABILITIES])) throw rpcError(-32602, `missing ${CAPABILITIES} in _meta`);
      return { modern: true, version: requested };
    }
    if (legacy) return { modern: false, version: legacy };
    throw rpcError(-32602, `missing ${VERSION} in _meta`);
  }

  /** A tool as the revision knows it: fields a revision does not define are left out. */
  const toolFor = (tool, version) => ({
    name: tool.name,
    ...(since(version, '2025-06-18') ? { title: tool.title } : {}),
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(since(version, '2025-06-18') && tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    ...(since(version, '2025-03-26') && tool.annotations ? { annotations: tool.annotations } : {}),
  });

  const METHODS = {
    // A legacy client's handshake. Any of the legacy revisions is echoed: what this server uses of
    // them differs only by fields added on the way. Anything else gets the latest of them.
    initialize: (params) => {
      const asked = params?.protocolVersion;
      legacy = LEGACY.includes(asked) ? asked : LEGACY[0];
      return { protocolVersion: legacy, capabilities: { tools: {} }, serverInfo: infoFor(legacy), instructions };
    },
    ping: (params, era) => {
      // 2026-07-28 removed ping; legacy revisions still have it.
      if (era.modern) throw rpcError(-32601, 'Method not found: ping');
      return {};
    },
    'server/discover': (params, era) => {
      if (!era.modern) throw rpcError(-32601, 'Method not found: server/discover');
      return { supportedVersions: MODERN, capabilities: { tools: {} }, instructions, ...CACHE_HINT };
    },
    'tools/list': (params, era) => ({ tools: tools.map((tool) => toolFor(tool, era.version)), ...(era.modern ? CACHE_HINT : {}) }),
    'tools/call': (params, era, id) => call(params, era, id),
  };

  /** The answer to one message: a response, a promise of one, or null for a notification or a cancelled call. */
  function respond(message) {
    if (!isObject(message) || message.jsonrpc !== '2.0') return invalid(message?.id);
    // A response: this server sends no requests, so there is nothing it answers.
    if (!('method' in message) && 'id' in message && ('result' in message || 'error' in message)) return null;
    // Anything else without a method name is an Invalid Request to JSON-RPC 2.0; silence would leave a client that sent it waiting until its timeout.
    if (typeof message.method !== 'string') return invalid(message.id);
    if (!('id' in message)) {
      if (message.method === 'notifications/cancelled') inFlight.get(JSON.stringify(message.params?.requestId))?.abort();
      return null; // every other notification needs nothing from this server
    }
    const { id, method, params } = message;
    if (!isId(id)) return invalid(id);
    try {
      if (params !== undefined && !isObject(params)) throw rpcError(-32602, 'params must be an object');
      if (method === 'initialize') return result(id, METHODS.initialize(params), { modern: false });
      const era = eraOf(params);
      // Own names only: toString or constructor are no methods of this server.
      if (!Object.hasOwn(METHODS, method)) throw rpcError(-32601, `Method not found: ${method}`);
      const answer = METHODS[method](params, era, id);
      return answer instanceof Promise ? answer : result(id, answer, era);
    } catch (error) {
      if (!Number.isInteger(error.code)) log(`${method}: ${error.stack ?? error}`);
      return failure(id, error);
    }
  }

  function result(id, value, era) {
    if (!era.modern) return { jsonrpc: '2.0', id, result: value };
    return { jsonrpc: '2.0', id, result: { resultType: 'complete', ...value, _meta: { [SERVER_INFO]: info } } };
  }

  async function call(params, era, id) {
    const tool = tools.find((candidate) => candidate.name === params?.name);
    if (!tool) return failure(id, rpcError(-32602, `Unknown tool: ${params?.name}`));
    const args = params.arguments;
    if (args !== undefined && !isObject(args)) return failure(id, rpcError(-32602, 'arguments must be an object'));

    const key = JSON.stringify(id);
    const controller = new AbortController();
    inFlight.set(key, controller);
    const token = params._meta?.progressToken;
    let last = 0;
    let open = true;
    // Progress only grows, and stops when the call has an answer or was cancelled.
    const progress = (done, total, message) => {
      if (!open || controller.signal.aborted || !isId(token) || !(done > last)) return;
      last = done;
      write({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: done, ...(total !== undefined ? { total } : {}), ...(message && since(era.version, '2025-03-26') ? { message } : {}) } });
    };
    try {
      const { text, structured } = await tool.run(args ?? {}, { signal: controller.signal, progress });
      if (controller.signal.aborted) return null;
      const content = [{ type: 'text', text }, { type: 'text', text: JSON.stringify(structured) }];
      return result(id, { content, ...(since(era.version, '2025-06-18') ? { structuredContent: structured } : {}), isError: false }, era);
    } catch (error) {
      // A cancelled call gets nothing more, not even its error.
      if (controller.signal.aborted) return null;
      if (!error.mistake) log(`${tool.name}: ${error.stack ?? error}`);
      return result(id, { content: [{ type: 'text', text: error.message }], isError: true }, era);
    } finally {
      open = false;
      if (inFlight.get(key) === controller) inFlight.delete(key);
    }
  }

  function receive(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return write(failure(undefined, rpcError(-32700, 'Parse error')));
    }
    if (!Array.isArray(message)) {
      const answer = respond(message);
      if (answer instanceof Promise) answer.then((settled) => settled && write(settled));
      else if (answer) write(answer);
      return;
    }
    // Only 2025-03-26 had clients send JSON-RPC batches; the revision after it removed them.
    if (legacy !== '2025-03-26' || !message.length) return write(failure(undefined, rpcError(-32600, 'Invalid Request')));
    Promise.all(message.map(respond)).then((answers) => {
      const given = answers.filter(Boolean);
      if (given.length) write(given);
    });
  }

  /** Stops every call in flight: the process is going away. */
  function stop() {
    for (const controller of inFlight.values()) controller.abort();
  }

  return { receive, stop };
}
