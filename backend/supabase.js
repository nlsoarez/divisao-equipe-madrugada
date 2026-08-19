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

  function isConfigured() {
    return Boolean(baseUrl && isServerKey());
  }

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

    const url = new URL(`${baseUrl}/rest/v1/${resource}`);
    for (const [key, value] of Object.entries(options.query || {})) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const headers = {
      apikey: secretKey,
      Accept: 'application/json',
      'Accept-Profile': schema,
      'Content-Profile': schema,
      ...options.headers
    };

    // As novas chaves sb_secret_* sao opacas e falham como Bearer JWT.
    // A chave service_role legada continua sendo um JWT e precisa deste header.
    if (!secretKey.startsWith('sb_')) {
      headers.Authorization = `Bearer ${secretKey}`;
    }

    const requestOptions = {
      method: options.method || 'GET',
      headers,
      timeout: options.timeout || 15000
    };

    if (options.body !== undefined) {
      requestOptions.headers['Content-Type'] = 'application/json';
      requestOptions.body = JSON.stringify(options.body);
    }

    const response = await fetchImpl(url.toString(), requestOptions);
    const text = await response.text();
    let data = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        data = text;
      }
    }

    if (!response.ok) {
      const providerMessage = data?.message || data?.hint || String(data || '').slice(0, 300);
      throw new SupabaseRequestError(
        `Supabase ${response.status}: ${providerMessage || response.statusText}`,
        response.status,
        data
      );
    }

    return {
      data,
      status: response.status,
      headers: response.headers
    };
  }

  async function selectAll(table, query = {}, pageSize = 1000) {
    const rows = [];

    for (let offset = 0; ; offset += pageSize) {
      const result = await request(table, {
        query,
        headers: {
          Range: `${offset}-${offset + pageSize - 1}`,
          Prefer: 'count=exact'
        }
      });
      const page = Array.isArray(result.data) ? result.data : [];
      rows.push(...page);

      if (page.length < pageSize) break;
    }

    return rows;
  }

  async function upsert(table, rows, onConflict) {
    if (!Array.isArray(rows) || rows.length === 0) return [];

    const result = await request(table, {
      method: 'POST',
      query: onConflict ? { on_conflict: onConflict } : {},
      headers: {
        Prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: rows
    });

    return Array.isArray(result.data) ? result.data : [];
  }

  async function rpc(functionName, params = {}) {
    const result = await request(`rpc/${functionName}`, {
      method: 'POST',
      body: params
    });
    return result.data;
  }

  return {
    isConfigured,
    request,
    selectAll,
    upsert,
    rpc
  };
}

module.exports = {
  SupabaseRequestError,
  createSupabaseClient,
  client: createSupabaseClient()
};
