// Intended product labels from the controlling requester specification.
// No source correspondence or private document is included here.
const decline = 'Prefer not to answer';
const text = (key, label, maxLength = 120, extra = {}) => ({ key, label, type: 'text', maxLength, ...extra });
const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra });
const multi = (key, label, options, extra = {}) => ({ key, label, type: 'multi', options, ...extra });
const currentCare = { currentCare: true };
const privateAnswer = { restricted: true };
export const PROFILE_SECTIONS = [
  { key: 'personal', title: 'Personal Information', fields: [
    text('first_name', 'First Name', 120, { required: true }),
    text('last_name', 'Last Name', 120, { required: true }),
    text('preferred_name', 'Preferred Name'),
    { key: 'date_of_birth', label: 'Date of Birth', type: 'date', ...privateAnswer },
    { key: 'email', label: 'Email Address', type: 'email', readOnly: true, required: true },
    text('phone', 'Phone Number', 40, { inputMode: 'tel' }),
    text('street', 'Street', 200), text('city', 'City'), text('state', 'State', 80),
    text('zip', 'ZIP Code', 10, { required: true, inputMode: 'numeric' }),
    select('preferred_contact', 'Preferred Contact Method', ['Phone Call', 'Text Message', 'Email']),
    text('preferred_language', 'Preferred Language'),
  ] },
  { key: 'journey', title: 'About Your Caregiving Journey', fields: [
    select('currently_caring', 'Are you currently providing care for someone?', ['Yes', 'No', 'I was previously a caregiver', decline]),
    select('relationship', 'What is your relationship to the person you care for?', ['Parent', 'Spouse/Partner', 'Grandparent', 'Sibling', 'Child', 'Other', decline], currentCare),
    select('care_duration', 'How long have you been a caregiver?', ['Less than 1 year', '1–3 years', '4–6 years', '7–10 years', 'More than 10 years', decline], currentCare),
    select('dementia_status', 'Does the person you care for live with dementia?', ['Yes, diagnosed', 'Suspected dementia', 'No', 'Unsure', decline], currentCare),
    select('dementia_type', 'What type of dementia does your loved one have?', ["Alzheimer's disease", 'Vascular dementia', 'Lewy body dementia', 'Frontotemporal dementia', 'Mixed dementia', 'Other', 'Unknown', decline], { ...currentCare, dependsOn: 'dementia_status', visibleWhen: ['Yes, diagnosed', 'Suspected dementia'] }),
    select('lives_together', 'Does the person you care for live with you?', ['Yes', 'No', decline], currentCare),
    select('care_role', 'What is your caregiving role?', ['Primary caregiver', 'Shared caregiver', 'Supporting caregiver', decline], currentCare),
    select('care_hours', 'Approximately how many hours per week do you provide care?', ['Less than 10 hours', '10–20 hours', '21–40 hours', 'More than 40 hours', decline], currentCare),
    select('care_help', 'Do you have help with caregiving?', ['Regularly', 'Sometimes', 'Rarely', 'Never', decline], currentCare),
  ] },
  { key: 'support', title: 'Your Support Needs', fields: [
    multi('support_needs', 'What types of support would be helpful to you right now?', ['Respite care', 'Emotional support or caregiver support groups', 'Dementia education and training', 'Help navigating community resources', 'Care planning and decision-making', 'Wellness and self-care opportunities', 'Financial or legal resources', 'Opportunities to connect with other caregivers', 'Other', decline]),
    text('care_challenge', 'What is your biggest caregiving challenge right now?', 500, { multiline: true }),
    select('contact_requested', 'Would you like someone from Legacy to contact you about available support?', ['Yes', 'No']),
    select('support_contact_method', 'Preferred Contact Method for Support', ['Phone Call', 'Text Message', 'Email'], { dependsOn: 'contact_requested', visibleWhen: ['Yes'] }),
  ] },
  { key: 'respite', title: 'Respite Care Information', fields: [
    select('respite_used', 'Have you used respite care before?', ['Yes', 'No', 'Unsure', decline]),
    select('respite_interest', 'Are you interested in respite services?', ['Yes', 'No', 'Maybe', decline]),
    select('respite_type', 'What type of respite care interests you?', ['Drop-in respite', 'In-home respite', 'Both', 'Unsure', decline]),
    multi('respite_barriers', 'What has prevented you from accessing respite care?', ['Cost', 'Transportation', 'Limited availability', "Difficulty trusting others with my loved one's care", 'Lack of information about available services', 'Scheduling challenges', 'Nothing has prevented me', 'Other', decline], { exclusive: ['Nothing has prevented me', decline] }),
  ] },
  { key: 'demographics', title: 'Optional Demographic Information',
    intro: 'The following questions are optional and help Legacy better understand the caregivers we serve and identify gaps in access to support. Your responses will not affect your ability to participate in our programs.',
    fields: [
      multi('race_ethnicity', 'How do you describe your race or ethnicity?', ['Black or African American', 'Hispanic or Latino/a/x', 'White', 'Asian', 'American Indian or Alaska Native', 'Native Hawaiian or Other Pacific Islander', 'Middle Eastern or North African', 'Another identity (please specify)', decline], privateAnswer),
      text('race_ethnicity_other', 'Another race or ethnicity (please specify)', 120, { ...privateAnswer, dependsOn: 'race_ethnicity', visibleWhen: ['Another identity (please specify)'] }),
      select('gender', 'How do you describe your gender?', ['Woman', 'Man', 'Nonbinary', 'Another identity (please specify)', decline], privateAnswer),
      text('gender_other', 'Another gender identity (please specify)', 120, { ...privateAnswer, dependsOn: 'gender', visibleWhen: ['Another identity (please specify)'] }),
      select('employment', 'What is your current employment status?', ['Employed full-time', 'Employed part-time', 'Self-employed', 'Unemployed', 'Retired', 'Not currently working due to caregiving responsibilities', 'Other', decline], privateAnswer),
    ] },
];
export const PROFILE_FIELDS = Object.fromEntries(PROFILE_SECTIONS.flatMap(section => section.fields.map(field => [field.key, field])));
export const RESTRICTED_PROFILE_FIELDS = Object.keys(PROFILE_FIELDS).filter(key => PROFILE_FIELDS[key].restricted);

