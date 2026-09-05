const { createSupabaseClient } = require('../supabase');
const { createReadCache } = require('../readCache');
const fs=require('fs');const path=require('path');const vm=require('vm');
const config={URL:'https://project.supabase.co',SECRET_KEY:'sb_secret_test',sleep:async()=>{}};
const response=(status,body=[])=>({status,ok:status>=200 && status<300,headers:new Map(),text:async()=>JSON.stringify(body)});

describe('Supabase bounded reads and resilience',()=>{
  test('real limit, filters, explicit columns and range reach PostgREST',async()=>{
    const fetch=jest.fn().mockResolvedValue(response(200,[{id:3}]));const client=createSupabaseClient(config,fetch);
    expect(await client.select('operational_messages',{select:'id,event_at',filters:{channel:'eq.cop_rede_informa'},limit:10,range:[0,9]})).toEqual([{id:3}]);
    const [url,opts]=fetch.mock.calls[0];const q=new URL(url).searchParams;
    expect(q.get('limit')).toBe('10');expect(q.get('channel')).toBe('eq.cop_rede_informa');expect(q.get('select')).toBe('id,event_at');expect(opts.headers.Range).toBe('0-9');
  });
  test('selectSince delegates timestamp filtering to PostgREST',async()=>{
    const fetch=jest.fn().mockResolvedValue(response(200));const client=createSupabaseClient(config,fetch);
    await client.selectSince('operational_messages',{since:'2026-01-01',select:'id',limit:2});
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('updated_at')).toBe('gt.2026-01-01');
  });
  test.each([400,401,402,403])('does not retry HTTP %i',async status=>{
    const fetch=jest.fn().mockResolvedValue(response(status));const client=createSupabaseClient(config,fetch);
    await expect(client.select('x',{select:'id'})).rejects.toMatchObject({status});expect(fetch).toHaveBeenCalledTimes(1);
  });
  test('402 opens a client-wide cooldown; another table makes no request',async()=>{
    let now=1000;const clock=jest.spyOn(Date,'now').mockImplementation(()=>now);
    try {
      const fetch=jest.fn().mockResolvedValueOnce(response(402)).mockResolvedValue(response(200));
      const client=createSupabaseClient({...config,COOLDOWN_MS:5000},fetch);
      await expect(client.select('messages')).rejects.toMatchObject({status:402});
      await expect(client.select('alerts')).rejects.toMatchObject({status:402});expect(fetch).toHaveBeenCalledTimes(1);
      now+=5001;await client.select('alerts');expect(fetch).toHaveBeenCalledTimes(2);
    } finally {clock.mockRestore();}
  });
  test.each([408,429,500,502,503,504])('retries transient HTTP %i',async status=>{
    const fetch=jest.fn().mockResolvedValueOnce(response(status)).mockResolvedValue(response(200));
    await createSupabaseClient(config,fetch).select('x');expect(fetch).toHaveBeenCalledTimes(2);
  });
  test('network retry is bounded and write retries are disabled',async()=>{
    const fetch=jest.fn().mockRejectedValue(new Error('network'));const client=createSupabaseClient(config,fetch);
    await expect(client.select('x')).rejects.toThrow('network');expect(fetch).toHaveBeenCalledTimes(3);
    fetch.mockClear();await expect(client.upsert('x',[{id:1}],'id')).rejects.toThrow('network');expect(fetch).toHaveBeenCalledTimes(1);
  });
  test('minimal upsert by default; explicit returning remains available',async()=>{
    const fetch=jest.fn().mockResolvedValue(response(201));const client=createSupabaseClient(config,fetch);
    await client.upsert('x',[{id:1}],'id');expect(fetch.mock.calls[0][1].headers.Prefer).toContain('return=minimal');
    await client.upsert('x',[{id:1}],'id',{returning:true});expect(fetch.mock.calls[1][1].headers.Prefer).toContain('return=representation');
  });
});

