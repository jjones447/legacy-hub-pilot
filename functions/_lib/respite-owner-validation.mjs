// Shared program field limits, without treating update as a fresh consent receipt.
import { FIELDS } from './respite-b1.mjs';
const BOOLS = ['personal_care_help','medication_help','caregiver_onsite'];
export function validateOwnerDetails(details, firstTime) {
  if (!details || typeof details !== 'object' || Array.isArray(details) || typeof firstTime !== 'boolean' ||
      Object.keys(details).some(k => !Object.hasOwn(FIELDS,k) && !BOOLS.includes(k))) return null;
  const result = {};
  for (const [name,[limit,required]] of Object.entries(FIELDS)) {
    if (typeof details[name] !== 'string') return null;
    const value = details[name].trim();
    if (value.length > limit || (required && !value) || /[\u0000-\u001f\u007f]/.test(value)) return null;
    result[name] = value;
  }
  for (const name of BOOLS) {
    if (typeof details[name] !== 'boolean') return null;
    result[name] = details[name];
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.contact_email) ||
      ![result.contact_phone,result.emergency_phone].every(x => /^[0-9+() .-]{7,40}$/.test(x) && x.replace(/\D/g,'').length >= 7) ||
      (result.age && !/^\d{1,3}$/.test(result.age)) ||
      (result.personal_care_help && !result.personal_care_detail)) return null;
  return result;
}
