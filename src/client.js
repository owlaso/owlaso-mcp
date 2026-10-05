const MAX_CHARS = Number(process.env.OWLASO_MAX_CHARS || 100_000);

export class OwlasoClient {
  constructor(base, timeoutMs = Number(process.env.OWLASO_TIMEOUT_MS || 120_000)) {
    this.base = base;
    this.timeoutMs = timeoutMs;
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
    let res;
    try {
      res = await fetch(this.url(route, params), { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      throw new Error(`Cannot reach OwlASO at ${this.base} (${error.cause?.code || error.message}). Start it with \`npm start\` in the owlaso repo or set OWLASO_DIR.`);
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
}

export function toResult(data) {
  let text = JSON.stringify(data);
  let truncated = false;
  if (text.length > MAX_CHARS) {
    text = `${text.slice(0, MAX_CHARS)}\n…[truncated ${text.length - MAX_CHARS} chars; narrow filters or lower max]`;
    truncated = true;
  }
  return { content: [{ type: 'text', text }], ...(truncated ? { _meta: { truncated } } : {}) };
}

export function toError(error) {
  return { isError: true, content: [{ type: 'text', text: error.message || String(error) }] };
}
