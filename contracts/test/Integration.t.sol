// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ArboraTestBase} from "./TestHelpers.sol";
import {CreditOracle} from "../src/CreditOracle.sol";
import {LendingPool} from "../src/LendingPool.sol";

/// @notice End-to-end narrative: the same beats as the product demo, expressed against
///         the USDG lending pool.
contract IntegrationTest is ArboraTestBase {
    bytes32 internal constant ALICE_ID = keccak256("arbora-demo-identity-001");

    event Borrowed(
        address indexed borrower,
        uint256 debtUsdg,
        uint256 collateralWei,
        uint16 loanRatioBps,
        uint8 compositeScore
    );

    function test_Beat1_OnchainOnlyBorrowerIsOvercollateralised() public {
        _seedPool(100_000);
        vm.prank(admin);
        oracle.setOnchainScore(alice, 98, 5);

        assertEq(oracle.getCompositeScore(alice), 49, "thin-file cap: 98 * 50 / 100");
        assertEq(pool.getCollateralRatioBps(49), 12_100);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        pool.borrow{value: 0.7 ether}(1_000 * USDG_UNIT);

        // 1210 USD required vs 1400 USD posted -> overcollateralised, terms unattractive.
        assertEq(pool.getBorrowerCollateralRatioBps(alice), 12_100);
        assertEq(pool.healthFactorBps(alice), 11_570);
    }

    function test_Beat2_OffchainAttestationUnlocksUndercollateralisedTerms() public {
        _seedPool(100_000);
        vm.startPrank(admin);
        oracle.setOnchainScore(alice, 98, 5);
        // FICO 780 -> offchain 87 -> baseline 60 + boost 39 = 99
        registry.setAttestation(alice, _makeAttestation(ALICE_ID, 780));
        oracle.setOnchainScore(alice, 98, 5); // re-push seeds the identity history
        vm.stopPrank();

        assertEq(oracle.getCompositeScore(alice), 99);
        assertEq(pool.getCollateralRatioBps(99), 7_567);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        pool.borrow{value: 0.7 ether}(1_000 * USDG_UNIT);

        // 756.7 USD required vs 1400 USD posted: capital efficiency for the same wallet.
        assertEq(pool.getBorrowerCollateralRatioBps(alice), 7_567);
        assertGt(pool.healthFactorBps(alice), 18_000);
        assertEq(usdg.balanceOf(alice), 1_000 * USDG_UNIT, "loan disbursed in USDG");
    }

    function test_Beat3_SybilRebindInheritsCreditHistory() public {
        vm.startPrank(admin);
        registry.setAttestation(alice, _makeAttestation(ALICE_ID, 780));
        oracle.setOnchainScore(alice, 98, 5);
        // Rotate the identity to a brand new wallet: bob inherits alice's record.
        registry.setAttestation(bob, _makeAttestation(ALICE_ID, 780));
        vm.stopPrank();

        CreditOracle.CreditProfile memory profile = oracle.getFullProfile(bob);
        assertTrue(profile.isUsingInheritedScore);
        assertEq(profile.historicalOnchainScore, 98);
        assertEq(profile.onchainScore, 0, "bob has no score of his own");
        assertEq(oracle.getCompositeScore(bob), 99);

        // Bob gets the same terms without ever having transacted himself.
        _seedPool(100_000);
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        pool.borrow{value: 0.4 ether}(1_000 * USDG_UNIT);
        assertEq(pool.getBorrowerCollateralRatioBps(bob), 7_567);
    }

    function test_Beat4_RiskyBorrowerPaysMore() public {
        _seedPool(100_000);
        vm.startPrank(admin);
        registry.setAttestation(carol, _makeAttestation(keccak256("risky"), 650));
        oracle.setOnchainScore(carol, 3, 1);
        vm.stopPrank();

        // FICO 650 -> 63 -> 44 + 1 = 45
        assertEq(oracle.getCompositeScore(carol), 45);
        assertEq(pool.getCollateralRatioBps(45), 12_500);

        vm.deal(carol, 1 ether);
        vm.prank(carol);
        pool.borrow{value: 0.75 ether}(1_000 * USDG_UNIT);
        assertEq(pool.getBorrowerCollateralRatioBps(carol), 12_500);
    }

    function test_Beat5_FreshWalletGetsWorstTerms() public {
        assertEq(oracle.getCompositeScore(bob), 0);
        assertEq(pool.getCollateralRatioBps(0), 15_000);

        _seedPool(100_000);
        vm.deal(bob, 2 ether);
        vm.prank(bob);
        // 1000 USDG at 150% = 1500 USD = 0.75 ETH of collateral required.
        vm.expectRevert(
            abi.encodeWithSelector(LendingPool.InsufficientCollateral.selector, 0.75 ether, 0.5 ether)
        );
        pool.borrow{value: 0.5 ether}(1_000 * USDG_UNIT);
    }

    function test_Beat6_ClearingAttestationFallsBackToOnchainOnly() public {
        vm.startPrank(admin);
        registry.setAttestation(alice, _makeAttestation(ALICE_ID, 780));
        oracle.setOnchainScore(alice, 98, 5);
        vm.stopPrank();

        assertEq(oracle.getCompositeScore(alice), 99);

        vm.prank(admin);
        registry.clearAttestation(alice);

        assertEq(oracle.getCompositeScore(alice), 49, "reverts to the capped onchain-only score");
        assertEq(registry.getHistoricalScore(ALICE_ID), 98, "history survives");
    }

    function test_Beat7_LiquidationClosesUnderwaterPosition() public {
        _seedPool(100_000);

        // Worst-case borrower: composite 0 -> 150% collateral.
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        pool.borrow{value: 0.75 ether}(1_000 * USDG_UNIT);
        assertEq(pool.healthFactorBps(alice), 10_000);

        // ETH drops 25%: collateral 1500 -> 1125 USD against a 1500 USD requirement.
        _setEthPrice(1_500e18);
        assertEq(pool.healthFactorBps(alice), 7_500);

        _mintUsdg(liquidator, 1_000);
        _approveUsdg(liquidator, 1_000 * USDG_UNIT);

        vm.prank(liquidator);
        pool.liquidate(alice, 1_000 * USDG_UNIT);

        assertEq(pool.getBorrowerPosition(alice).debtUsdg, 0);
        // Liquidator paid 1000 USDG and took 1050 USD of ETH (5% bonus).
        assertEq(liquidator.balance, 0.7 ether);
        // The LP pool is whole again: repaid debt sits in the pool.
        assertEq(usdg.balanceOf(address(pool)), 100_000 * USDG_UNIT);
        assertEq(pool.totalDebt(), 0);
    }

    function test_FullLifecycle_DepositBorrowRepayWithdraw() public {
        // 1. LP supplies USDG
        _seedPool(10_000);
        // 2. Borrower with a strong profile draws USDG against ETH
        vm.startPrank(admin);
        oracle.setOnchainScore(alice, 98, 5);
        registry.setAttestation(alice, _makeAttestation(ALICE_ID, 780));
        oracle.setOnchainScore(alice, 98, 5);
        vm.stopPrank();

        vm.deal(alice, 3 ether);
        vm.startPrank(alice);
        // Composite 99 -> 7567 bps -> 3783.5 USD -> 1.89175 ETH of collateral.
        pool.borrow{value: 1.9 ether}(5_000 * USDG_UNIT);
        // 3. Borrower repays in USDG and recovers the ETH
        _mintUsdg(alice, 5_000);
        usdg.approve(address(pool), 5_000 * USDG_UNIT);
        pool.repayAll();
        vm.stopPrank();

        assertEq(usdg.balanceOf(address(pool)), 10_000 * USDG_UNIT);
        assertEq(pool.totalDebt(), 0);
        assertEq(pool.getBorrowerPosition(alice).collateralWei, 0);

        // 4. LP withdraws everything
        vm.prank(lp);
        pool.withdraw(10_000 * USDG_UNIT);
        assertEq(pool.totalDeposits(), 0);
        assertEq(usdg.balanceOf(lp), 10_000 * USDG_UNIT);
    }
}
