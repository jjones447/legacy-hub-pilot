// Synthetic, in-memory demonstration only. No transport, persistence or real inquiry.
(() => {
 'use strict';
 const get=id=>document.getElementById('preview-'+id);
 const fields=['name','organization','email','phone','interest','message'];
 const interests=['community-corporate','sanctuary-partner','sponsorship','event-respite','speaking','training','other','faith-community'];
 const result=get('result');
 const clear=()=>{for(const name of fields)get(name).value='';};
 // Untrusted URL can select a known interest only, never copy contact or message data.
 const params=location.search.length<=512?new URLSearchParams(location.search):new URLSearchParams();
 const choices=params.getAll('interest');
 const selected=choices.length===1&&choices[0].length<=32?choices[0]:null;
 if(interests.includes(selected))get('interest').value=selected;
 get('example').addEventListener('click',()=>{
  get('name').value='Fictional Partner';get('organization').value='Example Organization';
  get('email').value='partner@example.invalid';get('phone').value='';
  if(!interests.includes(get('interest').value))get('interest').value='community-corporate';
  get('message').value='Fictional example: we would like to explore caregiver support for our organization.';
  result.textContent='Fictional example filled in. Nothing has been sent or saved.';
 });
 get('clear').addEventListener('click',()=>{clear();result.textContent='Details cleared. Nothing was sent or saved.';});
 get('check').addEventListener('click',()=>{
  for(const name of fields)get(name).value=get(name).value.trim();
  if(fields.some(name=>!get(name).reportValidity())||!interests.includes(get('interest').value)){
   result.textContent='Please complete the required fields using fictional details only.';return;
  }
  const phone=get('phone').value;
  if(phone&&(!/^[0-9+() .-]{7,40}$/.test(phone)||phone.replace(/\D/g,'').length<7)){
   result.textContent='Use a valid fictional phone number, or leave the optional phone field blank.';return;
  }
  // Deliberately do not echo names/contact/message or create a receipt implying delivery.
  clear();result.textContent='Test complete. Nothing was sent to Legacy or saved. This was only a preview.';
 });
 // Only enable after all local handlers exist. No form element or submit control.
 get('fields').disabled=false;
})();
