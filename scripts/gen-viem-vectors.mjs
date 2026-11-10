#!/usr/bin/env node
// Writes transaction encodings produced by viem for the contract's differential test.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { serializeTransaction } from 'viem';

let counter = 0n;
const rand = (bits) => {
  let out = 0n;
  for (let i = 0n; BigInt(i) * 256n < BigInt(bits) + 256n; i += 1n) {
    counter += 1n;
    const d = createHash('sha256').update(`ghost-${counter}`).digest('hex');
    out = (out << 256n) | BigInt(`0x${d}`);
  }
  const shift = counter % BigInt(bits);
  return (out & ((1n << BigInt(bits)) - 1n)) >> shift;
};
const hex = (n, bytes) => n.toString(16).padStart(bytes * 2, '0');
const vectors = [];
for (let i = 0; i < 1500; i += 1) {
  const fee = rand(128);
  const tx = {
    type: 'eip1559', chainId: Number(1n + rand(46)), nonce: Number(rand(50)),
    maxPriorityFeePerGas: rand(128) % (fee + 1n), maxFeePerGas: fee, gas: rand(50) + 21000n,
    to: `0x${hex(rand(160), 20)}`, value: rand(128),
  };
  const r = rand(256) | 1n;
  const s = rand(255) | 1n;
  const y = Number(counter % 2n);
  const preimage = serializeTransaction(tx);
  const signed = serializeTransaction(tx, { r: `0x${hex(r, 32)}`, s: `0x${hex(s, 32)}`, yParity: y });
  vectors.push({
    chainId: String(tx.chainId), nonce: String(tx.nonce), priority: String(tx.maxPriorityFeePerGas), fee: String(tx.maxFeePerGas),
    gas: String(tx.gas), to: tx.to.slice(2), value: String(tx.value), r: hex(r, 32), s: hex(s, 32), y,
    preimage: preimage.slice(2), signed: signed.slice(2),
  });
}
writeFileSync(new URL('../contract/testdata/viem_vectors.json', import.meta.url), JSON.stringify(vectors));
console.log(`${vectors.length} vectors`);
