// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {CreditOracle} from "../src/CreditOracle.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {OffchainAttestationRegistry} from "../src/OffchainAttestationRegistry.sol";
import {AdminPriceOracle} from "../src/oracles/AdminPriceOracle.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";

/// @notice Shared fixture for every Arbora test suite.
/// @dev Deploys the full stack with a $2,000 ETH price and 6-decimal USDG (matching the
///      production token) and exposes helpers used across suites.
abstract contract ArboraTestBase is Test {
    address internal admin = address(0xA11CE);
    address internal alice = address(0xA1);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA10);
    address internal lp = address(0xBEEF);
    address internal liquidator = address(0xB01D);

    MockUSDG internal usdg;
    AdminPriceOracle internal priceOracle;
    OffchainAttestationRegistry internal registry;
    CreditOracle internal oracle;
    LendingPool internal pool;

    /// @dev ETH/USD used by every test unless overridden.
    uint256 internal constant ETH_PRICE = 2000e18;
    /// @dev USDG raw units for `n` whole dollars (6 decimals).
    uint256 internal constant USDG_UNIT = 1e6;

    function setUp() public virtual {
        _deployAll();
    }

    function _deployAll() internal {
        usdg = new MockUSDG();
        priceOracle = new AdminPriceOracle(admin, ETH_PRICE);
        registry = new OffchainAttestationRegistry(admin);
        oracle = new CreditOracle(admin, registry);
        pool = new LendingPool(admin, oracle, usdg, priceOracle);

        vm.prank(admin);
        registry.setCreditOracle(address(oracle));
    }

    // ------------------------------------------------------------- helpers ---

    /// @dev Build a valid attestation struct for `identityHash`.
    function _makeAttestation(bytes32 identityHash, uint16 ficoScore)
        internal
        pure
        returns (OffchainAttestationRegistry.OffchainAttestation memory)
    {
        return OffchainAttestationRegistry.OffchainAttestation({
            identityHash: identityHash,
            paymentHistoryScore: 85,
            creditUtilizationPct: 25,
            creditHistoryMonths: 60,
            numberOfAccounts: 5,
            hardInquiries: 1,
            ficoScore: ficoScore,
            isVerified: true,
            timestamp: 0
        });
    }

    /// @dev Publish an onchain score with the protocol's default weights.
    ///      composite = score * 50 / 100 (thin-file cap still applies).
    function _pushScore(address who, uint8 score) internal {
        vm.prank(admin);
        oracle.setOnchainScore(who, score, 5);
    }

    /// @dev Force a wallet's *onchain-only* composite to exactly `score` by neutralising
    ///      the thin-file multiplier. Wallet must not carry an attestation.
    function _seedCompositeScore(address who, uint8 score) internal {
        vm.startPrank(admin);
        oracle.setMultipliers(100, 70, 40);
        oracle.setOnchainScore(who, score, 5);
        vm.stopPrank();
    }

    /// @dev Mint `dollars` of testnet USDG to `to`.
    function _mintUsdg(address to, uint256 dollars) internal {
        usdg.mint(to, dollars * USDG_UNIT);
    }

    function _approveUsdg(address owner_, uint256 rawAmount) internal {
        vm.prank(owner_);
        usdg.approve(address(pool), rawAmount);
    }

    /// @dev Fund the pool with `dollars` of USDG liquidity from the LP.
    function _seedPool(uint256 dollars) internal {
        _mintUsdg(lp, dollars);
        vm.startPrank(lp);
        usdg.approve(address(pool), dollars * USDG_UNIT);
        pool.deposit(dollars * USDG_UNIT);
        vm.stopPrank();
    }

    /// @dev Publish a fresh ETH price as the pool owner.
    function _setEthPrice(uint256 priceUsd18) internal {
        vm.prank(admin);
        priceOracle.setPrice(priceUsd18);
    }
}
