// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ArboraTestBase} from "./TestHelpers.sol";
import {CreditOracle} from "../src/CreditOracle.sol";
import {LendingPool} from "../src/LendingPool.sol";

/// @notice Invariant-style coverage: score bounds, curve monotonicity, thin-file cap.
contract FuzzTest is ArboraTestBase {
    bytes32 internal constant ID_1 = keccak256("identity-fuzz");

    function testFuzz_CompositeOnchainOnly_AlwaysInBounds(uint8 score) public {
        score = uint8(bound(score, 0, 100));
        _seedCompositeScore(alice, score);

        uint8 composite = oracle.getCompositeScore(alice);
        assertLe(composite, 100);
        assertGe(composite, 0);
    }

    function testFuzz_CompositeAttested_AlwaysInBounds(uint8 score, uint16 fico) public {
        score = uint8(bound(score, 0, 100));
        fico = uint16(bound(fico, 300, 850));

        vm.startPrank(admin);
        registry.setAttestation(alice, _makeAttestation(ID_1, fico));
        oracle.setOnchainScore(alice, score, 5);
        vm.stopPrank();

        uint8 composite = oracle.getCompositeScore(alice);
        assertLe(composite, 100);
        assertGe(composite, 0);
    }

    /// @dev Onchain-only scores are capped, so they can never demand sub-100% collateral.
    function testFuzz_ThinFileCap_PreventsUndercollateralisation(uint8 score) public {
        score = uint8(bound(score, 0, 100));
        _pushScore(alice, score);

        uint8 composite = oracle.getCompositeScore(alice);
        assertLe(composite, 50, "default onchain-only multiplier caps the composite at 50");
        assertGe(pool.getCollateralRatioBps(composite), 10_000);
    }

    function testFuzz_Curve_MonotonicAndBounded(uint8 score) public view {
        score = uint8(bound(score, 0, 100));
        uint16 ratio = pool.getCollateralRatioBps(score);
        assertGe(ratio, 7_500);
        assertLe(ratio, 15_000);

        if (score < 100) {
            assertGe(ratio, pool.getCollateralRatioBps(score + 1), "curve must never rise with score");
        }
    }

    function testFuzz_FicoMapping_BoundedAndMonotonic(uint16 ficoA, uint16 ficoB) public view {
        ficoA = uint16(bound(ficoA, 250, 950));
        ficoB = uint16(bound(ficoB, 250, 950));

        uint8 mappedA = oracle.mapFicoToZero100(ficoA);
        uint8 mappedB = oracle.mapFicoToZero100(ficoB);
        assertLe(mappedA, 100);
        assertGe(mappedA, 0);
        if (ficoA <= ficoB) assertLe(mappedA, mappedB);
    }

    function testFuzz_RequiredCollateral_ScalesWithDebt(uint256 debtDollars, uint8 score) public {
        debtDollars = bound(debtDollars, 1, 1_000_000);
        score = uint8(bound(score, 0, 100));
        _seedCompositeScore(alice, score);

        uint16 ratioBps = pool.getCollateralRatioBps(score);
        uint256 expected = (debtDollars * USDG_UNIT * pool.usdgScale() * ratioBps / 10_000) * 1e18 / ETH_PRICE;
        // Required collateral rounds up, so allow a 1 wei tolerance.
        uint256 actual = pool.getRequiredCollateral(alice, debtDollars * USDG_UNIT);
        assertLe(actual, expected + 1);
        assertGe(actual, expected > 0 ? expected - 1 : 0);
    }

    function testFuzz_HealthFactor_DeclinesAsPriceFalls(uint8 score) public {
        score = uint8(bound(score, 0, 100));
        _seedCompositeScore(alice, score);

        uint16 ratioBps = pool.getCollateralRatioBps(score);
        uint256 debt = 1_000 * USDG_UNIT;
        uint256 collateralWei = (debt * pool.usdgScale() * ratioBps / 10_000) * 1e18 / ETH_PRICE + 1;

        _seedPool(10_000);
        vm.deal(alice, collateralWei);
        vm.prank(alice);
        pool.borrow{value: collateralWei}(debt);

        uint256 previousHealth = pool.healthFactorBps(alice);
        assertGe(previousHealth, 10_000, "a freshly opened position must be healthy");

        for (uint256 price = ETH_PRICE; price >= ETH_PRICE / 2; price -= ETH_PRICE / 10) {
            _setEthPrice(price);
            uint256 health = pool.healthFactorBps(alice);
            assertLe(health, previousHealth, "health must not improve as price falls");
            previousHealth = health;
        }
    }
}
