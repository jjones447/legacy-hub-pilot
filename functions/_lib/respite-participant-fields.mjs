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

const labels = {
  participant_name: 'Loved one full name',
  age: 'Age (optional)',
  relationship: 'Relationship to loved one',
  mobility: 'Mobility and support needs (write none if none)',
  communication: 'Communication preferences and support',
  personal_care_help: 'Personal-care assistance needed?',
  personal_care_detail: 'Personal-care help explanation (required if yes)',
  safety: 'Safety considerations (optional)',
  allergies_diet: 'Allergies / dietary needs (write none if none)',
  activities: 'Enjoyable activities',
  comfort: 'Comfort and support preferences (optional)',
  emergency_name: 'Emergency contact full name',
  emergency_relationship: 'Emergency contact relationship',
  emergency_phone: 'Emergency contact phone',
  medication_help: 'Medication assistance needed? Staff must discuss accommodation.',
};

export function respiteParticipantQuestions() {
  return Object.entries(labels).map(([key, label]) => {
    const bounds = RESPITE_PARTICIPANT_FIELDS[key];
    return bounds
      ? { key, label, type: bounds[0] > 254 ? 'textarea' : 'text', maxLength: bounds[0], required: bounds[1] }
      : { key, label, type: 'boolean', required: true };
  });
}
