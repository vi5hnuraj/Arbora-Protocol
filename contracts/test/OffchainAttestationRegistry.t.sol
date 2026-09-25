// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {ArboraTestBase} from "./TestHelpers.sol";
import {OffchainAttestationRegistry} from "../src/OffchainAttestationRegistry.sol";

contract OffchainAttestationRegistryTest is ArboraTestBase {
    bytes32 internal constant ID_1 = keccak256("identity-1");
    bytes32 internal constant ID_2 = keccak256("identity-2");

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

    // ------------------------------------------------------------ oracle link ---

    function test_SetCreditOracle_Succeeds() public {
        OffchainAttestationRegistry fresh = new OffchainAttestationRegistry(admin);
        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit CreditOracleSet(address(oracle));
        fresh.setCreditOracle(address(oracle));
        assertEq(fresh.creditOracle(), address(oracle));
    }

    function test_SetCreditOracle_RevertsOnSecondCall() public {
        vm.prank(admin);
        vm.expectRevert(OffchainAttestationRegistry.ZeroAddress.selector);
        registry.setCreditOracle(address(0xBAD));
    }

    function test_SetCreditOracle_RevertsOnZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(OffchainAttestationRegistry.ZeroAddress.selector);
        registry.setCreditOracle(address(0));
    }

    function test_SetCreditOracle_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        registry.setCreditOracle(address(0xBAD));
    }

    // -------------------------------------------------------------- setAttest ---

    function test_SetAttestation_Basic() public {
        vm.prank(admin);
        vm.expectEmit(true, true, false, true);
        emit AttestationSet(alice, ID_1, 780);
        registry.setAttestation(alice, _makeAttestation(ID_1, 780));

        assertTrue(registry.hasAttestation(alice));
        assertEq(registry.getIdentityForWallet(alice), ID_1);
        assertEq(registry.getWalletForIdentity(ID_1), alice);

        OffchainAttestationRegistry.OffchainAttestation memory att = registry.getAttestation(alice);
        assertEq(att.ficoScore, 780);
        assertEq(att.paymentHistoryScore, 85);
        assertTrue(att.isVerified);
        assertEq(att.timestamp, block.timestamp);
    }

    function test_SetAttestation_RefreshSameWalletAndIdentity() public {
        vm.startPrank(admin);
        registry.setAttestation(alice, _makeAttestation(ID_1, 700));
        registry.setAttestation(alice, _makeAttestation(ID_1, 780));
        vm.stopPrank();

        assertEq(registry.getAttestation(alice).ficoScore, 780);
        assertEq(registry.getWalletForIdentity(ID_1), alice);
    }

    function test_SetAttestation_RebindMigratesIdentityAndInheritsScore() public {
        vm.prank(admin);
        registry.setAttestation(alice, _makeAttestation(ID_1, 780));

        // Oracle records a historical score while alice holds the identity.
        vm.prank(address(oracle));
        registry.updateHistoricalScore(ID_1, 15);

        vm.startPrank(admin);
        vm.expectEmit(true, true, true, true);
        emit AttestationTransferred(alice, bob, ID_1, 15);
        registry.setAttestation(bob, _makeAttestation(ID_1, 780));
        vm.stopPrank();

        assertFalse(registry.hasAttestation(alice));
        assertEq(registry.getWalletForIdentity(ID_1), bob);
        assertEq(registry.getIdentityForWallet(bob), ID_1);
        // Historical score survives the migration: the sybil escape hatch is closed.
        assertEq(registry.getHistoricalScore(ID_1), 15);
        assertEq(registry.getWalletForIdentity(ID_1), bob);
    }

    function test_SetAttestation_IdentitySwitchCleansReverseLink() public {
        vm.startPrank(admin);
        registry.setAttestation(alice, _makeAttestation(ID_1, 700));
        registry.setAttestation(alice, _makeAttestation(ID_2, 780));
        vm.stopPrank();

        assertEq(registry.getWalletForIdentity(ID_1), address(0));
        assertEq(registry.getWalletForIdentity(ID_2), alice);
        assertEq(registry.getIdentityForWallet(alice), ID_2);
    }

    function test_SetAttestation_RevertsOnZeroWallet() public {
        vm.prank(admin);
        vm.expectRevert(OffchainAttestationRegistry.ZeroWallet.selector);
        registry.setAttestation(address(0), _makeAttestation(ID_1, 780));
    }

    function test_SetAttestation_RevertsOnZeroIdentity() public {
        vm.prank(admin);
        vm.expectRevert(OffchainAttestationRegistry.ZeroIdentity.selector);
        registry.setAttestation(alice, _makeAttestation(bytes32(0), 780));
    }

    function test_SetAttestation_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        registry.setAttestation(alice, _makeAttestation(ID_1, 780));
    }

    // ---------------------------------------------------------- clearAttest ----

    function test_ClearAttestation_PreservesHistoricalScore() public {
        vm.startPrank(admin);
        registry.setAttestation(alice, _makeAttestation(ID_1, 780));
        vm.stopPrank();

        vm.prank(address(oracle));
        registry.updateHistoricalScore(ID_1, 42);

        vm.prank(admin);
        registry.clearAttestation(alice);

        assertFalse(registry.hasAttestation(alice));
        assertEq(registry.getHistoricalScore(ID_1), 42, "clearing must not erase credit history");
        assertEq(registry.getWalletForIdentity(ID_1), address(0));
    }

    function test_ClearAttestation_RevertsWithoutAttestation() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(OffchainAttestationRegistry.NoAttestation.selector, alice));
        registry.clearAttestation(alice);
    }

    function test_ClearAttestation_OnlyOwner() public {
        vm.startPrank(admin);
        registry.setAttestation(alice, _makeAttestation(ID_1, 780));
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        registry.clearAttestation(alice);
    }

    // -------------------------------------------------- updateHistoricalScore ---

    function test_UpdateHistoricalScore_OracleOnly() public {
        vm.prank(address(oracle));
        vm.expectEmit(true, false, false, true);
        emit HistoricalScoreUpdated(ID_1, 55);
        registry.updateHistoricalScore(ID_1, 55);
        assertEq(registry.getHistoricalScore(ID_1), 55);
    }

    function test_UpdateHistoricalScore_RevertsForNonOracle() public {
        vm.startPrank(admin);
        vm.expectRevert(OffchainAttestationRegistry.OnlyOracle.selector);
        registry.updateHistoricalScore(ID_1, 55);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(OffchainAttestationRegistry.OnlyOracle.selector);
        registry.updateHistoricalScore(ID_1, 55);
    }

    function test_UpdateHistoricalScore_RevertsAbove100() public {
        vm.prank(address(oracle));
        vm.expectRevert(abi.encodeWithSelector(OffchainAttestationRegistry.ScoreAboveLimit.selector, 101));
        registry.updateHistoricalScore(ID_1, 101);
    }

    function test_UpdateHistoricalScore_RevertsOnZeroIdentity() public {
        vm.prank(address(oracle));
        vm.expectRevert(OffchainAttestationRegistry.ZeroIdentity.selector);
        registry.updateHistoricalScore(bytes32(0), 50);
    }

    function test_OracleIsNotSetYet_UpdateHistoricalScoreReverts() public {
        // Fresh registry without an oracle link: nobody is authorised.
        OffchainAttestationRegistry fresh = new OffchainAttestationRegistry(admin);
        vm.prank(admin);
        vm.expectRevert(OffchainAttestationRegistry.OnlyOracle.selector);
        fresh.updateHistoricalScore(ID_1, 50);
    }

    // --------------------------------------------------------------- getters ----

    function test_GettersDefaultToEmpty() public view {
        assertFalse(registry.hasAttestation(alice));
        assertEq(registry.getHistoricalScore(ID_1), 0);
        assertEq(registry.getIdentityForWallet(alice), bytes32(0));
        assertEq(registry.getWalletForIdentity(ID_1), address(0));

        OffchainAttestationRegistry.OffchainAttestation memory att = registry.getAttestation(alice);
        assertEq(att.ficoScore, 0);
        assertEq(att.identityHash, bytes32(0));
    }

    function test_OracleSyncFlow_WorksEndToEnd() public {
        vm.startPrank(admin);
        registry.setAttestation(alice, _makeAttestation(ID_1, 780));
        oracle.setOnchainScore(alice, 77, 5);
        vm.stopPrank();

        assertEq(registry.getHistoricalScore(ID_1), 77, "score push must seed the identity history");
    }

    function test_OracleSyncFlow_SkippedWithoutAttestation() public {
        vm.prank(admin);
        oracle.setOnchainScore(alice, 77, 5);
        assertEq(registry.getHistoricalScore(ID_1), 0);
    }
}
