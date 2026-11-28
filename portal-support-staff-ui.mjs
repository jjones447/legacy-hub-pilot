import {projectSupportStatus,canAdvanceSupportStatus,REQUEST_STATUSES} from './portal-support-contract.mjs';
export function mountStaffSupport(root,transport){
 let generation=0,closed=false;
 const doc=root.ownerDocument,el=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const alert=el('p');alert.setAttribute('role','alert');const rows=el('div');const refresh=el('button','Refresh support requests');refresh.type='button';
 root.replaceChildren(el('h2','Caregiver Support Requests'),refresh,alert,rows);
 function clear(){generation++;rows.replaceChildren();alert.textContent='';}
 function render(requests){rows.replaceChildren(...requests.map(r=>{
  const card=el('article');card.className='support-staff-card';
  card.append(el('h3','Support request'),el('p',String(r.message||'')),el('p','Contact preference: '+String(r.preferred_contact||'')),el('p','Needs: '+(Array.isArray(r.needs)?r.needs.join(', '):'')));
  const label=el('label','Request status'),select=el('select');
  const current=projectSupportStatus(r.status?.code);const status=el('p',current?.label||'Progress unavailable');status.setAttribute('role','status');
  if(current){for(const code of REQUEST_STATUSES){if(code!==current.code&&!canAdvanceSupportStatus(current.code,code))continue;const o=el('option',projectSupportStatus(code).label);o.value=code;select.append(o);}select.value=current.code;}
  else select.disabled=true;
  label.append(select);card.append(status,label);
  select.addEventListener('change',async()=>{if(closed)return;const epoch=generation;select.disabled=true;alert.textContent='';try{const result=await transport('POST',{id:r.id,revision:r.revision,status:select.value});if(closed||generation!==epoch)return;if(!result.ok){alert.textContent=result.error==='outcome_unknown'?'The change was not confirmed. Refresh before making another change.':'The request changed or could not be updated. Refresh before trying again.';return;}const next=projectSupportStatus(result.status?.code);if(!next)throw Error('invalid_response');status.textContent=next.label;alert.textContent='Status updated. Refresh before another change.';}catch{if(!closed&&generation===epoch)alert.textContent='The change was not confirmed. Refresh before making another change.';}});
  return card;
 }));}
 async function load(){if(closed)return;const epoch=++generation;rows.replaceChildren();alert.textContent='';refresh.disabled=true;try{const result=await transport('GET');if(closed||epoch!==generation)return;if(!result.ok||!Array.isArray(result.requests))throw Error('unavailable');render(result.requests);}catch{if(!closed&&epoch===generation)alert.textContent='Support requests are unavailable.';}finally{if(!closed&&epoch===generation)refresh.disabled=false;}}
 refresh.addEventListener('click',load);
 return {load,reset:clear,dispose(){clear();closed=true;}};
}
