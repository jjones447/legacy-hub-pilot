import {validateRespiteParticipantDetails} from './respite-participant-fields.mjs';
// Pure candidate. Contact is supplied by verified caregiver/Profile reads, never
// copied from browser JSON. No change to reusable participant records or routes.
export function buildRespiteRequestSnapshot(participantDetails,serverContact,session){
 const participant=validateRespiteParticipantDetails(participantDetails);
 if(!participant||!serverContact||Object.getPrototypeOf(serverContact)!==Object.prototype||!session||Object.getPrototypeOf(session)!==Object.prototype)return null;
 if(Reflect.ownKeys(serverContact).some(k=>!['name','email','phone'].includes(k))||Reflect.ownKeys(session).some(k=>!['caregiver_onsite'].includes(k)))return null;
 const contact={};
 for(const [key,max] of [['name',120],['email',254],['phone',40]]){
  const d=Object.getOwnPropertyDescriptor(serverContact,key);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='string')return null;
  const value=d.value.trim();if(!value||value.length>max||/[\u0000-\u001f\u007f]/.test(value))return null;contact[key]=value;
 }
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)||!/^[0-9+() .-]{7,40}$/.test(contact.phone)||contact.phone.replace(/\D/g,'').length<7)return null;
 const onsite=Object.getOwnPropertyDescriptor(session,'caregiver_onsite');if(!onsite||!Object.hasOwn(onsite,'value')||typeof onsite.value!=='boolean')return null;
 return {participant,caregiver:contact,session:{caregiver_onsite:onsite.value}};
}
