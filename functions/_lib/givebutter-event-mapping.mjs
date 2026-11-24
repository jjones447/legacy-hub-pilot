// Explicit provider-to-local IDs. No event creation, fuzzy title matching or URL inference.
export function givebutterEventTarget(body, configured) {
  const legacy = body.data?.event_id || body.data?.campaign_id || null;
  if (configured === undefined || configured === null || configured === '') return legacy;
  if (typeof configured !== 'string' || configured.length > 16384) throw Error('invalid_mapping');
  const map = JSON.parse(configured);
  const plain = x => x && typeof x === 'object' && !Array.isArray(x);
  if (!plain(map) || Object.keys(map).some(k => !['event', 'campaign'].includes(k))) throw Error('invalid_mapping');
  for (const group of Object.values(map)) {
    if (!plain(group) || Object.keys(group).length > 100) throw Error('invalid_mapping');
    for (const [key, value] of Object.entries(group)) {
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(key) || typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw Error('invalid_mapping');
    }
  }
  // A donation is not an event ticket. Keep existing donation handling unchanged.
  if (body.event !== 'ticket.created') return legacy;
  const hits=[];
  for (const [group, field] of [['event','event_id'],['campaign','campaign_id']]) {
    const value=body.data?.[field];
    if (typeof value!=='string' && !(Number.isSafeInteger(value)&&value>=0)) continue;
    if (Object.hasOwn(map[group] || {},String(value))) hits.push(map[group][String(value)]);
  }
  if (new Set(hits).size > 1) throw Error('ambiguous_mapping');
  return hits[0] ?? legacy;
}
