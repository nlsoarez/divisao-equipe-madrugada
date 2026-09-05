(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OperationalFeed=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
function key(row){return String(row?._syncKey||row?.messageId||row?.id||'');}
function createFeed(){
  const rows=new Map();let cursor=null,before=null,hasMore=false,filtersKey='{}';
  return {
    get cursor(){return cursor;},get before(){return before;},get hasMore(){return hasMore;},
    reset(){rows.clear();cursor=null;before=null;hasMore=false;filtersKey='{}';},
    snapshot(){return [...rows.values()];},
    async read(base,request,options={}){
      const filters=options.filters||{};const nextFilters=JSON.stringify(filters);const history=Boolean(options.history);
      if(!history&&nextFilters!==filtersKey){rows.clear();cursor=null;before=null;hasMore=false;filtersKey=nextFilters;}
      const params=new URLSearchParams(filters);
      if(history&&before)params.set('before',before);else if(!history&&cursor)params.set('since',cursor);
      const url=base+(params.toString()?'?'+params.toString():'');
      const page=await request(url);
      if(!page||page.sucesso===false)throw new Error(page?.erro||'Falha ao carregar feed');
      if(page.degraded)return { ...page,dados:this.snapshot() };
      if(history){for(const row of page.dados||[])rows.set(key(row),row);before=page.before||null;hasMore=Boolean(page.hasMore);}
      else {
        for(const removed of page.removed||[])rows.delete(String(removed));
        for(const row of page.dados||[])rows.set(key(row),row);
        if(page.cursor!=null)cursor=String(page.cursor);if(page.before!=null&&!before)before=page.before;hasMore=Boolean(page.hasMore);
      }
      return {...page,dados:this.snapshot()};
    }
  };
}
return {createFeed};
});
