// Reuses the retained B1 question names/bounds without importing its routes or
// copying caregiver contact/session/consent into reusable participant storage.
export const RESPITE_PARTICIPANT_FIELDS=Object.freeze({
 participant_name:[120,true],age:[3,false],relationship:[80,true],
 mobility:[600,true],communication:[600,true],personal_care_detail:[600,false],
 safety:[600,false],allergies_diet:[600,true],activities:[600,true],comfort:[600,false],
 emergency_name:[120,true],emergency_relationship:[80,true],emergency_phone:[40,true],
});
for(const limit of Object.values(RESPITE_PARTICIPANT_FIELDS))Object.freeze(limit);
const bools=['personal_care_help','medication_help'];
export function validateRespiteParticipantDetails(input){
 if(!input||Object.getPrototypeOf(input)!==Object.prototype||Reflect.ownKeys(input).some(k=>!Object.hasOwn(RESPITE_PARTICIPANT_FIELDS,k)&&!bools.includes(k)))return null;
 const out={};
 for(const [name,[limit,required]] of Object.entries(RESPITE_PARTICIPANT_FIELDS)){
  const d=Object.getOwnPropertyDescriptor(input,name);
  if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='string')return null;
  const value=d.value.trim();
  if(value.length>limit||(required&&!value)||/[\u0000-\u001f\u007f]/.test(value))return null;
  out[name]=value;
 }
 for(const name of bools){const d=Object.getOwnPropertyDescriptor(input,name);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='boolean')return null;out[name]=d.value;}
 if(out.age&&!/^\d{1,3}$/.test(out.age))return null;
 if(!/^[0-9+() .-]{7,40}$/.test(out.emergency_phone)||out.emergency_phone.replace(/\D/g,'').length<7)return null;
 if(out.personal_care_help&&!out.personal_care_detail)return null;
 return out;
}
