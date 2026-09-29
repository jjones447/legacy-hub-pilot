// Audit attribution: people are recorded by email, Access service tokens by their common_name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getActor } from '../functions/_lib/actor.js';

function jwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256' })}.${b64(payload)}.sig`;
}
function req(token) {
  return { headers: { get: (n) => (n.toLowerCase() === 'cf-access-jwt-assertion' ? token : null) } };
}

test('a signed-in person is recorded by email', () => {
  assert.equal(getActor(req(jwt({ email: 'info@legacyhomehealthservices.org', sub: 'x' })), {}), 'info@legacyhomehealthservices.org');
});

test('a service token is recorded as service:<common_name>, not unknown_staff', () => {
  assert.equal(getActor(req(jwt({ common_name: 'abc123.access', sub: '' })), {}), 'service:abc123.access');
});

test('no token still reads as anonymous_staff', () => {
  assert.equal(getActor(req(null), {}), 'anonymous_staff');
});
