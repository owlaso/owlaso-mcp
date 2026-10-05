// Positive integer from env, or the fallback when unset/invalid (NaN would silently disable limits).
export function envInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

const MAX_CHARS = envInt(process.env.OWLASO_MAX_CHARS, 100_000);
const MAX_BYTES = envInt(process.env.OWLASO_MAX_RESPONSE_BYTES, 64 * 1024 * 1024);
const MAX_ERROR_CHARS = 500;

// Backend error text is relayed to the model: force a bounded single string.
function errorText(value, status) {
  const text = typeof value === 'string' && value ? value : `HTTP ${status}`;
  return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS)}…` : text;
}

async function readCapped(res, maxBytes) {
  const declared = Number(res.headers.get('content-length'));
  if (declared > maxBytes) {
    await res.body?.cancel();
    throw new Error(`OwlASO response too large (${declared} bytes > ${maxBytes}).`);
  }
  if (!res.body) return '';
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.byteLength;
    if (size > maxBytes) {
      throw new Error(`OwlASO response too large (> ${maxBytes} bytes).`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class OwlasoClient {
  constructor(base, timeoutMs = envInt(process.env.OWLASO_TIMEOUT_MS, 120_000), maxBytes = MAX_BYTES) {
    this.base = base;
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
  }

  url(route, params = {}) {
    const url = new URL(route, `${this.base}/`);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
    return url;
  }

  async get(route, params) {
    const signal = AbortSignal.timeout(this.timeoutMs);
    let res;
    try {
      // No redirects: the backend is local and must not bounce requests elsewhere.
      res = await fetch(this.url(route, params), { signal, redirect: 'error', headers: { accept: 'application/json' } });
    } catch (error) {
      if (signal.aborted) throw new Error(`OwlASO did not respond within ${this.timeoutMs} ms.`);
      throw new Error(`Cannot reach OwlASO at ${this.base} (${error.cause?.code || error.message}). Start it with \`npm start\` in the owlaso repo or set OWLASO_DIR.`);
    }
    let text;
    try {
      text = await readCapped(res, this.maxBytes);
    } catch (error) {
      if (signal.aborted) throw new Error(`OwlASO did not respond within ${this.timeoutMs} ms.`);
      throw error;
    }
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(errorText(data?.error, res.status));
    return data;
  }
}

export function toResult(data, maxChars = MAX_CHARS) {
  let text = JSON.stringify(data) ?? 'null';
  let truncated = false;
  if (text.length > maxChars) {
    // Don't split a surrogate pair at the cut.
    let cut = maxChars;
    const code = text.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    text = `${text.slice(0, cut)}\n…[truncated ${text.length - cut} chars; narrow filters or lower max]`;
    truncated = true;
  }
  return { content: [{ type: 'text', text }], ...(truncated ? { _meta: { truncated } } : {}) };
}

export function toError(error) {
  return { isError: true, content: [{ type: 'text', text: error?.message || String(error) }] };
}
