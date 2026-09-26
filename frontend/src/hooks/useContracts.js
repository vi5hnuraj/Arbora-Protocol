import { useMemo, useState, useEffect } from 'react';
import { ethers } from 'ethers';
import CreditOracleABI from '../contracts/CreditOracle.json';
import LendingPoolABI from '../contracts/LendingPool.json';
import OffchainAttestationRegistryABI from '../contracts/OffchainAttestationRegistry.json';
import MockUSDGABI from '../contracts/MockUSDG.json';
import { CONTRACTS, CONTRACTS_CONFIGURED, ARBITRUM_SEPOLIA_RPC } from '../config/contract-addresses.js';
import { isCorrectChain } from '../lib/network-switch.js';

const EMPTY_WRITES = { oracle: null, pool: null, registry: null, usdg: null, signer: null };

// null instead of a throw when the address is not configured
function makeContract(address, abi, runner) {
  return address ? new ethers.Contract(address, abi, runner) : null;
}

/**
 * React hook that creates ethers.js v6 Contract instances for the Arbora
 * Protocol contracts (CreditOracle, LendingPool, OffchainAttestationRegistry,
 * USDG token) on Arbitrum Sepolia.
 *
 * - Read-only instances are available whenever an address is configured
 *   (via the public Sepolia RPC). Unconfigured addresses yield `null`
 *   instead of throwing, so the app renders without deployments.
 * - Signer-connected (write) instances are only created when a wallet is
 *   connected AND on chain 421614, so no write call can be signed for the
 *   wrong network.
 */
export default function useContracts(account, walletProvider, chainId) {
  const readProvider = useMemo(
    () => new ethers.JsonRpcProvider(ARBITRUM_SEPOLIA_RPC),
    [],
  );

  // Read-only contract instances (null when the address is not configured)
  const readOracle = useMemo(
    () => makeContract(CONTRACTS.oracle, CreditOracleABI.abi, readProvider),
    [readProvider],
  );
  const readPool = useMemo(
    () => makeContract(CONTRACTS.pool, LendingPoolABI.abi, readProvider),
    [readProvider],
  );
  const readRegistry = useMemo(
    () => makeContract(CONTRACTS.registry, OffchainAttestationRegistryABI.abi, readProvider),
    [readProvider],
  );
  const readUsdg = useMemo(
    () => makeContract(CONTRACTS.usdg, MockUSDGABI.abi, readProvider),
    [readProvider],
  );

  // Write instances are keyed by the connected wallet on the right chain.
  // When the key does not match (disconnect / wrong network) the render-time
  // derivation below yields EMPTY_WRITES — no stale signer can be used.
  const writeKey =
    account && walletProvider && isCorrectChain(chainId)
      ? account.toLowerCase()
      : null;

  const [resolved, setResolved] = useState({ key: null, value: EMPTY_WRITES });

  useEffect(() => {
    if (!writeKey || !walletProvider) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const browserProvider = new ethers.BrowserProvider(walletProvider);
        const signer = await browserProvider.getSigner();
        if (cancelled) return;
        setResolved({
          key: writeKey,
          value: {
            signer,
            oracle: makeContract(CONTRACTS.oracle, CreditOracleABI.abi, signer),
            pool: makeContract(CONTRACTS.pool, LendingPoolABI.abi, signer),
            registry: makeContract(CONTRACTS.registry, OffchainAttestationRegistryABI.abi, signer),
            usdg: makeContract(CONTRACTS.usdg, MockUSDGABI.abi, signer),
          },
        });
      } catch (err) {
        // No state update here: a key mismatch keeps EMPTY_WRITES active.
        console.error('Failed to get signer:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [writeKey, walletProvider]);

  const writes = resolved.key === writeKey ? resolved.value : EMPTY_WRITES;

  return {
    oracle: writes.oracle,
    pool: writes.pool,
    registry: writes.registry,
    usdg: writes.usdg,
    signer: writes.signer,
    readOracle,
    readPool,
    readRegistry,
    readUsdg,
    readProvider,
    configured: CONTRACTS_CONFIGURED,
  };
}
