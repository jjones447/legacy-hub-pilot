import { validateRespiteParticipantDetails } from './respite-participant-fields.mjs';

function validateContact(input) {
  const limits = { name: 120, email: 254, phone: 40 };
  if (!input || Object.getPrototypeOf(input) !== Object.prototype ||
      Reflect.ownKeys(input).length !== Object.keys(limits).length) return null;

  const contact = {};
  for (const [key, max] of Object.entries(limits)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') return null;
    const value = descriptor.value.trim();
    if (!value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return null;
    contact[key] = value;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email) ||
      !/^[0-9+() .-]{7,40}$/.test(contact.phone) || contact.phone.replace(/\D/g, '').length < 7) return null;
  return contact;
}

export function respiteCaregiverContact({ first_name, last_name, email, phone }) {
  const name = [first_name, last_name].filter(part => typeof part === 'string' && part.trim())
    .map(part => part.trim()).join(' ');
  return validateContact({ name, email, phone });
}

export function buildRespiteRequestSnapshot(participantDetails, serverContact, session) {
  const participant = validateRespiteParticipantDetails(participantDetails);
  const caregiver = validateContact(serverContact);
  if (!participant || !caregiver || !session || Object.getPrototypeOf(session) !== Object.prototype ||
      Reflect.ownKeys(session).length !== 1) return null;

  const onsite = Object.getOwnPropertyDescriptor(session, 'caregiver_onsite');
  if (!onsite || !Object.hasOwn(onsite, 'value') || typeof onsite.value !== 'boolean') return null;
  return { participant, caregiver, session: { caregiver_onsite: onsite.value } };
}
