// Dedicated functional UI controller. Unmounted until ct13's authenticated composition.
import {validateSupportRequest,projectSupportStatus} from './portal-support-contract.mjs';
export function createSupportController({transport,view,newId=()=>crypto.randomUUID()}) {
 let generation=0,closed=false,busy=false,pending=null;
 function reset(){generation++;busy=false;pending=null;view.clear();view.busy(false);}
 async function history(){if(closed)return;const epoch=generation;try{const result=await transport('GET');if(closed||epoch!==generation)return;if(!result.ok){if(result.error==='unauthorized'){reset();view.error('Please sign in again.');return;}throw Error(result.error||'unavailable');}if(!Array.isArray(result.requests))throw Error('invalid_response');view.history(result.requests.map(r=>({id:r.id,status:projectSupportStatus(r.status?.code),created_at:r.created_at})));}catch{if(!closed&&epoch===generation)view.error('Request history is unavailable. Please try again.');}}
 async function submit(input){if(closed||busy)return;const signature=JSON.stringify(input);if(!pending||pending.signature!==signature)pending={signature,id:newId()};const value=validateSupportRequest({...input,request_id:pending.id});if(!value){view.error('Choose at least one support need and a contact preference.');return;}const epoch=generation;busy=true;view.busy(true);view.error('');try{const result=await transport('POST',value);if(closed||epoch!==generation)return;if(!result.ok){if(result.error==='unauthorized'){reset();view.error('Please sign in again.');return;}view.error(result.error==='contact_details_required'?'Update your contact details in My Profile, then try again.':'Your request was not confirmed. Please try again; we will reuse the same request reference.');return;}if(typeof result.id!=='string'||!projectSupportStatus(result.status?.code))throw Error('invalid_response');pending=null;view.saved(result);await history();}catch{if(!closed&&epoch===generation)view.error('Your request was not confirmed. Please try again; we will reuse the same request reference.');}finally{if(!closed&&epoch===generation){busy=false;view.busy(false);}}}
 return {submit,history,reset,dispose(){reset();closed=true;}};
}
export function mountSupportForm(root,transport){
 const doc=root.ownerDocument;
 const el=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
 const title=el('h2','How can we support you?'),intro=el('p',"Tell us a little about what you need, and someone from our team will follow up with you.");
 const form=el('form');form.className='support-request-form';
 const options=[['break','I need a break from caregiving'],['care','I need help caring for my loved one'],['connect',"I'd like to connect with other caregivers"],['resources','I need resources or information'],['unsure',"I'm not sure where to start"]];
 const fieldset=el('fieldset'),legend=el('legend','What support would you like?');fieldset.append(legend);
 const choices=options.map(([value,text])=>{const label=el('label'),input=el('input');label.className='support-need';input.type='checkbox';input.value=value;label.append(input,el('span',text));fieldset.append(label);return input;});
 const contactLabel=el('label','Preferred contact method'),select=el('select');for(const [value,text]of [['phone','Phone call'],['text','Text'],['email','Email']]){const option=el('option',text);option.value=value;select.append(option);}contactLabel.append(select);
 const noteLabel=el('label',"Is there anything else you'd like us to know? (optional)"),note=el('textarea');note.maxLength=2000;noteLabel.append(note);
 const error=el('p'),success=el('p'),list=el('ul');error.setAttribute('role','alert');success.setAttribute('role','status');
 const send=el('button','Send My Request');send.type='submit';form.append(fieldset,contactLabel,noteLabel,send,error,success);
 root.replaceChildren(title,intro,form,el('h2','My Support Requests'),list);
 const view={clear(){choices.forEach(c=>{c.checked=false;});note.value='';success.textContent='';error.textContent='';list.replaceChildren();},busy(on){send.disabled=on;form.setAttribute('aria-busy',String(on));},error(text){error.textContent=text;},saved(){success.textContent='Your request was received.';},history(rows){list.replaceChildren(...rows.map(r=>el('li',r.status?.label||'Progress unavailable')));}};
 const controller=createSupportController({transport,view});form.addEventListener('submit',event=>{event.preventDefault();controller.submit({needs:choices.filter(c=>c.checked).map(c=>c.value),preferred_contact:select.value,message:note.value});});
 return controller;
}
