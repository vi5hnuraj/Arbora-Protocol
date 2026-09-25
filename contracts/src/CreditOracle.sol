// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {OffchainAttestationRegistry} from "./OffchainAttestationRegistry.sol";

/// @title CreditOracle
/// @author Arbora Protocol
/// @notice Combines two independent risk signals into a single 0-100 composite credit score:
///         an onchain behavioural score pushed by the scoring pipeline, and an offchain
///         FICO-equivalent attestation.
/// @dev    The two signals measure *different* risk domains and are weighted asymmetrically:
///
///         - No attestation  -> `composite = onchain * onchainOnlyMultiplier / 100`
///           (capped by design: onchain activity alone can never reach top terms).
///         - With attestation -> `composite = min(100, offchain * offchainBaseline / 100
///                                                + onchain * onchainBoost / 100)`
///
///         Offchain attestation establishes the competitive baseline (proven real-world
///         creditworthiness); onchain behaviour boosts above it (DeFi-specific competence).
///         All three weights are owner-tunable and clamped to <= 100.
contract CreditOracle is Ownable {
    // --------------------------------------------------------------- types ---

    /// @notice Full credit profile for a wallet, assembled on read.
    struct CreditProfile {
        uint8 onchainScore; ///< Score pushed by the pipeline for this exact wallet.
        uint8 historicalOnchainScore; ///< Score used in the calculation (incl. inherited).
        uint8 offchainScore; ///< FICO mapped to 0-100.
        uint8 compositeScore; ///< Recomputed on every read.
        uint8 chainsUsed; ///< 1-5 chains covered by the underlying data.
        bool hasOffchainAttestation;
        bool isUsingInheritedScore; ///< True when the onchain score was inherited.
        uint256 lastUpdated;
    }

    // --------------------------------------------------------------- errors ---

    error ZeroRegistry();
    error ZeroWallet();
    error ScoreAboveLimit(uint256 score);
    error ChainsOutOfRange(uint256 chainsUsed);
    error MultiplierAboveLimit(uint256 value);

    // --------------------------------------------------------------- events ---

    event OnchainScoreSet(address indexed wallet, uint8 score, uint8 chainsUsed);
    event MultipliersUpdated(
        uint8 onchainOnlyMultiplier, uint8 offchainBaselineMultiplier, uint8 onchainBoostMultiplier
    );

    // -------------------------------------------------------------- constants ---

    /// @notice Lower bound of the FICO scale.
    uint16 public constant FICO_MIN = 300;
    /// @notice Upper bound of the FICO scale.
    uint16 public constant FICO_MAX = 850;

    // -------------------------------------------------------------- storage ---

    /// @notice Registry holding offchain attestations.
    OffchainAttestationRegistry public immutable registry;

    mapping(address => uint8) private _onchainScores;
    mapping(address => uint8) private _chainsUsed;
    mapping(address => uint256) private _lastUpdated;

    /// @notice Weight applied to the onchain score when no attestation exists (thin-file cap).
    uint8 public onchainOnlyMultiplier = 50;
    /// @notice Weight applied to the offchain score when an attestation exists.
    uint8 public offchainBaselineMultiplier = 70;
    /// @notice Weight applied to the onchain score when an attestation exists.
    uint8 public onchainBoostMultiplier = 40;

    // ---------------------------------------------------------- construction ---

    /// @param initialOwner Protocol admin (the scoring pipeline in production).
    /// @param _registry    Attestation registry this oracle reads from.
    constructor(address initialOwner, OffchainAttestationRegistry _registry) Ownable(initialOwner) {
        if (address(_registry) == address(0)) revert ZeroRegistry();
        registry = _registry;
    }

    // ------------------------------------------------------- admin functions ---

    /// @notice Publish a freshly computed onchain score for `wallet`.
    /// @dev When the wallet already has an attestation the identity's historical score is
    ///      updated as well, which keeps the record portable across future wallet changes.
    function setOnchainScore(address wallet, uint8 score, uint8 chainsUsed) external onlyOwner {
        if (wallet == address(0)) revert ZeroWallet();
        if (score > 100) revert ScoreAboveLimit(score);
        if (chainsUsed < 1 || chainsUsed > 5) revert ChainsOutOfRange(chainsUsed);

        _onchainScores[wallet] = score;
        _chainsUsed[wallet] = chainsUsed;
        _lastUpdated[wallet] = block.timestamp;

        emit OnchainScoreSet(wallet, score, chainsUsed);

        // History is written after the event so a re-entrant callback cannot reorder logs.
        if (registry.hasAttestation(wallet)) {
            bytes32 id = registry.getIdentityForWallet(wallet);
            if (id != bytes32(0)) registry.updateHistoricalScore(id, score);
        }
    }

    /// @notice Re-weight the composite formula. Each multiplier is capped at 100 so no single
    ///         signal can push the composite above 100 on its own in the attested branch.
    function setMultipliers(uint8 newOnchainOnly, uint8 newOffchainBaseline, uint8 newOnchainBoost)
        external
        onlyOwner
    {
        if (newOnchainOnly > 100) revert MultiplierAboveLimit(newOnchainOnly);
        if (newOffchainBaseline > 100) revert MultiplierAboveLimit(newOffchainBaseline);
        if (newOnchainBoost > 100) revert MultiplierAboveLimit(newOnchainBoost);

        onchainOnlyMultiplier = newOnchainOnly;
        offchainBaselineMultiplier = newOffchainBaseline;
        onchainBoostMultiplier = newOnchainBoost;

        emit MultipliersUpdated(newOnchainOnly, newOffchainBaseline, newOnchainBoost);
    }

    // --------------------------------------------------------------- views -----

    /// @notice Composite credit score (0-100) for `wallet`.
    function getCompositeScore(address wallet) public view returns (uint8) {
        (uint8 onchainForCalc,, bool hasAttest,) = _effectiveOnchainScore(wallet);

        if (!hasAttest) {
            // Onchain only: thin-file cap keeps the maximum composite at 50 with defaults.
            return uint8((uint256(onchainForCalc) * onchainOnlyMultiplier) / 100);
        }

        uint8 offchainScore = mapFicoToZero100(registry.getAttestation(wallet).ficoScore);
        uint256 baseline = (uint256(offchainScore) * offchainBaselineMultiplier) / 100;
        uint256 boost = (uint256(onchainForCalc) * onchainBoostMultiplier) / 100;
        uint256 total = baseline + boost;
        return total > 100 ? 100 : uint8(total);
    }

    /// @notice Full profile view, including how the composite was derived.
    function getFullProfile(address wallet) external view returns (CreditProfile memory) {
        (uint8 onchainForCalc, uint8 ownScore, bool hasAttest, bool usingInherited) =
            _effectiveOnchainScore(wallet);

        return CreditProfile({
            onchainScore: ownScore,
            historicalOnchainScore: onchainForCalc,
            offchainScore: hasAttest ? mapFicoToZero100(registry.getAttestation(wallet).ficoScore) : 0,
            compositeScore: getCompositeScore(wallet),
            chainsUsed: _chainsUsed[wallet],
            hasOffchainAttestation: hasAttest,
            isUsingInheritedScore: usingInherited,
            lastUpdated: _lastUpdated[wallet]
        });
    }

    /// @notice Linearly map a 300-850 FICO score onto the 0-100 scale, clamped at both ends.
    function mapFicoToZero100(uint16 fico) public pure returns (uint8) {
        if (fico <= FICO_MIN) return 0;
        if (fico >= FICO_MAX) return 100;
        return uint8((uint256(fico - FICO_MIN) * 100) / (FICO_MAX - FICO_MIN));
    }

    // -------------------------------------------------------------- internal ---

    /// @dev Resolve which onchain score should be used: the wallet's own score if it has one,
    ///      otherwise the identity's historical score (wallet migration case).
    function _effectiveOnchainScore(address wallet)
        internal
        view
        returns (uint8 onchainForCalc, uint8 ownScore, bool hasAttest, bool usingInherited)
    {
        ownScore = _onchainScores[wallet];
        hasAttest = registry.hasAttestation(wallet);
        onchainForCalc = ownScore;
        usingInherited = false;

        if (hasAttest && ownScore == 0) {
            bytes32 id = registry.getIdentityForWallet(wallet);
            if (id != bytes32(0)) {
                uint8 historical = registry.getHistoricalScore(id);
                if (historical > 0) {
                    onchainForCalc = historical;
                    usingInherited = true;
                }
            }
        }
    }
}
