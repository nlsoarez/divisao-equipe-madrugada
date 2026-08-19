const { createSupabaseClient, SupabaseRequestError } = require('../supabase');

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: new Map(),
    text: jest.fn().mockResolvedValue(body === null ? '' : JSON.stringify(body))
  };
}

describe('Supabase REST client', () => {
  const config = {
    URL: 'https://project.supabase.co',
    SECRET_KEY: 'sb_secret_server-test',
    SCHEMA: 'public'
  };

  test('sends the secret only in backend request headers', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, [{ id: 1 }]));
    const client = createSupabaseClient(config, fetchImpl);

    await client.request('operational_messages', { query: { select: '*' } });

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toContain('/rest/v1/operational_messages?select=*');
    expect(options.headers.apikey).toBe('sb_secret_server-test');
    expect(options.headers.Authorization).toBeUndefined();
  });

  test('keeps Authorization for the legacy service_role JWT', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, []));
    const legacyServiceRole = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature';
    const client = createSupabaseClient({
      ...config,
      SECRET_KEY: legacyServiceRole
    }, fetchImpl);

    await client.request('operational_messages');

    expect(fetchImpl.mock.calls[0][1].headers.Authorization)
      .toBe(`Bearer ${legacyServiceRole}`);
  });

  test('rejects a publishable key in the backend configuration', async () => {
    const client = createSupabaseClient({
      ...config,
      SECRET_KEY: 'sb_publishable_not-a-server-key'
    }, jest.fn());

    expect(client.isConfigured()).toBe(false);
    await expect(client.request('operational_messages')).rejects.toMatchObject({
      status: 503,
      details: { code: 'SUPABASE_NOT_CONFIGURED' }
    });
  });

  test('paginates reads beyond the Data API row limit', async () => {
    const firstPage = Array.from({ length: 2 }, (_, id) => ({ id }));
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(response(206, firstPage))
      .mockResolvedValueOnce(response(200, [{ id: 2 }]));
    const client = createSupabaseClient(config, fetchImpl);

    const rows = await client.selectAll('operational_messages', { select: '*' }, 2);

    expect(rows).toHaveLength(3);
    expect(fetchImpl.mock.calls[0][1].headers.Range).toBe('0-1');
    expect(fetchImpl.mock.calls[1][1].headers.Range).toBe('2-3');
  });

  test('returns provider details on a failed request', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(403, { message: 'permission denied' }));
    const client = createSupabaseClient(config, fetchImpl);

    await expect(client.request('operational_messages')).rejects.toMatchObject({
      name: 'SupabaseRequestError',
      status: 403,
      details: { message: 'permission denied' }
    });
    expect(SupabaseRequestError).toBeDefined();
  });
});
