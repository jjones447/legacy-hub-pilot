// In-memory owner fence. No cookie parsing, credential storage or automatic replay.
export function createSupportSession(fetchImpl=globalThis.fetch) {
 let owner='',epoch=0,stopped=false,view=null;
 function invalidate(){epoch++;owner='';view?.reset();}
 async function identity(){
  const response=await fetchImpl('/api/portal/me',{credentials:'same-origin',cache:'no-store',redirect:'error'});
  if(!response.ok||response.status!==200||response.redirected)throw Error('session_unavailable');
  const body=await response.json();if(!body?.ok||typeof body.profile?.id!=='string'||!body.profile.id)throw Error('session_unavailable');
  return body.profile.id;
 }
 async function start(){const generation=epoch;try{const current=await identity();if(stopped||epoch!==generation)throw Error('stale_session');if(owner&&owner!==current){invalidate();throw Error('changed_session');}owner=current;return current;}catch(error){if(epoch===generation)invalidate();throw error;}}
 async function checkedFetch(url,options){
  if(stopped||!owner)throw Error('session_unavailable');
  const generation=epoch;
  try{
   const current=await identity();
   if(stopped||generation!==epoch)throw Error('stale_session');
   if(current!==owner){invalidate();throw Error('changed_session');}
   const response=await fetchImpl(url,options);
   if(stopped||generation!==epoch)throw Error('stale_session');
   if(response.status===401||response.status===403)invalidate();
   return response;
  }catch(error){if(generation===epoch)invalidate();throw error;}
 }
 return {start,fetch:checkedFetch,invalidate,attach(next){view=next;return()=>{if(view===next){invalidate();view=null;next.dispose();}};},dispose(){stopped=true;invalidate();view?.dispose();view=null;}};
}
