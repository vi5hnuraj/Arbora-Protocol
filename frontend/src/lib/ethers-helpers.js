/**
 * Small ethers v6 helpers shared by the contract-driven panels.
 *
 * ethers v6 decodes single-output calls into a Result wrapper
 * (Result(1) [value]) and structs into nested Results — normalize those to
 * plain bigint / number / boolean before doing arithmetic or rendering.
 */
import { ethers } from 'ethers';
import { ARBITRUM_SEPOLIA_RPC } from '../config/contract-addresses.js';

export function toBig(value) {
  if (typeof value === 'bigint') return value;
  if (value == null) return null;
  const inner = value[0];
  if (typeof inner === 'bigint') return inner;
  if (typeof value === 'string' || typeof value === 'number') {
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }
  return null;
}

export function toNum(value) {
  const big = toBig(value);
  return big == null ? null : Number(big);
}

export function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (value != null && typeof value === 'object') return value[0] === true;
  return Boolean(value);
}

// Single-tuple outputs come back as Result([struct]).
export function structAt(value) {
  if (value == null) return null;
  const inner = value[0];
  if (inner !== null && typeof inner === 'object') return inner;
  return value;
}

export function fmtAmount(value, decimals = 18, dp = 4) {
  const big = toBig(value);
  if (big == null) return '--';
  try {
    const n = Number(ethers.formatUnits(big, decimals));
    if (!Number.isFinite(n)) return '--';
    if (n > 0 && n < 10 ** -dp) return `<${(10 ** -dp).toFixed(dp)}`;
    return n.toLocaleString('en-US', { maximumFractionDigits: dp });
  } catch {
    return '--';
  }
}

export function shortHash(hash) {
  if (!hash) return '';
  return hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

export function txError(err, fallback = 'Transaction failed') {
  if (err?.reason) return err.reason;
  const short = err?.shortMessage;
  // ethers collapses unrecognized wallet errors into "could not coalesce
  // error" — the wallet's real message is nested in info.
  const nested =
    err?.info?.error?.message ||
    err?.info?.error?.data?.originalError?.message ||
    err?.error?.message ||
    null;
  if (short && short !== 'could not coalesce error') return short;
  return nested || short || err?.message || fallback;
}

// Write through the wallet's raw eth_sendTransaction with only from/to/data —
// the wallet fills gas and fee fields itself, so site-suggested fees the
// wallet considers stale ("Invalid gas fee setting") can never block a tx.
// Receipts are awaited on the chain RPC, not the wallet, because wallets
// rate-limit background polling ("could not coalesce error").
// Returns { hash, wait }, the same shape ethers contract writes produce.
let receiptProvider = null;
export async function sendWalletTx(contract, fn, args = [], overrides = {}) {
  const runner = contract.runner;
  const from = await runner.getAddress();
  const provider = runner.provider;
  const data = contract.interface.encodeFunctionData(fn, args);
  const params = { from, to: contract.target, data };
  if (overrides.value != null) {
    params.value = '0x' + BigInt(overrides.value).toString(16);
  }
  const hash = await provider.send('eth_sendTransaction', [params]);
  if (!receiptProvider) {
    receiptProvider = new ethers.JsonRpcProvider(ARBITRUM_SEPOLIA_RPC);
  }
  return { hash, wait: () => receiptProvider.waitForTransaction(hash) };
}
