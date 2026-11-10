import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import test from 'node:test';
import { bls12_381 as bls } from '@noble/curves/bls12-381';
import { appId, identityPoint, newAppKey, openWithIdentityKey, sealToIdentity, unwrapCkd, verifyIdentityKey } from '../agent/seal.mjs';

const G1 = bls.G1.ProjectivePoint;
const G2 = bls.G2.ProjectivePoint;
const msk = 0x1234567890abcdefn;
const mpk = G2.BASE.multiply(msk).toRawBytes(true);
const ACCOUNT = 'vault.testnet';
const PATH = 'ghost-wishes-1';
const identity = identityPoint(mpk, appId(ACCOUNT, PATH));
const key = identity.multiply(msk).toRawBytes(true);

test('sealed before the key exists, opened with the derived key', () => {
  const sealed = sealToIdentity(mpk, ACCOUNT, PATH, 'wait for Ada');
  assert.equal(openWithIdentityKey(mpk, ACCOUNT, PATH, key, sealed), 'wait for Ada');
});

test('a key for another account cannot open it', () => {
  const sealed = sealToIdentity(mpk, ACCOUNT, PATH, 'x');
  const other = identityPoint(mpk, appId('other.testnet', PATH)).multiply(msk).toRawBytes(true);
  assert.equal(verifyIdentityKey(mpk, ACCOUNT, PATH, other), false);
  assert.throws(() => openWithIdentityKey(mpk, ACCOUNT, PATH, other, sealed), /does not match/);
});

test('a CKD response unwraps with the app secret and verifies', () => {
  const app = newAppKey();
  const y = 987654321n;
  const bigY = G1.BASE.multiply(y).toRawBytes(true);
  const bigC = identity.multiply(msk).add(G1.BASE.multiply(y).multiply(app.secret)).toRawBytes(true);
  assert.equal(verifyIdentityKey(mpk, ACCOUNT, PATH, unwrapCkd(bigY, bigC, app.secret)), true);
});

test('writes the hash-to-curve vector for the blstrs differential test', () => {
  const hex = (b) => Buffer.from(b).toString('hex');
  writeFileSync(new URL('../contract/testdata/ckd_vector.json', import.meta.url), JSON.stringify({
    mpk: hex(mpk), app_id: hex(appId(ACCOUNT, PATH)), point: hex(identity.toRawBytes(false)),
  }));
});
