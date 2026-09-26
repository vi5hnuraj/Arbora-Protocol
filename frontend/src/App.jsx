import { useState, useCallback } from 'react';
import './config/web3modal-setup.js'; // Initialize Web3Modal (must be imported before hooks)
import {
  Header,
  Hero,
  Section,
  Footer,
  NetworkBanner,
  ContractsNotice,
} from './components/layout/index.js';
import {
  WalletSearch,
  ScoringProgress,
  CompositeScore,
  ScoreComponents,
  FactorBreakdown,
  CreditReport,
} from './components/scoring/index.js';
import { AttestationSimulator } from './components/attestation/index.js';
import { LendingInterface } from './components/lending/index.js';
import useWallet from './hooks/useWallet.js';
import useContracts from './hooks/useContracts.js';
import {
  API_BASE,
  CONTRACTS_CONFIGURED,
  CONTRACTS_MISSING,
  explorerAddressUrl,
  explorerTxUrl,
} from './config/contract-addresses.js';
import { isCorrectChain } from './lib/network-switch.js';
import { toBool, toNum, structAt, shortHash, sendWalletTx, txError } from './lib/ethers-helpers.js';

const DEMO_WALLETS = [
  { addr: '0xa6292d924098f50eaa14f0bed07a9eef2ac82f91', label: 'Active borrower', chip: 'chip-accent' },
  { addr: '0xf7013afc2dee64b2c2225144d0ae7bcc99859c09', label: 'Liquidated borrower', chip: 'chip-negative' },
  { addr: '0x8d27f80d6a71e60759171147162c3740c0626d26', label: 'Thin file', chip: 'chip-warning' },
  { addr: '0x733f9320eec2001d6222674d18feabfa7254c78f', label: 'Crosschain user', chip: 'chip-info' },
  { addr: '0xcd0325be391d5c095735d0beae4abbea9498e0ea', label: 'Strong history', chip: 'chip-positive' },
];

