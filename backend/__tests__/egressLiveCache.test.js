jest.mock('../supabase',()=>({client:{
  rpc:jest.fn(),upsert:jest.fn().mockResolvedValue([]),select:jest.fn(),request:jest.fn(),selectAll:jest.fn(),isConfigured:jest.fn(()=>true)
}}));
const {client:supabase}=require('../supabase');
const storage=require('../storage');

describe('operational live page cache',()=>{
  beforeEach(()=>{jest.clearAllMocks();storage.limparCache();});
  test('legacy polling reuses the initial bounded page without another Supabase read',async()=>{
    supabase.rpc.mockResolvedValue({dados:[{id:'1',messageId:'m1',dataGeracao:'05/09/2026 01:00'}],removed:[],cursor:'10',before:null,hasMore:false});
    expect((await storage.obterCopRedeInforma({})).map(x=>x.messageId)).toEqual(['m1']);
    expect((await storage.obterCopRedeInforma({})).map(x=>x.messageId)).toEqual(['m1']);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });
  test('a backend write updates the live page without forcing a reread',async()=>{
    supabase.rpc.mockResolvedValue({dados:[{id:'1',messageId:'m1',dataGeracao:'05/09/2026 01:00'}],removed:[],cursor:'10',before:null,hasMore:false});
    await storage.obterCopRedeInforma({});
    await storage.adicionarCopRedeInforma({id:'2',messageId:'m2',dataGeracao:'05/09/2026 01:01'});
    const rows=await storage.obterCopRedeInforma({});
    expect(rows.map(x=>x.messageId)).toEqual(['m2','m1']);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.upsert).toHaveBeenCalledTimes(1);
  });
});
