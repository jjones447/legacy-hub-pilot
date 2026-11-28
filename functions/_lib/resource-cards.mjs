import links from '../../content/resource-links.json' with { type: 'json' };
import resources from '../../content/resources.json' with { type: 'json' };

// Use the same public content that builds the resource pages. A multi-link card
// keeps all of its links when the caregiver returns to it from their saved list.
const cards = new Map();

function addCard(id, title, page) {
  if (!id) return;
  if (cards.has(id)) throw new Error('Duplicate public resource ID');
  cards.set(id, Object.freeze({ title, href: '/' + page + '#' + id }));
}

function addCollection(collection, page) {
  const items = collection.groups?.flatMap(group => group.items ?? []) ?? collection.items;
  for (const item of items) {
    const hasLink = item.links?.length ? item.links.some(link => link.url?.trim()) : item.url?.trim();
    if (hasLink) addCard(item.resource_id, item.name, page);
  }
}

addCollection(links.trusted_organizations, 'trusted-resources');
addCollection(links.caregiver_recommended, 'trusted-resources');
addCollection(links.follow_and_learn, 'follow-and-learn');
for (const guide of resources.downloads) {
  if (guide.file) addCard(guide.resource_id, guide.title, 'caregiver-tools');
}

export function findResourceCard(id) {
  return cards.get(id);
}

export function publicResourceIds() {
  return [...cards.keys()].sort();
}