export default function App() {
  const { account, chainId, isConnecting, connect, disconnect, walletProvider } = useWallet();
  const { pool, usdg, registry, readOracle, readPool, readRegistry, readUsdg } = useContracts(
    account,
    walletProvider,
    chainId,
  );

  // Network enforcement — everything is gated on Arbitrum Sepolia (421614)
  const wrongNetwork = Boolean(account) && !isCorrectChain(chainId);
  const canWrite = Boolean(account) && !wrongNetwork && CONTRACTS_CONFIGURED;
  const blockedReason = !account
    ? 'Connect a wallet to send transactions'
    : wrongNetwork
    ? 'Switch your wallet to Arbitrum Sepolia to send transactions'
    : !CONTRACTS_CONFIGURED
    ? 'Contracts not configured — deploy the contracts first (see README)'
    : null;

  // Scoring state
  const [isScoring, setIsScoring] = useState(false);
  const [scoreResult, setScoreResult] = useState(null);
  const [scoreError, setScoreError] = useState(null);
  const [searchedAddress, setSearchedAddress] = useState(null);
  const [runId, setRunId] = useState(0);

  // Credit report expansion state
  const [reportExpanded, setReportExpanded] = useState(false);

  // On-chain composite state (refreshed after scoring or attestation)
  const [compositeData, setCompositeData] = useState(null);

  const refreshComposite = useCallback(async (address) => {
    if (!address) return;

    // Primary: CreditOracle + LendingPool. Null when addresses are not
    // configured — the UI then falls back to the score API response.
    let data = null;
    if (readOracle && readPool) {
      try {
        const composite = await readOracle.getCompositeScore(address);
        const profile = await readOracle.getFullProfile(address);
        let ratioBps = Number(await readPool.getBorrowerCollateralRatioBps(address));
        if (!ratioBps) {
          // No open position: quote the score→ratio curve (as getRequiredCollateral does)
          ratioBps = Number(await readPool.getCollateralRatioBps(composite));
        }

        data = {
          compositeScore: Number(composite),
          onchainScore: Number(profile[0]),
          historicalOnchainScore: Number(profile[1]),
          offchainScore: Number(profile[2]),
          chainsUsed: Number(profile[4]),
          hasAttestation: Boolean(profile[5]),
          isUsingInheritedScore: Boolean(profile[6]),
          collateralRatioBps: Number(ratioBps),
        };
      } catch (err) {
        console.error('Failed to refresh composite:', err);
      }
    }

    // Fallback: read the attestation registry directly.
    if (!data && readRegistry) {
      try {
        const has = toBool(await readRegistry.hasAttestation(address));
        if (has) {
          const att = structAt(await readRegistry.getAttestation(address));
          data = {
            compositeScore: null,
            hasAttestation: true,
            offchainScore: toNum(att?.ficoScore) ?? 0,
          };
        } else {
          data = { compositeScore: null, hasAttestation: false };
        }
      } catch (err) {
        console.error('Failed to read attestation:', err);
      }
    }

    if (data) setCompositeData(data);
  }, [readOracle, readPool, readRegistry]);

  // Progress state for the chain map (real SSE events from backend)
  const [progress, setProgress] = useState({});

  // x402-style pay-per-score: set when the backend answers HTTP 402 for an
  // uncached wallet. `payment` carries the terms (0.01 USDG → treasury).
  const [paymentReq, setPaymentReq] = useState(null);
  const [paying, setPaying] = useState(false);

  const handleSearch = useCallback(async (address, payment = null) => {
    setIsScoring(true);
    setScoreResult(null);
    setScoreError(null);
    setSearchedAddress(address);
    setCompositeData(null);
    setProgress({});
    setReportExpanded(false);
    setPaymentReq(null);
    setRunId((n) => n + 1);

    const payBody = payment
      ? { payment_tx: payment.paymentTx, payer: payment.payer }
      : {};

    try {
      // Try SSE streaming endpoint first (real-time progress)
      let resp = await fetch(`${API_BASE}/score/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, ...payBody }),
      });

      // x402 — payment required: show the pay panel, don't score yet
      if (resp.status === 402) {
        const data = await resp.json().catch(() => ({}));
        setPaymentReq({ ...data, address });
        return;
      }

      // Fallback to JSON endpoint if streaming isn't available (old backend)
      if (resp.status === 404) {
        setProgress({ arbitrum_start: true, crosschain_start: true });
        resp = await fetch(`${API_BASE}/score`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, ...payBody }),
        });
        if (resp.status === 402) {
          const data = await resp.json().catch(() => ({}));
          setPaymentReq({ ...data, address });
          return;
        }
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        setScoreResult(data);
        setProgress({ arbitrum_start: true, arbitrum_done: true, crosschain_start: true, crosschain_done: true, model_done: true, push_done: true, result: true });
        if (data.data_source === 'live') {
          await refreshComposite(address);
        }
        return;
      }

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${resp.status}`);
      }

      // Read SSE stream for real-time progress
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            setProgress(prev => ({ ...prev, [event.event]: true, lastEvent: event }));

            if (event.event === 'error') {
              throw new Error(event.message);
            }

            if (event.event === 'result') {
              setScoreResult(event.data);
              // Only read from on-chain if the score was pushed (live scoring).
              // Cached results already include correct composite + collateral.
              if (event.data.data_source === 'live') {
                await refreshComposite(address);
              }
            }
          } catch (parseErr) {
            if (parseErr.message && !parseErr.message.includes('JSON')) {
              throw parseErr;
            }
          }
        }
      }
    } catch (err) {
      // Friendly message for cold-start / network errors (Render free tier sleeps after inactivity)
      const msg = err.message || '';
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('network') || msg === 'Not Found') {
        setScoreError('Backend is starting up (free tier cold start). Please wait 30-60 seconds and try again.');
      } else {
        setScoreError(msg);
      }
    } finally {
      setIsScoring(false);
    }
  }, [refreshComposite]);

  // x402 pay-per-score: one 0.01 USDG transfer unlocks the uncached query,
  // then the same search retries with the payment tx attached.
  const handlePayAndScore = useCallback(async () => {
    if (!paymentReq?.payment || !paymentReq?.address || !usdg || !account) return;
    setPaying(true);
    setScoreError(null);
    try {
      const p = paymentReq.payment;
      const tx = await sendWalletTx(usdg, 'transfer', [String(p.pay_to).toLowerCase(), p.price_atomic]);
      await tx.wait();
      setPaymentReq(null);
      await handleSearch(paymentReq.address, { paymentTx: tx.hash, payer: account });
    } catch (err) {
      setScoreError(txError(err, 'Payment failed — is your wallet on Arbitrum Sepolia with enough USDG?'));
    } finally {
      setPaying(false);
    }
  }, [paymentReq, usdg, account, handleSearch]);

  const handleAttestationSubmitted = useCallback(async () => {
    if (searchedAddress) {
      setTimeout(() => refreshComposite(searchedAddress), 2000);
    }
  }, [searchedAddress, refreshComposite]);

  // Reset to home screen
  const handleReset = useCallback(() => {
    setIsScoring(false);
    setScoreResult(null);
    setScoreError(null);
    setSearchedAddress(null);
    setCompositeData(null);
    setReportExpanded(false);
    setProgress({});
  }, []);

  const hasScore = scoreResult !== null;

  // Data source badge helper
  const dataSourceBadge = scoreResult?.data_source === 'live'
    ? { text: 'Live data', chip: 'chip-accent' }
    : scoreResult?.data_source === 'cached'
    ? { text: 'Demo: cached data', chip: 'chip-info' }
    : scoreResult?.data_source === 'synthetic'
    ? { text: 'Demo: synthetic profile', chip: 'chip-warning' }
    : null;

  return (
    <div className="flex min-h-screen flex-col bg-bg font-sans text-ink">
      <Header
        account={account}
        onConnect={connect}
        onDisconnect={disconnect}
        isConnecting={isConnecting}
        onReset={handleReset}
        wrongNetwork={wrongNetwork}
      />

      {/* Testnet strip */}
      <div className="bar bar-warning">
        <p>
          <span className="mr-1.5" aria-hidden="true">●</span>
          Testnet demo — smart contracts are unaudited · use only with Arbitrum
          Sepolia wallets · do not send real funds
        </p>
      </div>

      {/* Wrong-network banner (persistent while on the wrong chain) */}
      {wrongNetwork && (
        <NetworkBanner provider={walletProvider} chainId={chainId} />
      )}

      {/* Missing contract addresses */}
      {!CONTRACTS_CONFIGURED && <ContractsNotice missing={CONTRACTS_MISSING} />}

      <main className="flex-1">
        <Hero />

        <div className="mx-auto max-w-7xl px-5 sm:px-6">
          {/* 01 — SCORE */}
          <Section
            id="score"
            index="01"
            label="Score"
            title="Underwrite any wallet in one pass."
            deck="Paste an address or an ENS name — Arbora pulls lending history from five chains, runs the model, and writes the composite score onchain."
          >
            <div className="space-y-8">
              <WalletSearch
                onSearch={handleSearch}
                isLoading={isScoring}
                account={account}
                paymentReq={paymentReq}
                onPay={handlePayAndScore}
                paying={paying}
              />

              {/* Loading state: terminal-style step list */}
              <ScoringProgress key={runId} isActive={isScoring} progress={progress} />

              {/* Error state */}
              {scoreError && !isScoring && (
                <div className="mx-auto max-w-2xl">
                  <div className="rounded-[10px] border border-negative/30 bg-negative/10 px-4 py-3.5 text-center">
                    <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-negative">
                      Scoring failed
                    </p>
                    <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-ink-2">
                      {scoreError}
                    </p>
                  </div>
                </div>
              )}

              {/* Score dashboard */}
              {hasScore && !isScoring && (
                <div className="space-y-6">
                  {/* Address bar + data source badge */}
                  <div className="card p-0">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4 sm:px-6">
                      <span className="kicker">Wallet</span>
                      <span className="font-mono text-[13px] break-all text-ink">
                        {scoreResult.address}
                      </span>
                      <a
                        href={explorerAddressUrl(scoreResult.address)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="kicker transition-colors hover:text-ink"
                      >
                        Arbiscan ↗
                      </a>
                      {scoreResult.tx_hash && (
                        <a
                          href={explorerTxUrl(scoreResult.tx_hash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group inline-flex items-center gap-2"
                        >
                          <span className="kicker text-[10px]">Score tx</span>
                          <span className="font-mono text-[12px] text-ink-2 underline decoration-line underline-offset-4 transition-colors group-hover:text-ink">
                            {shortHash(scoreResult.tx_hash)}
                          </span>
                        </a>
                      )}
                      {dataSourceBadge && (
                        <span className={`chip ${dataSourceBadge.chip} ml-auto`}>
                          {dataSourceBadge.text}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Activity tier notice */}
                  {scoreResult.activity_note && scoreResult.activity_tier !== 'full_history' && (
                    <div
                      className={`rounded-[10px] border px-4 py-3 text-[13.5px] leading-relaxed ${
                        scoreResult.activity_tier === 'no_activity'
                          ? 'border-negative/30 bg-negative/10 text-negative'
                          : scoreResult.activity_tier === 'no_lending_history'
                          ? 'border-amber/30 bg-amber/10 text-amber'
                          : 'border-info/30 bg-info/10 text-info'
                      }`}
                    >
                      {scoreResult.activity_note}
                      {scoreResult.raw_model_score != null && scoreResult.raw_model_score !== scoreResult.credit_score && (
                        <span className="ml-2 text-ink-3">
                          (Raw model score: {scoreResult.raw_model_score}, adjusted to {scoreResult.credit_score})
                        </span>
                      )}
                    </div>
                  )}

                  {/* Gauge + inputs */}
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <CompositeScore
                      compositeScore={compositeData?.compositeScore ?? scoreResult.composite_score}
                      collateralRatioBps={compositeData?.collateralRatioBps ?? scoreResult.collateral_ratio_bps}
                    />

                    <ScoreComponents
                      onchainScore={scoreResult.credit_score}
                      chainsUsed={compositeData?.chainsUsed ?? scoreResult.chains_used}
                      dataCompleteness={scoreResult.data_completeness}
                      hasAttestation={compositeData?.hasAttestation ?? scoreResult.has_attestation ?? false}
                      offchainScore={compositeData?.offchainScore ?? scoreResult.offchain_score ?? 0}
                      isUsingInheritedScore={compositeData?.isUsingInheritedScore ?? false}
                    />
                  </div>

                  {/* Factor breakdown */}
                  <FactorBreakdown factors={scoreResult.factor_breakdown} />

                  {/* Full credit report (expandable) */}
                  <CreditReport
                    factors={scoreResult.factor_breakdown}
                    isExpanded={reportExpanded}
                    onToggle={() => setReportExpanded((prev) => !prev)}
                  />
                </div>
              )}

              {/* Empty state */}
              {!hasScore && !isScoring && !scoreError && (
                <div className="mx-auto max-w-2xl text-center">
                  <p className="text-[15px] leading-relaxed text-ink-2">
                    Enter any wallet address or ENS name above to generate a
                    real-time credit score based on onchain lending behavior
                    across 5 blockchains.
                  </p>

                  {/* Demo wallets — lower on the page, clearly separated */}
                  <div className="card mt-8 text-left">
                    <p className="kicker">Demo wallets · test phase only</p>
                    <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
                      Pre-scored wallets with cached results. Loads instantly.
                      Use the search bar above for live scoring.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {DEMO_WALLETS.map(({ addr, label, chip }) => (
                        <button
                          key={addr}
                          onClick={() => handleSearch(addr)}
                          className={`chip transition-colors hover:border-line-strong hover:text-ink ${chip}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Section>

          {/* 02 — LENDING */}
          <Section
            id="lending"
            index="02"
            label="Lending"
            title="A desk that prices itself."
            deck="Supply USDG, borrow against ETH collateral, and let the composite score set your ratio on a continuous curve — 150% for an unknown wallet, 75% for a proven one."
          >
            <div className="max-w-5xl">
              <LendingInterface
                pool={pool}
                usdg={usdg}
                readPool={readPool}
                readUsdg={readUsdg}
                walletAddress={account}
                compositeScore={compositeData?.compositeScore ?? scoreResult?.composite_score}
                canWrite={canWrite}
                blockedReason={blockedReason}
              />
            </div>
          </Section>

          {/* 03 — ATTESTATIONS */}
          <Section
            id="attestations"
            index="03"
            label="Attestations"
            title="Offchain proof, onchain record."
            deck="Publish a credit attestation to the registry and watch the composite re-weight — the second signal that unlocks undercollateralized terms."
          >
            <div className="max-w-3xl">
              <AttestationSimulator
                walletAddress={searchedAddress}
                registry={registry}
                readRegistry={readRegistry}
                onAttestationSubmitted={handleAttestationSubmitted}
                canWrite={canWrite}
                blockedReason={blockedReason}
                apiAttestation={{
                  has: compositeData?.hasAttestation ?? scoreResult?.has_attestation ?? false,
                  score: compositeData?.offchainScore ?? scoreResult?.offchain_score ?? 0,
                }}
              />
            </div>
          </Section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
