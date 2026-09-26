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

  // Wallet signature: the attester signs the exact payload
  // with personal_sign before it can be published. `signedIssued` is the
  // timestamp embedded in the signed message; any form change invalidates it.
  const [signature, setSignature] = useState(null);
  const [signedMessage, setSignedMessage] = useState(null);
  const [signedIssued, setSignedIssued] = useState(null);
  const [attester, setAttester] = useState(null);
  const [signing, setSigning] = useState(false);

  // Receipt verifier: paste an exported receipt → re-check format,
  // signature recovery, identity-hash derivation, and (when possible) the
  // onchain record for the subject wallet.
  const [receiptInput, setReceiptInput] = useState('');
  const [receiptResult, setReceiptResult] = useState(null); // { ok, lines[] }
  const [verifyingReceipt, setVerifyingReceipt] = useState(false);

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

  // Canonical, human-readable attestation message. Same form fields feed the
  // signature and the onchain struct, so a signed message always describes
  // exactly what is published.
  function buildMessage(issued) {
    return [
      'Arbora Protocol — Offchain Credit Attestation',
      'chain: Arbitrum Sepolia (421614)',
      `registry: ${registry?.target ?? 'unconfigured'}`,
      `subject wallet: ${walletAddress ?? '—'}`,
      `identity label: ${identityLabel}`,
      `identity hash: ${identityHash}`,
      `fico score: ${compositeScore} / 850`,
      `payment history: ${paymentHistory} / 100`,
      `credit utilization: ${creditUtil}%`,
      `credit history: ${historyMonths} months`,
      `accounts: ${numAccounts}`,
      `hard inquiries: ${hardInquiries}`,
      `issued: ${issued}`,
    ].join('\n');
  }

  const currentIssued = signedIssued;
  const isSigned =
    Boolean(signature && signedMessage && signedIssued) &&
    signedMessage === buildMessage(currentIssued);
  const signatureStale = Boolean(signature) && !isSigned;

  async function handleSign() {
    if (!registry || !walletAddress || !canWrite) return;
    setSigning(true);
    setFeedback(null);
    try {
      const issued = new Date().toISOString();
      const message = buildMessage(issued);
      const attester = await registry.runner.getAddress();
      const sig = await registry.runner.signMessage(message);
      const recovered = ethers.verifyMessage(message, sig);
      if (recovered.toLowerCase() !== attester.toLowerCase()) {
        throw new Error('Signature recovery mismatch');
      }
      setSignature(sig);
      setSignedMessage(message);
      setSignedIssued(issued);
      setAttester(attester);
      setFeedback({ type: 'success', message: `Signature verified ✓ — signed by ${attester.slice(0, 6)}…${attester.slice(-4)}` });
    } catch (err) {
      setFeedback({ type: 'error', message: txError(err, 'Signing failed') });
    } finally {
      setSigning(false);
    }
  }

  function handleExportReceipt() {
    if (!signature || !signedMessage) return;
    const receipt = {
      format: 'arbora-attestation-receipt',
      version: 1,
      algorithm: 'EIP-191 personal_sign (keccak256 identity hash)',
      chain: { name: 'Arbitrum Sepolia', chainId: 421614 },
      registry: registry?.target ?? null,
      subject: walletAddress,
      attester: null,
      attestation: {
        identityLabel,
        identityHash,
        ficoScore: compositeScore,
        paymentHistoryScore: paymentHistory,
        creditUtilizationPct: creditUtil,
        creditHistoryMonths: historyMonths,
        numberOfAccounts: numAccounts,
        hardInquiries,
      },
      message: signedMessage,
      signature,
      issued: signedIssued,
    };
    ethers
      .verifyMessage(signedMessage, signature)
      .then((recovered) => {
        receipt.attester = recovered;
        const blob = new Blob([JSON.stringify(receipt, null, 2)], {
          type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `arbora-attestation-${(walletAddress ?? 'wallet').slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => {});
  }

  async function handleVerifyReceipt() {
    setVerifyingReceipt(true);
    setReceiptResult(null);
    const lines = [];
    try {
      const r = JSON.parse(receiptInput);
      const okFormat = r.format === 'arbora-attestation-receipt';
      lines.push({
        label: 'Receipt format',
        ok: okFormat,
        text: okFormat ? `arbora-attestation-receipt v${r.version ?? '?'}` : `unexpected: ${r.format}`,
      });
      if (!okFormat) throw new Error('not an arbora receipt');

      let recovered = null;
      try {
        recovered = ethers.verifyMessage(r.message, r.signature);
      } catch {
        recovered = null;
      }
      const sigOk = Boolean(recovered) && recovered.toLowerCase() === String(r.attester).toLowerCase();
      lines.push({
        label: 'Signature (ecrecover)',
        ok: sigOk,
        text: sigOk ? `recovers to ${recovered.slice(0, 10)}…${recovered.slice(-6)}` : 'recovery failed or attester mismatch',
      });

      const recomputed = ethers.keccak256(ethers.toUtf8Bytes(r.attestation?.identityLabel ?? ''));
      const hashInMsg = typeof r.message === 'string' && r.message.includes(`identity hash: ${recomputed}`);
      lines.push({
        label: 'Identity hash derivation',
        ok: hashInMsg,
        text: hashInMsg ? `keccak256(label) matches message ✓` : 'message does not embed keccak256(label)',
      });

      const subjectInMsg =
        typeof r.message === 'string' && r.subject &&
        r.message.includes(`subject wallet: ${r.subject}`);
      lines.push({
        label: 'Subject wallet bound',
        ok: Boolean(subjectInMsg),
        text: subjectInMsg ? r.subject : 'subject not found in signed message',
      });

      // Onchain cross-check when the registry is configured
      if (readRegistry && r.subject) {
        try {
          const has = toBool(await readRegistry.hasAttestation(r.subject));
          if (has) {
            const att = structAt(await readRegistry.getAttestation(r.subject));
            const chainFico = att ? toNum(att.ficoScore) : null;
            const match = chainFico !== null && chainFico === r.attestation?.ficoScore;
            lines.push({
              label: 'Onchain record',
              ok: match,
              text: match
                ? `FICO ${chainFico} matches receipt ✓`
                : `onchain FICO ${chainFico ?? '--'} ≠ receipt ${r.attestation?.ficoScore ?? '--'}`,
            });
          } else {
            lines.push({
              label: 'Onchain record',
              ok: false,
              text: 'subject has no onchain attestation',
            });
          }
        } catch {
          lines.push({ label: 'Onchain record', ok: false, text: 'registry read failed' });
        }
      }

      setReceiptResult({ ok: lines.every((l) => l.ok), lines });
    } catch (err) {
      setReceiptResult({
        ok: false,
        lines: [...lines, { label: 'Parse', ok: false, text: err.message || 'invalid JSON' }],
      });
    } finally {
      setVerifyingReceipt(false);
    }
  }

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
      setSignature(null);
      setSignedMessage(null);
      setSignedIssued(null);
      setAttester(null);
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
    if (!isSigned) {
      setFeedback({
        type: 'error',
        message: signatureStale
          ? 'Form changed after signing — sign the attestation again'
          : 'Sign the attestation first (Step 1)',
      });
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
          Every attestation is wallet-signed before it is published — in
          production a ZK verifier would check the same payload.
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

          {/* Step 1 — wallet signature */}
          <div className="space-y-3">
            <div className="rule" />
            <div>
              <p className="kicker">Step 1 — Wallet signature</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
                The attester signs the exact payload in MetaMask before anything
                is published — the receipt below proves who approved these values.
              </p>
            </div>

            <button
              onClick={handleSign}
              disabled={signing || writesLocked}
              className={`btn-secondary w-full !h-10 !text-[13px] ${signing ? 'cursor-wait opacity-60' : ''}`}
            >
              {signing
                ? 'Waiting for signature…'
                : signature && !signatureStale
                ? 'Re-sign attestation'
                : 'Sign attestation (MetaMask)'}
            </button>

            {signature && (
              <div className="space-y-2 rounded-[10px] border border-positive/30 bg-positive/5 px-3.5 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="kicker text-[10px]">Signature</span>
                  <span className="chip chip-accent">
                    {isSigned ? '✓ verified' : 're-sign required'}
                  </span>
                </div>
                <RecordRow
                  label="Attester"
                  value={attester ? `${attester.slice(0, 10)}…${attester.slice(-6)}` : '—'}
                />
                <p className="break-all font-mono text-[10px] leading-relaxed text-ink-3">
                  {signature}
                </p>
                <p className="font-mono text-[10px] text-ink-3">
                  ecrecover: {isSigned ? 'matches signer ✓' : 'stale — form changed'}
                </p>
                <button
                  onClick={handleExportReceipt}
                  className="w-full rounded-[8px] border border-line bg-surface-2 py-1.5 font-mono text-[11px] text-ink-2 hover:text-ink"
                >
                  Export signed receipt (JSON)
                </button>
              </div>
            )}

            {/* Receipt verifier */}
            <div className="space-y-2 rounded-[10px] border border-line bg-surface-2 px-3.5 py-2.5">
              <span className="kicker text-[10px]">Verify an exported receipt</span>
              <textarea
                value={receiptInput}
                onChange={(e) => setReceiptInput(e.target.value)}
                rows={3}
                placeholder='{"format":"arbora-attestation-receipt", …}'
                className="field !h-auto !resize-none !px-2.5 !py-2 !text-[10px] font-mono"
              />
              <button
                onClick={handleVerifyReceipt}
                disabled={verifyingReceipt || !receiptInput.trim()}
                className="w-full rounded-[8px] border border-line bg-surface px-3 py-1.5 font-mono text-[11px] text-ink-2 hover:text-ink disabled:opacity-50"
              >
                {verifyingReceipt ? 'Verifying…' : 'Verify receipt'}
              </button>
              {receiptResult && (
                <div className="space-y-1">
                  <span className={`chip ${receiptResult.ok ? 'chip-accent' : 'chip-negative'}`}>
                    {receiptResult.ok ? '✓ receipt verified' : '✗ verification failed'}
                  </span>
                  {receiptResult.lines.map((l) => (
                    <p
                      key={l.label}
                      className={`break-all font-mono text-[10px] leading-relaxed ${
                        l.ok ? 'text-positive' : 'text-negative'
                      }`}
                    >
                      {l.ok ? '✓' : '✗'} {l.label}: {l.text}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Step 2 — publish */}
          <div className="space-y-2">
            <p className="kicker">Step 2 — Publish onchain</p>
            <button
              onClick={handleSubmit}
              disabled={loading || writesLocked || !isSigned}
              className={`btn-primary w-full ${loading ? 'cursor-wait opacity-60' : ''} ${
                !isSigned ? 'cursor-not-allowed opacity-40' : ''
              }`}
            >
              {loading
                ? 'Confirming…'
                : !isSigned
                ? signatureStale
                  ? 'Sign again to publish'
                  : 'Sign first to enable publishing'
                : 'Publish attestation'}
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