describe('read cache',()=>{
  test('ten identical concurrent reads join one flight, including empty results',async()=>{
    let resolve;const read=jest.fn(()=>new Promise(r=>resolve=r));const cache=createReadCache();
    const requests=Array.from({length:10},()=>cache.get('messages:x',read));await Promise.resolve();expect(read).toHaveBeenCalledTimes(1);
    resolve({dados:[]});expect(await Promise.all(requests)).toHaveLength(10);await cache.get('messages:x',read);expect(read).toHaveBeenCalledTimes(1);
  });
  test('failures do not poison future reads',async()=>{
    const cache=createReadCache();const read=jest.fn().mockRejectedValueOnce(new Error('bad')).mockResolvedValue({dados:[]});
    await expect(cache.get('x',read)).rejects.toThrow('bad');await expect(cache.get('x',read)).resolves.toEqual({dados:[]});
  });
  test('invalidated in-flight result cannot refill cache',async()=>{
    const cache=createReadCache();let resolve;const pending=cache.get('x',()=>new Promise(r=>resolve=r));await Promise.resolve();cache.clear();
    resolve('old');await pending;expect(await cache.get('x',async()=>'new')).toBe('new');
  });
  test('quota serves stale object with visible degraded flag',async()=>{
    const cache=createReadCache({ttl:0});await cache.get('x',async()=>({dados:[{id:1}],cursor:'3'}));
    const data=await cache.get('x',async()=>{throw Object.assign(new Error('quota'),{status:402});});
    expect(data).toMatchObject({degraded:true,stale:true,cursor:'3'});
  });
});

describe('browser incremental state',()=>{
  const mod={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../js/operational-feed.js'),'utf8'),{module:mod,URLSearchParams});
  test('initial limited page, no changes, updates, removals, and historical cursor stay separate',async()=>{
    const feed=mod.exports.createFeed();
    const fetch=jest.fn().mockResolvedValueOnce({sucesso:true,dados:[{id:'a',_syncKey:'1'}],cursor:'5',before:'old',hasMore:true})
      .mockResolvedValueOnce({sucesso:true,dados:[],cursor:'5',removed:[]})
      .mockResolvedValueOnce({sucesso:true,dados:[{id:'b',_syncKey:'2'}],removed:['1'],cursor:'6'})
      .mockResolvedValueOnce({sucesso:true,dados:[{id:'older',_syncKey:'3'}],cursor:'9',before:'older',hasMore:false});
    await feed.read('/api/cop',fetch);await feed.read('/api/cop',fetch);expect(fetch.mock.calls[1][0]).toContain('since=5');
    expect((await feed.read('/api/cop',fetch)).dados.map(r=>r.id)).toEqual(['b']);
    await feed.read('/api/cop',fetch,{history:true});expect(fetch.mock.calls[3][0]).toContain('before=old');expect(feed.cursor).toBe('6');
  });
  test('errors and degraded cache never advance the browser cursor',async()=>{
    const feed=mod.exports.createFeed();const read=jest.fn().mockResolvedValueOnce({sucesso:true,dados:[],cursor:'10'}).mockRejectedValueOnce(new Error('quota'))
      .mockResolvedValueOnce({sucesso:true,dados:[{id:'stale'}],cursor:'50',degraded:true});
    await feed.read('/api/x',read);await expect(feed.read('/api/x',read)).rejects.toThrow('quota');await feed.read('/api/x',read);expect(feed.cursor).toBe('10');expect(feed.snapshot()).toHaveLength(0);
  });
  test('filter changes start a fresh bounded query',async()=>{
    const feed=mod.exports.createFeed();const read=jest.fn().mockResolvedValue({sucesso:true,dados:[],cursor:'5'});
    await feed.read('/api/x',read);await feed.read('/api/x',read,{filters:{areaPainel:'RIO'}});expect(read.mock.calls[1][0]).toBe('/api/x?areaPainel=RIO');
  });
});
