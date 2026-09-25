// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title OffchainAttestationRegistry
/// @author Arbora Protocol
/// @notice Anchors offchain, ZK-style credit attestations (FICO-equivalent) to a persistent
///         `identityHash` so that credit history survives wallet changes.
/// @dev    Sybil resistance: an identity is bound to exactly one *current* wallet. When the
///         attestation is rebound to a new wallet the new wallet inherits the identity's
///         historical onchain score, so a borrower cannot escape a poor record by rotating
///         addresses. In production `setAttestation` is expected to be called by a ZK verifier
///         (Brevis / Primus) instead of an owner; the storage model is unchanged.
contract OffchainAttestationRegistry is Ownable {
    // ---------------------------------------------------------------- types ---

    /// @notice A verified offchain credit profile for a single identity.
    /// @param paymentHistoryScore   Onchain-normalised payment history (0-100).
    /// @param creditUtilizationPct  Credit utilisation (0-100, lower is better).
    /// @param creditHistoryMonths   Age of the oldest credit account, in months.
    /// @param numberOfAccounts      Number of open credit accounts.
    /// @param hardInquiries         Recent hard credit pulls (lower is better).
    /// @param ficoScore             Raw FICO-style score, 300-850.
    /// @param isVerified            True once a verifier (or demo admin) has validated it.
    /// @param timestamp             Block time of the write.
    struct OffchainAttestation {
        bytes32 identityHash;
        uint8 paymentHistoryScore;
        uint8 creditUtilizationPct;
        uint16 creditHistoryMonths;
        uint8 numberOfAccounts;
        uint8 hardInquiries;
        uint16 ficoScore;
        bool isVerified;
        uint256 timestamp;
    }

    // --------------------------------------------------------------- errors ---

    error ZeroAddress();
    error ZeroWallet();
    error ZeroIdentity();
    error OnlyOracle();
    error NoAttestation(address wallet);
    error ScoreAboveLimit(uint256 score);

    // --------------------------------------------------------------- events ---

    event AttestationSet(address indexed wallet, bytes32 indexed identityHash, uint16 ficoScore);
    event AttestationCleared(address indexed wallet, bytes32 indexed identityHash);
    event AttestationTransferred(
        address indexed oldWallet,
        address indexed newWallet,
        bytes32 indexed identityHash,
        uint8 inheritedOnchainScore
    );
    event HistoricalScoreUpdated(bytes32 indexed identityHash, uint8 newScore);
    event CreditOracleSet(address indexed oracle);

    // -------------------------------------------------------------- storage ---

    mapping(address => OffchainAttestation) private _attestations;
    mapping(address => bool) private _hasAttestation;
    /// @dev identity => most recent onchain score pushed while the identity was attested.
    mapping(bytes32 => uint8) private _historicalOnchainScores;
    mapping(bytes32 => address) private _identityToCurrentWallet;
    mapping(address => bytes32) private _walletToIdentity;

    /// @notice Oracle allowed to record historical onchain scores per identity.
    address public creditOracle;

    // ---------------------------------------------------------- construction ---

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ------------------------------------------------------- admin functions ---

    /// @notice Link the {CreditOracle}. Callable once by the owner.
    function setCreditOracle(address oracle) external onlyOwner {
        if (oracle == address(0)) revert ZeroAddress();
        if (creditOracle != address(0)) revert ZeroAddress();
        creditOracle = oracle;
        emit CreditOracleSet(oracle);
    }

    /// @notice Create or replace the attestation bound to `wallet`.
    /// @dev Rebinding an identity to a different wallet migrates the identity and its
    ///      inherited onchain score; the old wallet's record is deleted.
    function setAttestation(address wallet, OffchainAttestation calldata attestation) external onlyOwner {
        if (wallet == address(0)) revert ZeroWallet();
        if (attestation.identityHash == bytes32(0)) revert ZeroIdentity();

        bytes32 id = attestation.identityHash;
        address currentHolder = _identityToCurrentWallet[id];

        // Identity is moving from another wallet: migrate it and carry the record over.
        if (currentHolder != address(0) && currentHolder != wallet) {
            uint8 inheritedScore = _historicalOnchainScores[id];
            delete _attestations[currentHolder];
            _hasAttestation[currentHolder] = false;
            delete _walletToIdentity[currentHolder];
            emit AttestationTransferred(currentHolder, wallet, id, inheritedScore);
        }

        // Wallet is switching identity: drop the reverse link of the old identity.
        bytes32 previousId = _walletToIdentity[wallet];
        if (previousId != bytes32(0) && previousId != id && _identityToCurrentWallet[previousId] == wallet) {
            delete _identityToCurrentWallet[previousId];
        }

        OffchainAttestation storage stored = _attestations[wallet];
        stored.identityHash = id;
        stored.paymentHistoryScore = attestation.paymentHistoryScore;
        stored.creditUtilizationPct = attestation.creditUtilizationPct;
        stored.creditHistoryMonths = attestation.creditHistoryMonths;
        stored.numberOfAccounts = attestation.numberOfAccounts;
        stored.hardInquiries = attestation.hardInquiries;
        stored.ficoScore = attestation.ficoScore;
        stored.isVerified = attestation.isVerified;
        stored.timestamp = block.timestamp;

        _hasAttestation[wallet] = true;
        _identityToCurrentWallet[id] = wallet;
        _walletToIdentity[wallet] = id;

        emit AttestationSet(wallet, id, attestation.ficoScore);
    }

    /// @notice Remove `wallet`'s attestation. The identity's historical onchain score is
    ///         deliberately preserved so clearing an attestation does not erase credit history.
    function clearAttestation(address wallet) external onlyOwner {
        if (!_hasAttestation[wallet]) revert NoAttestation(wallet);
        bytes32 id = _walletToIdentity[wallet];

        delete _attestations[wallet];
        _hasAttestation[wallet] = false;
        delete _walletToIdentity[wallet];
        if (_identityToCurrentWallet[id] == wallet) delete _identityToCurrentWallet[id];

        emit AttestationCleared(wallet, id);
    }

    // ------------------------------------------------------- oracle functions ---

    /// @notice Record the latest onchain score for an identity. Restricted to the oracle.
    function updateHistoricalScore(bytes32 identityHash, uint8 score) external {
        if (msg.sender != creditOracle) revert OnlyOracle();
        if (identityHash == bytes32(0)) revert ZeroIdentity();
        if (score > 100) revert ScoreAboveLimit(score);

        _historicalOnchainScores[identityHash] = score;
        emit HistoricalScoreUpdated(identityHash, score);
    }

    // --------------------------------------------------------------- views -----

    function getAttestation(address wallet) external view returns (OffchainAttestation memory) {
        return _attestations[wallet];
    }

    function hasAttestation(address wallet) external view returns (bool) {
        return _hasAttestation[wallet];
    }

    function getHistoricalScore(bytes32 identityHash) external view returns (uint8) {
        return _historicalOnchainScores[identityHash];
    }

    function getIdentityForWallet(address wallet) external view returns (bytes32) {
        return _walletToIdentity[wallet];
    }

    function getWalletForIdentity(bytes32 identityHash) external view returns (address) {
        return _identityToCurrentWallet[identityHash];
    }
}