export function isProfileFieldVisible(field, fields) {
  if (field.currentCare && ['No', 'I was previously a caregiver', decline].includes(fields.currently_caring)) return false;
  if (!field.dependsOn) return true;
  const answer = fields[field.dependsOn];
  return field.visibleWhen.some(value => Array.isArray(answer) ? answer.includes(value) : answer === value);
}

export function profileCompletion(fields) {
  const required = Object.values(PROFILE_FIELDS).filter(field => field.required);
  const missing = required.filter(field => typeof fields[field.key] !== 'string' || !fields[field.key].trim()).map(field => field.key);
  return { required: required.length, answered: required.length - missing.length, missing, complete: missing.length === 0 };
}

export function normalizeProfileField(key, value) {
  if (!Object.hasOwn(PROFILE_FIELDS, key) || PROFILE_FIELDS[key].readOnly) return { ok: false };
  const field = PROFILE_FIELDS[key];
  if (value === null || value === '') return { ok: true, value };
  if (field.type === 'multi') {
    if (!Array.isArray(value) || value.length > field.options.length || new Set(value).size !== value.length
        || !value.every(option => field.options.includes(option))) return { ok: false };
    const exclusive = field.exclusive ?? [decline];
    if (value.length > 1 && exclusive.some(option => value.includes(option))) return { ok: false };
    return { ok: true, value };
  }
  if (typeof value !== 'string') return { ok: false };
  if (field.type === 'select') return { ok: field.options.includes(value), value };
  if (field.type === 'date') {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
    return { ok: !!date && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
      && value <= new Date().toISOString().slice(0, 10), value };
  }
  if (value.length > field.maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return { ok: false };
  value = value.trim();
  if (key === 'zip' && value && !/^\d{5}(?:-\d{4})?$/.test(value)) return { ok: false };
  return { ok: true, value };
}
