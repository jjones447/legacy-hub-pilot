// Fixed same-origin cookie transport. No token storage, caller identity, mail or retry loop.
export function supportTransport(fetchImpl=globalThis.fetch){
 return async(method,body)=>{
  if(!['GET','POST'].includes(method))throw Error('unsupported_method');
  const options={method,credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json'}};
  if(method==='POST'){options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
  const response=await fetchImpl('/api/portal/support-requests',options);
  if(response.status===401)return {ok:false,error:'unauthorized'};
  if(!/application\/json/i.test(response.headers.get('content-type')||''))throw Error('invalid_response');
  const result=await response.json();
  if(!result||typeof result.ok!=='boolean'||response.status>=500)throw Error('unavailable');
  if(!response.ok&&result.ok)throw Error('invalid_response');
  return result;
 };
}
