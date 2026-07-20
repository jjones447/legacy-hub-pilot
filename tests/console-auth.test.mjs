// Slice SEC (console) — CF Access JWT verification unit tests.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAccessJwt } from '../functions/_middleware.js';

const enc = new TextEncoder();
const TEAM = 'legacy.cloudflareaccess.com';
const ISS = `https://${TEAM}`;
const AUD = 'test_aud_tag';

function b64url(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64urlJson = (o) => b64url(enc.encode(JSON.stringify(o)));

let keyPair, jwk, fetchImpl;

async function makeJwt({ kid = 'k1', aud = AUD, iss = ISS, exp = Math.floor(Date.now() / 1000) + 3600, email = 'jane@legacy.org', signKey } = {}) {
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const payload = { aud, iss, exp, email };
  const input = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', (signKey || keyPair).privateKey, enc.encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

before(async () => {
  keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify']
  );
  jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  jwk.kid = 'k1';
  fetchImpl = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
});

const opts = () => ({ teamDomain: TEAM, aud: AUD, fetchImpl });

test('valid CF Access JWT verifies and returns the payload', async () => {
  const token = await makeJwt();
  const payload = await verifyAccessJwt(token, opts());
  assert.ok(payload, 'should verify');
  assert.equal(payload.email, 'jane@legacy.org');
});

test('tampered signature is rejected', async () => {
  let token = await makeJwt();
  token = token.slice(0, -3) + (token.slice(-3) === 'AAA' ? 'BBB' : 'AAA'); // mutate the sig
  assert.equal(await verifyAccessJwt(token, opts()), null);
});

test('wrong audience is rejected', async () => {
  const token = await makeJwt({ aud: 'some_other_app' });
  assert.equal(await verifyAccessJwt(token, opts()), null);
});

test('expired token is rejected', async () => {
  const token = await makeJwt({ exp: Math.floor(Date.now() / 1000) - 60 });
  assert.equal(await verifyAccessJwt(token, opts()), null);
});

test('wrong issuer is rejected', async () => {
  const token = await makeJwt({ iss: 'https://evil.cloudflareaccess.com' });
  assert.equal(await verifyAccessJwt(token, opts()), null);
});

test('unknown signing key (kid) is rejected', async () => {
  const token = await makeJwt({ kid: 'not-a-real-kid' });
  assert.equal(await verifyAccessJwt(token, opts()), null);
});

test('token signed by a DIFFERENT key is rejected (forgery)', async () => {
  const attacker = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify']
  );
  // attacker signs a token but keeps kid=k1 so JWKS lookup finds the REAL key
  const token = await makeJwt({ signKey: attacker });
  assert.equal(await verifyAccessJwt(token, opts()), null);
});

test('garbage / missing token is rejected', async () => {
  assert.equal(await verifyAccessJwt('', opts()), null);
  assert.equal(await verifyAccessJwt('not.a.jwt', opts()), null);
  assert.equal(await verifyAccessJwt(null, opts()), null);
});
