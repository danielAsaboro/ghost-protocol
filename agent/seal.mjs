// Boneh-Franklin encryption to a NEAR MPC CKD identity.
// The owner seals with public values only. The matching key is `msk * H(mpk || app_id)`,
// which exists only once the vault contract asks the MPC network for it.
import crypto from 'node:crypto';
import { bls12_381 as bls } from '@noble/curves/bls12-381';
import { sha3_256 } from '@noble/hashes/sha3';

const DST = 'NEAR BLS12381G1_XMD:SHA-256_SSWU_RO_';
const APP_PREFIX = 'near-mpc v0.1.0 app_id derivation:';
const G1 = bls.G1.ProjectivePoint;
const G2 = bls.G2.ProjectivePoint;
const ORDER = bls.fields.Fr.ORDER;

export const appId = (account, path) => sha3_256(new TextEncoder().encode(`${APP_PREFIX}${account},${path}`));

export function identityPoint(mpk, id) {
  const input = new Uint8Array([...mpk, ...id]);
  return G1.fromAffine(bls.G1.hashToCurve(input, { DST }).toAffine());
}

const sharedKey = (gt) => crypto.createHash('sha256').update(bls.fields.Fp12.toBytes(gt)).digest();

export function sealToIdentity(mpkBytes, account, path, plaintext, randomScalar) {
  const identity = identityPoint(mpkBytes, appId(account, path));
  const r = randomScalar ?? (BigInt(`0x${crypto.randomBytes(48).toString('hex')}`) % (ORDER - 1n)) + 1n;
  const key = sharedKey(bls.pairing(identity, G2.fromHex(mpkBytes).multiply(r)));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(plaintext)), cipher.final()]);
  return {
    u: Buffer.from(G2.BASE.multiply(r).toRawBytes(true)).toString('hex'),
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: data.toString('hex'),
  };
}

/** Refuses any key that is not the genuine BLS signature on this identity. */
export function verifyIdentityKey(mpkBytes, account, path, keyBytes) {
  const identity = identityPoint(mpkBytes, appId(account, path));
  const sig = G1.fromHex(keyBytes);
  return bls.fields.Fp12.eql(bls.pairing(sig, G2.BASE), bls.pairing(identity, G2.fromHex(mpkBytes)));
}

export function openWithIdentityKey(mpkBytes, account, path, keyBytes, sealed) {
  if (!verifyIdentityKey(mpkBytes, account, path, keyBytes)) throw new Error('key does not match this identity');
  const key = sharedKey(bls.pairing(G1.fromHex(keyBytes), G2.fromHex(Buffer.from(sealed.u, 'hex'))));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'hex'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.data, 'hex')), decipher.final()]));
}

export const newAppKey = () => {
  const secret = (BigInt(`0x${crypto.randomBytes(48).toString('hex')}`) % (ORDER - 1n)) + 1n;
  return { secret, publicKey: G1.BASE.multiply(secret).toRawBytes(true) };
};

/** Unwraps a CKD response `(Y, C)` using the app's ephemeral secret. */
export const unwrapCkd = (bigY, bigC, secret) =>
  G1.fromHex(bigC).subtract(G1.fromHex(bigY).multiply(secret)).toRawBytes(true);
