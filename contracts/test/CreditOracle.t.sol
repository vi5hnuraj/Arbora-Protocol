// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {ArboraTestBase} from "./TestHelpers.sol";
import {CreditOracle} from "../src/CreditOracle.sol";
import {OffchainAttestationRegistry} from "../src/OffchainAttestationRegistry.sol";

contract CreditOracleTest is ArboraTestBase {
    bytes32 internal constant ID_1 = keccak256("identity-1");
    bytes32 internal constant ID_2 = keccak256("identity-2");

    event OnchainScoreSet(address indexed wallet, uint8 score, uint8 chainsUsed);
    event MultipliersUpdated(
        uint8 onchainOnlyMultiplier, uint8 offchainBaselineMultiplier, uint8 onchainBoostMultiplier
    );

    // ------------------------------------------------------------ setOnchainScore ---

    function test_SetOnchainScore_Basic() public {
        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit OnchainScoreSet(alice, 80, 5);
        oracle.setOnchainScore(alice, 80, 5);

        CreditOracle.CreditProfile memory profile = oracle.getFullProfile(alice);
        assertEq(profile.onchainScore, 80);
        assertEq(profile.chainsUsed, 5);
        assertEq(profile.lastUpdated, block.timestamp);
        assertFalse(profile.hasOffchainAttestation);
    }

    function test_SetOnchainScore_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        oracle.setOnchainScore(alice, 80, 5);
    }

    function test_SetOnchainScore_RevertsOnScoreGt100() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(CreditOracle.ScoreAboveLimit.selector, 101));
        oracle.setOnchainScore(alice, 101, 5);
    }

    function test_SetOnchainScore_RevertsOnZeroWallet() public {
        vm.prank(admin);
        vm.expectRevert(CreditOracle.ZeroWallet.selector);
        oracle.setOnchainScore(address(0), 50, 5);
    }

    function test_SetOnchainScore_RevertsOnChainsOutOfRange() public {
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(CreditOracle.ChainsOutOfRange.selector, 0));
        oracle.setOnchainScore(alice, 50, 0);
        vm.expectRevert(abi.encodeWithSelector(CreditOracle.ChainsOutOfRange.selector, 6));
        oracle.setOnchainScore(alice, 50, 6);
        vm.stopPrank();
    }

    function test_SetOnchainScore_SyncsHistoricalWhenAttested() public {
        vm.startPrank(admin);
        registry.setAttestation(alice, _makeAttestation(ID_1, 780));
        oracle.setOnchainScore(alice, 90, 5);
        vm.stopPrank();

        assertEq(registry.getHistoricalScore(ID_1), 90);
    }

    function test_SetOnchainScore_DoesNotSyncWhenNoAttestation() public {
        vm.prank(admin);
        oracle.setOnchainScore(alice, 90, 5);
        assertEq(registry.getHistoricalScore(ID_1), 0);
    }

    // -------------------------------------------------------------- FICO mapping ---

    function test_MapFicoToZero100_Boundaries() public view {
        assertEq(oracle.mapFicoToZero100(250), 0);
        assertEq(oracle.mapFicoToZero100(300), 0);
        assertEq(oracle.mapFicoToZero100(850), 100);
        assertEq(oracle.mapFicoToZero100(900), 100);
    }

    function test_MapFicoToZero100_KnownAnchors() public view {
        assertEq(oracle.mapFicoToZero100(500), 36);
        assertEq(oracle.mapFicoToZero100(575), 50);
        assertEq(oracle.mapFicoToZero100(650), 63);
        assertEq(oracle.mapFicoToZero100(700), 72);
        assertEq(oracle.mapFicoToZero100(750), 81);
        assertEq(oracle.mapFicoToZero100(780), 87);
        assertEq(oracle.mapFicoToZero100(820), 94);
    }

    function test_MapFicoToZero100_Monotonic() public view {
        uint8 previous = 0;
        for (uint16 fico = 300; fico <= 850; fico += 25) {
            uint8 mapped = oracle.mapFicoToZero100(fico);
            assertTrue(mapped >= previous, "mapping must be non-decreasing");
            previous = mapped;
        }
    }

    // --------------------------------------------------- composite: onchain only ---

    function test_Composite_OnchainOnly() public {
        _pushScore(alice, 98);
        assertEq(oracle.getCompositeScore(alice), 49);
    }

    function test_Composite_OnchainOnlyCapsAt50() public {
        _pushScore(alice, 100);
        assertEq(oracle.getCompositeScore(alice), 50);
    }

    function test_Composite_ZeroWhenNothingSet() public view {
        assertEq(oracle.getCompositeScore(alice), 0);
    }

    // ------------------------------------------------------- composite: attested ---

    function test_Composite_AttestationBaselineOnly() public {
        vm.prank(admin);
        registry.setAttestation(alice, _makeAttestation(ID_1, 780));

        // FICO 780 -> 87 -> 87 * 70 / 100 = 60 (floored)
        assertEq(oracle.getCompositeScore(alice), 60);

        CreditOracle.CreditProfile memory profile = oracle.getFullProfile(alice);
        assertTrue(profile.hasOffchainAttestation);
        assertEq(profile.offchainScore, 87);
        assertFalse(profile.isUsingInheritedScore);
    }

    function test_Composite_AttestationPlusStrongOnchain() public {
        vm.startPrank(admin);
        registry.setAttestation(alice, _makeAttestation(ID_1, 780));
        oracle.setMultipliers(50, 70, 40);
        oracle.setOnchainScore(alice, 98, 5);
        vm.stopPrank();

        // 60 baseline + 98 * 40 / 100 = 39 -> 99
        assertEq(oracle.getCompositeScore(alice), 99);
    }

    function test_Composite_AttestationPlusWeakOnchain() public {
        vm.startPrank(admin);
        registry.setAttestation(alice, _makeAttestation(ID_1, 780));
        oracle.setOnchainScore(alice, 20, 5);
        vm.stopPrank();

        // 60 + 8 = 68
        assertEq(oracle.getCompositeScore(alice), 68);
    }

    function test_Composite_ClampsAt100() public {
        vm.startPrank(admin);
        registry.setAttestation(alice, _makeAttestation(ID_1, 850));
        oracle.setOnchainScore(alice, 100, 5);
        vm.stopPrank();

        // 70 + 40 = 110 -> clamped to 100
        assertEq(oracle.getCompositeScore(alice), 100);
    }

    function test_Composite_LowFicoAndLowOnchain() public {
        vm.startPrank(admin);
        registry.setAttestation(alice, _makeAttestation(ID_1, 650));
        oracle.setOnchainScore(alice, 3, 5);
        vm.stopPrank();

        // FICO 650 -> 63 -> 44 + 1 = 45
        assertEq(oracle.getCompositeScore(alice), 45);
    }

    // ------------------------------------------------------------- inheritance ---

    function test_Composite_OwnScoreUsedWhenPresent() public {
        vm.startPrank(admin);
        registry.setAttestation(bob, _makeAttestation(ID_1, 780));
        oracle.setOnchainScore(bob, 15, 5);
        vm.stopPrank();

        CreditOracle.CreditProfile memory profile = oracle.getFullProfile(bob);
        assertFalse(profile.isUsingInheritedScore);
        // 60 baseline + 15 * 40 / 100 = 66
        assertEq(oracle.getCompositeScore(bob), 66);
    }

    function test_Composite_InheritsFromMigratedIdentity() public {
        // alice scores, then moves her identity to bob: bob inherits her record.
        vm.startPrank(admin);
        registry.setAttestation(alice, _makeAttestation(ID_1, 780));
        oracle.setOnchainScore(alice, 15, 5);
        registry.setAttestation(bob, _makeAttestation(ID_1, 780));
        vm.stopPrank();

        CreditOracle.CreditProfile memory profile = oracle.getFullProfile(bob);
        assertEq(profile.onchainScore, 0, "bob has no score of his own");
        assertEq(profile.historicalOnchainScore, 15, "inherits alice's record");
        assertTrue(profile.isUsingInheritedScore);
        // 60 + 6 = 66
        assertEq(oracle.getCompositeScore(bob), 66);
    }

    function test_Composite_OwnScorePreferredOverHistorical() public {
        vm.startPrank(admin);
        registry.setAttestation(bob, _makeAttestation(ID_1, 780));
        oracle.setOnchainScore(bob, 15, 5);
        // Push a better score for the same identity through a fresh wallet.
        registry.setAttestation(carol, _makeAttestation(ID_1, 780));
        oracle.setOnchainScore(carol, 70, 5);
        vm.stopPrank();

        CreditOracle.CreditProfile memory profile = oracle.getFullProfile(carol);
        assertFalse(profile.isUsingInheritedScore);
        assertEq(profile.onchainScore, 70);
        // 60 + 70*40/100 = 88
        assertEq(oracle.getCompositeScore(carol), 88);
        assertEq(registry.getHistoricalScore(ID_1), 70, "history synced to the newest score");
    }

    function test_Composite_NoInheritanceWhenHistoryEmpty() public {
        vm.prank(admin);
        registry.setAttestation(bob, _makeAttestation(ID_1, 780));

        CreditOracle.CreditProfile memory profile = oracle.getFullProfile(bob);
        assertEq(profile.historicalOnchainScore, 0);
        assertFalse(profile.isUsingInheritedScore);
        assertEq(oracle.getCompositeScore(bob), 60);
    }

    // ------------------------------------------------------------- multipliers ---

    function test_SetMultipliers_UpdatesAndReapplies() public {
        _pushScore(alice, 30);
        assertEq(oracle.getCompositeScore(alice), 15, "30 * 50 / 100 with defaults");

        vm.prank(admin);
        oracle.setMultipliers(100, 70, 40);
        assertEq(oracle.getCompositeScore(alice), 30, "recomputed with the new weight");
    }

    function test_SetMultipliers_EmitsEvent() public {
        vm.startPrank(admin);
        vm.expectEmit(false, false, false, true);
        emit MultipliersUpdated(60, 70, 40);
        oracle.setMultipliers(60, 70, 40);
        vm.stopPrank();
    }

    function test_SetMultipliers_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        oracle.setMultipliers(60, 70, 40);
    }

    function test_SetMultipliers_RevertsAbove100() public {
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(CreditOracle.MultiplierAboveLimit.selector, 101));
        oracle.setMultipliers(101, 70, 40);
        vm.expectRevert(abi.encodeWithSelector(CreditOracle.MultiplierAboveLimit.selector, 101));
        oracle.setMultipliers(50, 101, 40);
        vm.expectRevert(abi.encodeWithSelector(CreditOracle.MultiplierAboveLimit.selector, 101));
        oracle.setMultipliers(50, 70, 101);
        vm.stopPrank();
    }

    // ------------------------------------------------------------- construction ---

    function test_Constructor_RevertsOnZeroRegistry() public {
        vm.expectRevert(CreditOracle.ZeroRegistry.selector);
        new CreditOracle(admin, OffchainAttestationRegistry(address(0)));
    }

    function test_Constructor_RevertsOnZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new CreditOracle(address(0), registry);
    }
}
