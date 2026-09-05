const fetch = require('node-fetch');
const { SUPABASE_CONFIG } = require('./config');

class SupabaseRequestError extends Error {
  constructor(message, status = 500, details = null) {
    super(message);
    this.name = 'SupabaseRequestError';
    this.status = status;
    this.details = details;
  }
}

function createSupabaseClient(config = SUPABASE_CONFIG, fetchImpl = fetch) {
  const baseUrl = String(config.URL || '').replace(/\/$/, '');
  const secretKey = config.SECRET_KEY || '';
  const schema = config.SCHEMA || 'public';
  let blockedUntil = 0;
  const cooldownMs = Number(config.COOLDOWN_MS) || 300000;
  const sleep = config.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));

  function isServerKey() {
    if (secretKey.startsWith('sb_secret_')) return true;
    if (secretKey.startsWith('sb_')) return false;
    try {
      const payload = JSON.parse(Buffer.from(secretKey.split('.')[1], 'base64url').toString('utf8'));
      return payload.role === 'service_role';
    } catch (error) {
      return false;
    }
  }

  function isConfigured() { return Boolean(baseUrl && isServerKey()); }

  function assertConfigured() {
    if (!isConfigured()) {
      throw new SupabaseRequestError(
        'Supabase operacional nao configurado. Defina SUPABASE_URL e uma SUPABASE_SECRET_KEY de servidor valida.',
        503,
        { code: 'SUPABASE_NOT_CONFIGURED' }
      );
    }
  }

  async function request(resource, options = {}) {
    assertConfigured();
    if (Date.now() < blockedUntil) {
      throw new SupabaseRequestError('Supabase temporariamente restrito por quota', 402,
        { code: 'SUPABASE_QUOTA_COOLDOWN', retryAfterMs: blockedUntil - Date.now() });
    }

    const url = new URL(`${baseUrl}/rest/v1/${resource}`);
    for (const [key, value] of Object.entries(options.query || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }

    const headers = {
      apikey: secretKey,
      Accept: 'application/json',
      'Accept-Profile': schema,
      'Content-Profile': schema,
      ...options.headers
    };
    if (!secretKey.startsWith('sb_')) headers.Authorization = `Bearer ${secretKey}`;

    const requestOptions = {
      method: options.method || 'GET',
      headers,
      timeout: options.timeout || 15000
    };
    if (options.body !== undefined) {
      requestOptions.headers['Content-Type'] = 'application/json';
      requestOptions.body = JSON.stringify(options.body);
    }

    const retryable = requestOptions.method === 'GET' || requestOptions.method === 'HEAD' || options.readOnly;
    let response;
    for (let attempt = 0; ; attempt++) {
      if (Date.now() < blockedUntil) throw new SupabaseRequestError('Supabase temporariamente restrito por quota', 402);
      try {
        response = await fetchImpl(url.toString(), requestOptions);
      } catch (error) {
        if (!retryable || attempt >= 2) throw error;
        await sleep(200 * 2 ** attempt + Math.random() * 100);
        continue;
      }
      if (response.status === 402) blockedUntil = Date.now() + cooldownMs;
      if (!retryable || attempt >= 2 || ![408, 429, 500, 502, 503, 504].includes(response.status)) break;
      await response.text();
      await sleep(200 * 2 ** attempt + Math.random() * 100);
    }

    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (error) { data = text; }
    }
    if (!response.ok) {
      const providerMessage = data?.message || data?.hint || String(data || '').slice(0, 300);
      throw new SupabaseRequestError(`Supabase ${response.status}: ${providerMessage || response.statusText}`, response.status, data);
    }
    return { data, status: response.status, headers: response.headers };
  }

  async function selectAll(table, query = {}, pageSize = 1000) {
    const rows = [];
    for (let offset = 0; ; offset += pageSize) {
      const result = await request(table, { query, headers: { Range: `${offset}-${offset + pageSize - 1}` } });
      const page = Array.isArray(result.data) ? result.data : [];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return rows;
  }

  async function select(table, { select: columns, filters = {}, order, limit = 200, range } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new SupabaseRequestError('Limite invalido', 400);
    const started = Date.now();
    const result = await request(table, {
      query: { ...filters, select: columns, order, limit },
      headers: range ? { Range: `${range[0]}-${range[1]}` } : {}
    });
    const rows = Array.isArray(result.data) ? result.data : [];
    console.log(`[Supabase] ${table} query: ${rows.length} rows durationMs=${Date.now() - started}`);
    return rows;
  }

  async function selectSince(table, { column = 'updated_at', since, filters = {}, ...options }) {
    return select(table, { ...options, filters: { ...filters, [column]: `gt.${since}` } });
  }

  async function upsert(table, rows, onConflict, { returning = false } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const result = await request(table, {
      method: 'POST',
      query: onConflict ? { on_conflict: onConflict } : {},
      headers: { Prefer: `resolution=merge-duplicates,return=${returning ? 'representation' : 'minimal'}` },
      body: rows
    });
    return Array.isArray(result.data) ? result.data : [];
  }

  async function rpc(functionName, params = {}, options = {}) {
    const result = await request(`rpc/${functionName}`, {
      method: 'POST', body: params, readOnly: options.readOnly === true
    });
    return result.data;
  }

  return { isConfigured, request, selectAll, select, selectSince, upsert, rpc };
}

module.exports = { SupabaseRequestError, createSupabaseClient, client: createSupabaseClient() };
