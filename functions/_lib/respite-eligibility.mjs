// Pure projection of already verified server reads; NOT authentication or a
// browser-body contract. No storage, Staff enablement writer or route is added.
// Callers must read these values for the SAME current session owner and must
// fail closed if a required read/schema/capability is unavailable.
export function projectRespiteEligibility({profileFields, supportRequests, staffEnabled} = {}) {
  if (!profileFields || typeof profileFields !== 'object' || Array.isArray(profileFields)
      || !Array.isArray(supportRequests) || typeof staffEnabled !== 'boolean')
    return {ok:false,error:'unavailable'};
  const interest=profileFields.respite_interest;
  const needs=profileFields.support_needs;
  if ((interest !== undefined && typeof interest !== 'string')
      || (needs !== undefined && (!Array.isArray(needs) || needs.some(x=>typeof x!=='string')))
      || supportRequests.some(r=>!r || typeof r!=='object' || !Array.isArray(r.needs) || r.needs.some(x=>typeof x!=='string')))
    return {ok:false,error:'unavailable'};
  const reasons=[];
  if (interest==='Yes') reasons.push('profile_interest_yes');
  if (interest==='Maybe') reasons.push('profile_interest_maybe');
  if (needs?.includes('Respite care')) reasons.push('profile_support_need');
  if (supportRequests.some(r=>r.needs.includes('break'))) reasons.push('support_break');
  if (staffEnabled) reasons.push('staff_enabled');
  return {ok:true,visible:reasons.length>0,reasons};
}
