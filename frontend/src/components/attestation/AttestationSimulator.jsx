import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { toNum, toBool, structAt, shortHash, txError, sendWalletTx } from '../../lib/ethers-helpers.js';

const SLIDER_TRACK =
  'w-full h-1.5 rounded-full appearance-none cursor-pointer bg-line accent-accent';

function SliderField({ label, value, onChange, min, max, suffix = '', step = 1 }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label className="kicker">{label}</label>
        <span className="font-mono text-[13px] tabular-nums text-ink">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={SLIDER_TRACK}
      />
      <div className="flex justify-between font-mono text-[10px] tabular-nums text-ink-3">
        <span>
          {min}
          {suffix}
        </span>
        <span>
          {max}
          {suffix}
        </span>
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange, min = 0, max = 999, suffix = '' }) {
  return (
    <div className="space-y-1.5">
      <label className="kicker block">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value))))}
          className="field !h-9 !px-2.5 !text-[12px]"
        />
        {suffix && (
          <span className="whitespace-nowrap font-mono text-[10px] text-ink-3">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function RecordRow({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 last:border-b-0">
      <span className="kicker text-[10px]">{label}</span>
      <span className="font-mono text-[12px] tabular-nums text-ink">{value}</span>
    </div>
  );
}

export default function AttestationSimulator({
  walletAddress,
  registry,
  readRegistry,
  onAttestationSubmitted,
  canWrite = false,
  blockedReason = null,
  apiAttestation = null, // { has, score } — score API fallback when unconfigured
}) {
  const [compositeScore, setCompositeScore] = useState(700);
  const [paymentHistory, setPaymentHistory] = useState(85);
  const [creditUtil, setCreditUtil] = useState(25);
  const [historyMonths, setHistoryMonths] = useState(60);
  const [numAccounts, setNumAccounts] = useState(5);
  const [hardInquiries, setHardInquiries] = useState(1);
  const [identityLabel, setIdentityLabel] = useState('demo-identity-001');

  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState(null); // { type: 'success'|'error', message }

  // On-chain attestation record (OffchainAttestationRegistry ABI)
  const [record, setRecord] = useState({ key: null, data: null });
  const [reload, setReload] = useState(0);

  const identityHash = ethers.keccak256(ethers.toUtf8Bytes(identityLabel));

  // Read the attestation for the scored wallet. Falls back to score API data
  // (apiAttestation) when the registry address is unconfigured or the read
  // fails — never throws.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!readRegistry || !walletAddress) return;
      try {
        const has = toBool(await readRegistry.hasAttestation(walletAddress));
        let data = { has };
        if (has) {
          const att = structAt(await readRegistry.getAttestation(walletAddress));
          if (att) {
            data = {
              has: true,
              ficoScore: toNum(att.ficoScore),
              paymentHistory: toNum(att.paymentHistoryScore),
              creditUtil: toNum(att.creditUtilizationPct),
              historyMonths: toNum(att.creditHistoryMonths),
              verified: toBool(att.isVerified),
              timestamp: toNum(att.timestamp),
            };
          }
        }
        if (!cancelled) setRecord({ key: walletAddress.toLowerCase(), data });
      } catch (err) {
        console.error('registry read failed:', err?.message || err);
        if (!cancelled) {
          setRecord({ key: walletAddress.toLowerCase(), data: { has: false, readFailed: true } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readRegistry, walletAddress, reload]);

  const recordKey = walletAddress ? walletAddress.toLowerCase() : null;
  const onchainRecord = record.key === recordKey ? record.data : null;

  const writesLocked = !canWrite || !walletAddress;

  async function handleClear() {
    if (!registry || !walletAddress) return;
    if (!canWrite) {
      setFeedback({ type: 'error', message: blockedReason || 'Writes are disabled' });
      return;
    }
    setLoading(true);
    setFeedback(null);
    try {
      const tx = await sendWalletTx(registry, 'clearAttestation', [walletAddress]);
      setFeedback({ type: 'pending', message: `Clearing: ${shortHash(tx.hash)}` });
      await tx.wait();
      setFeedback({ type: 'success', message: 'Attestation cleared' });
      setReload((n) => n + 1);
      onAttestationSubmitted?.();
    } catch (err) {
      setFeedback({ type: 'error', message: txError(err) });
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (!registry || !walletAddress) return;
    if (!canWrite) {
      setFeedback({ type: 'error', message: blockedReason || 'Writes are disabled' });
      return;
    }
    setLoading(true);
    setFeedback(null);

    try {
      // Struct field names must match OffchainAttestationRegistry.Attestation:
      // identityHash, paymentHistoryScore, creditUtilizationPct,
      // creditHistoryMonths, numberOfAccounts, hardInquiries, ficoScore,
      // isVerified, timestamp
      const attestation = {
        identityHash,
        paymentHistoryScore: paymentHistory,
        creditUtilizationPct: creditUtil,
        creditHistoryMonths: historyMonths,
        numberOfAccounts: numAccounts,
        hardInquiries,
        ficoScore: compositeScore,
        isVerified: true,
        timestamp: 0,
      };

      const tx = await sendWalletTx(registry, 'setAttestation', [walletAddress, attestation]);
      setFeedback({ type: 'pending', message: `Tx submitted: ${shortHash(tx.hash)}` });
      await tx.wait();
      setFeedback({ type: 'success', message: 'Attestation recorded onchain' });
      setReload((n) => n + 1);
      onAttestationSubmitted?.();
    } catch (err) {
      setFeedback({ type: 'error', message: txError(err) });
    } finally {
      setLoading(false);
    }
  }

  // FICO color hint
  const ficoColor =
    compositeScore >= 740 ? 'text-positive' :
    compositeScore >= 670 ? 'text-amber' :
    'text-negative';

  const ficoDate =
    onchainRecord?.timestamp > 0
      ? new Date(onchainRecord.timestamp * 1000).toLocaleDateString()
      : null;

  const recordChip = onchainRecord?.has
    ? { label: 'Attested', cls: 'chip-accent' }
    : { label: 'None', cls: 'chip-neutral' };

  return (
    <div className="card p-0">
      {/* Header */}
      <div className="border-b border-line px-5 py-4 sm:px-6">
        <p className="kicker">Attestation layer</p>
        <h3 className="display mt-2 text-[24px] leading-tight">
          Offchain credit, published onchain.
        </h3>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">
          Simulates ZKredit — in production these come from ZK proofs.
        </p>
      </div>

      {/* On-chain record (or score API fallback) */}
      <div className="border-b border-line px-5 py-4 sm:px-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="kicker">
            Onchain record {walletAddress ? '' : '— connect / score a wallet'}
          </p>
          {walletAddress && onchainRecord && (
            <span className={`chip ${recordChip.cls}`}>{recordChip.label}</span>
          )}
        </div>

        {!walletAddress ? (
          <p className="text-[13px] text-ink-2">No wallet selected.</p>
        ) : onchainRecord == null && readRegistry ? (
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">
            Reading registry…
          </p>
        ) : onchainRecord == null || onchainRecord.readFailed ? (
          <div className="space-y-1 text-[13px]">
            <p className="text-ink-2">
              {onchainRecord?.readFailed
                ? 'Registry read failed — showing score API data:'
                : 'Registry not configured — showing score API data:'}
            </p>
            <p className={apiAttestation?.has ? 'text-positive' : 'text-amber'}>
              {apiAttestation?.has
                ? `Verified attestation (score ${apiAttestation.score ?? '--'}/100)`
                : 'No attestation recorded'}
            </p>
          </div>
        ) : onchainRecord.has ? (
          <div className="rounded-[10px] border border-line bg-surface-2 px-3.5 py-2">
            <RecordRow
              label="Status"
              value={onchainRecord.verified ? 'Verified ✓' : 'Unverified'}
            />
            <RecordRow label="FICO score" value={`${onchainRecord.ficoScore ?? '--'} / 850`} />
            <RecordRow
              label="Payment history"
              value={`${onchainRecord.paymentHistory ?? '--'}/100`}
            />
            <RecordRow label="Utilization" value={`${onchainRecord.creditUtil ?? '--'}%`} />
            <RecordRow label="History" value={`${onchainRecord.historyMonths ?? '--'} months`} />
            {ficoDate && <RecordRow label="Recorded" value={ficoDate} />}
          </div>
        ) : (
          <div className="space-y-1 text-[13px]">
            <p className="text-amber">No attestation recorded onchain.</p>
            {apiAttestation?.has && (
              <p className="text-ink-2">
                Score API reports a verified attestation (score{' '}
                {apiAttestation.score ?? '--'}/100) that has not been pushed to
                the registry yet.
              </p>
            )}
          </div>
        )}
      </div>

      {!registry ? (
        <div className="space-y-2 px-5 py-8 text-center sm:px-6">
          <p className="text-[14px] text-ink-2">
            {canWrite
              ? 'Registry not configured — deploy the contracts first (see README).'
              : 'Connect a wallet on Arbitrum Sepolia to submit attestations.'}
          </p>
          {writesLocked && blockedReason && (
            <p className="font-mono text-[11px] text-amber">{blockedReason}</p>
          )}
        </div>
      ) : (
        <div className="space-y-5 px-5 py-5 sm:px-6">
          {writesLocked && (
            <div className="rounded-[10px] border border-line bg-surface-2 px-3.5 py-2.5 text-[13px] text-ink-2">
              {blockedReason || 'Connect a wallet to submit attestations.'}
            </div>
          )}

          {/* FICO composite */}
          <SliderField
            label="Composite FICO Score"
            value={compositeScore}
            onChange={setCompositeScore}
            min={300}
            max={850}
          />
          <div className="-mt-2 flex items-center justify-center gap-2">
            <span className={`display text-[30px] leading-none tabular-nums ${ficoColor}`}>
              {compositeScore}
            </span>
            <span className="text-[13px] text-ink-2">
              {compositeScore >= 740 ? 'Excellent' :
               compositeScore >= 670 ? 'Good' :
               compositeScore >= 580 ? 'Fair' : 'Poor'}
            </span>
          </div>

          <div className="rule" />

          {/* Sub-factors */}
          <SliderField
            label="Payment History Score"
            value={paymentHistory}
            onChange={setPaymentHistory}
            min={0}
            max={100}
          />

          <SliderField
            label="Credit Utilization"
            value={creditUtil}
            onChange={setCreditUtil}
            min={0}
            max={100}
            suffix="%"
          />

          <div className="grid grid-cols-3 gap-3">
            <NumberField
              label="History (months)"
              value={historyMonths}
              onChange={setHistoryMonths}
              min={0}
              max={600}
            />
            <NumberField
              label="Accounts"
              value={numAccounts}
              onChange={setNumAccounts}
              min={0}
              max={255}
            />
            <NumberField
              label="Hard Inquiries"
              value={hardInquiries}
              onChange={setHardInquiries}
              min={0}
              max={255}
            />
          </div>

          <div className="rule" />

          {/* Identity hash */}
          <div className="space-y-2">
            <label className="kicker block">Identity hash label</label>
            <input
              type="text"
              value={identityLabel}
              onChange={(e) => setIdentityLabel(e.target.value)}
              className="field !h-10 !text-[12px]"
              placeholder="demo-identity-001"
            />
            <p className="break-all font-mono text-[10px] leading-relaxed text-ink-3">
              keccak256: {identityHash}
            </p>
          </div>

          {/* Submit */}
          <div className="space-y-2">
            <button
              onClick={handleSubmit}
              disabled={loading || writesLocked}
              className={`btn-primary w-full ${loading ? 'cursor-wait opacity-60' : ''}`}
            >
              {loading ? 'Confirming…' : 'Publish attestation'}
            </button>

            <button
              onClick={handleClear}
              disabled={loading || writesLocked}
              className="btn-secondary w-full !h-10 !text-[13px]"
            >
              Clear attestation
            </button>
          </div>

          {/* Feedback */}
          {feedback && (
            <div
              className={`break-words rounded-[10px] border px-3 py-2 font-mono text-[11px] ${
                feedback.type === 'success'
                  ? 'border-positive/30 bg-positive/10 text-positive'
                  : feedback.type === 'error'
                  ? 'border-negative/30 bg-negative/10 text-negative'
                  : 'border-amber/30 bg-amber/10 text-amber'
              }`}
            >
              {feedback.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
