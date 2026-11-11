#!/usr/bin/env node
// Waits for Sepolia ETH on a local testnet helper key, then bridges it to the vault on Base Sepolia.
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const VAULT = '0xAf8105c7e876f38Bf0A9f09e4c97029BCf74d0Cc';
const BRIDGE = '0xfd0Bf71F60660E2f608ed56e1659C450eB113120'; // Base Sepolia L1StandardBridge on Sepolia
const transport = http('https://ethereum-sepolia-rpc.publicnode.com');
const account = privateKeyToAccount(JSON.parse(readFileSync(new URL('../.ghost/bridge-helper.json', import.meta.url))).privateKey);
const pub = createPublicClient({ chain: sepolia, transport });
const wallet = createWalletClient({ account, chain: sepolia, transport });

let balance = 0n;
while ((balance = await pub.getBalance({ address: account.address })) < 3_000_000_000_000_000n) {
  await new Promise((r) => setTimeout(r, 20_000));
}
const fees = await pub.estimateFeesPerGas();
const gasCost = 300_000n * fees.maxFeePerGas;
const value = balance - gasCost;
console.log(`helper ${account.address} holds ${formatEther(balance)}; bridging ${formatEther(value)} to ${VAULT}`);
const hash = await wallet.writeContract({
  address: BRIDGE, abi: parseAbi(['function depositETHTo(address _to, uint32 _minGasLimit, bytes _extraData) payable']),
  functionName: 'depositETHTo', args: [VAULT, 200_000, '0x'], value, gas: 300_000n,
});
console.log(`https://sepolia.etherscan.io/tx/${hash}`);
const receipt = await pub.waitForTransactionReceipt({ hash });
console.log(`status ${receipt.status}`);
