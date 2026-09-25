// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {ArboraTestBase} from "./TestHelpers.sol";
import {CreditOracle} from "../src/CreditOracle.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {AdminPriceOracle} from "../src/oracles/AdminPriceOracle.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {IPriceOracle} from "../src/interfaces/IPriceOracle.sol";

contract LendingPoolTest is ArboraTestBase {
    event Deposited(address indexed lp, uint256 amount, uint256 newTotalDeposits);
    event Withdrawn(address indexed lp, uint256 amount, uint256 newTotalDeposits);
    event Borrowed(
        address indexed borrower,
        uint256 debtUsdg,
        uint256 collateralWei,
        uint16 loanRatioBps,
        uint8 compositeScore
    );
    event Repaid(address indexed borrower, address indexed payer, uint256 amount, bool positionClosed);
    event Liquidated(
        address indexed borrower,
        address indexed liquidator,
        uint256 debtRepaid,
        uint256 collateralSeizedWei,
        uint256 collateralReturnedWei
    );
    event CollateralCurveUpdated(uint16[5] scoreBreakpoints, uint16[6] collateralRatiosBps);
    event LiquidationBonusUpdated(uint16 newBonusBps);
    event MaxPriceAgeUpdated(uint256 newMaxPriceAge);

    uint256 internal constant LIQUIDITY = 100_000; // whole USDG

    // ------------------------------------------------------------- collateral curve ---

    function test_Curve_AtBreakpoints() public view {
        assertEq(pool.getCollateralRatioBps(0), 15_000);
        assertEq(pool.getCollateralRatioBps(20), 15_000);
        assertEq(pool.getCollateralRatioBps(50), 12_000);
        assertEq(pool.getCollateralRatioBps(70), 10_000);
        assertEq(pool.getCollateralRatioBps(85), 8_500);
        assertEq(pool.getCollateralRatioBps(100), 7_500);
    }

    function test_Curve_Interpolates() public view {
        assertEq(pool.getCollateralRatioBps(35), 13_500);
        assertEq(pool.getCollateralRatioBps(49), 12_100);
        assertEq(pool.getCollateralRatioBps(60), 11_000);
        assertEq(pool.getCollateralRatioBps(77), 9_300);
        assertEq(pool.getCollateralRatioBps(99), 7_567);
    }

    function test_Curve_IsMonotonicNonIncreasing() public view {
        uint16 previous = pool.getCollateralRatioBps(0);
        for (uint8 score = 1; score <= 100; score++) {
            uint16 current = pool.getCollateralRatioBps(score);
            assertTrue(current <= previous, "higher score must never require more collateral");
            previous = current;
        }
    }

    function test_Curve_Bounds() public view {
        for (uint8 score = 0; score <= 100; score++) {
            uint16 ratio = pool.getCollateralRatioBps(score);
            assertTrue(ratio >= 7_500 && ratio <= 15_000, "ratio outside the configured band");
        }
    }

    // ------------------------------------------------------------------ liquidity ---

    function test_Deposit_Succeeds() public {
        _mintUsdg(lp, LIQUIDITY);
        _approveUsdg(lp, LIQUIDITY * USDG_UNIT);

        vm.expectEmit(true, false, false, true);
        emit Deposited(lp, LIQUIDITY * USDG_UNIT, LIQUIDITY * USDG_UNIT);
        vm.prank(lp);
        pool.deposit(LIQUIDITY * USDG_UNIT);

        assertEq(pool.totalDeposits(), LIQUIDITY * USDG_UNIT);
        assertEq(pool.lpDeposits(lp), LIQUIDITY * USDG_UNIT);
        assertEq(usdg.balanceOf(address(pool)), LIQUIDITY * USDG_UNIT);
        assertEq(pool.availableLiquidity(), LIQUIDITY * USDG_UNIT);
    }

    function test_Deposit_RevertsOnZero() public {
        vm.expectRevert(LendingPool.ZeroAmount.selector);
        pool.deposit(0);
    }

    function test_Withdraw_Succeeds() public {
        _seedPool(LIQUIDITY);

        vm.expectEmit(true, false, false, true);
        emit Withdrawn(lp, 1_000 * USDG_UNIT, (LIQUIDITY - 1_000) * USDG_UNIT);
        vm.prank(lp);
        pool.withdraw(1_000 * USDG_UNIT);

        assertEq(usdg.balanceOf(lp), 1_000 * USDG_UNIT);
        assertEq(pool.totalDeposits(), (LIQUIDITY - 1_000) * USDG_UNIT);
    }

    function test_Withdraw_RevertsWhenExceedingOwnDeposit() public {
        _seedPool(LIQUIDITY);
        vm.expectRevert(
            abi.encodeWithSelector(
                LendingPool.ExcessWithdraw.selector, (LIQUIDITY + 1) * USDG_UNIT, LIQUIDITY * USDG_UNIT
            )
        );
        vm.prank(lp);
        pool.withdraw((LIQUIDITY + 1) * USDG_UNIT);
    }

    function test_Withdraw_RevertsWhenExceedingFreeLiquidity() public {
        _seedPool(LIQUIDITY);
        _borrowFullCollateral(alice, 60_000 * USDG_UNIT, 15_000);

        // 60k of 100k is lent out: only 40k remains withdrawable.
        vm.expectRevert(
            abi.encodeWithSelector(
                LendingPool.ExcessWithdraw.selector, 50_000 * USDG_UNIT, 40_000 * USDG_UNIT
            )
        );
        vm.prank(lp);
        pool.withdraw(50_000 * USDG_UNIT);
    }

    // ------------------------------------------------------------------------- borrow ---

    function test_Borrow_UsesScoreDerivedRatio() public {
        _seedPool(LIQUIDITY);
        _seedCompositeScore(alice, 0);
        vm.deal(alice, 2 ether);

        vm.expectEmit(true, false, false, true);
        emit Borrowed(alice, 1_000 * USDG_UNIT, 0.75 ether, 15_000, 0);
        vm.prank(alice);
        pool.borrow{value: 0.75 ether}(1_000 * USDG_UNIT);

        LendingPool.Position memory position = pool.getBorrowerPosition(alice);
        assertEq(position.debtUsdg, 1_000 * USDG_UNIT);
        assertEq(position.collateralWei, 0.75 ether);
        assertEq(position.loanRatioBps, 15_000);
        assertEq(usdg.balanceOf(alice), 1_000 * USDG_UNIT);
        assertEq(pool.totalDebt(), 1_000 * USDG_UNIT);
    }

    function test_Borrow_PerfectScoreNeedsOnly75Percent() public {
        _seedPool(LIQUIDITY);
        _seedCompositeScore(alice, 100);
        vm.deal(alice, 1 ether);

        vm.prank(alice);
        pool.borrow{value: 0.375 ether}(1_000 * USDG_UNIT);

        assertEq(pool.getBorrowerCollateralRatioBps(alice), 7_500);
    }

    function test_Borrow_RevertsOnInsufficientCollateral() public {
        _seedPool(LIQUIDITY);
        _seedCompositeScore(alice, 0);
        vm.deal(alice, 1 ether);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(LendingPool.InsufficientCollateral.selector, 0.75 ether, 0.7 ether)
        );
        pool.borrow{value: 0.7 ether}(1_000 * USDG_UNIT);
    }

    function test_Borrow_RevertsOnSecondPosition() public {
        _seedPool(LIQUIDITY);
        _seedCompositeScore(alice, 100);
        vm.deal(alice, 2 ether);

        vm.startPrank(alice);
        pool.borrow{value: 0.375 ether}(1_000 * USDG_UNIT);
        vm.expectRevert(LendingPool.PositionAlreadyOpen.selector);
        pool.borrow{value: 0.375 ether}(1_000 * USDG_UNIT);
        vm.stopPrank();
    }

    function test_Borrow_RevertsWithoutLiquidity() public {
        _seedCompositeScore(alice, 100);
        vm.deal(alice, 1 ether);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LendingPool.ExcessLiquidity.selector, 1_000 * USDG_UNIT, 0));
        pool.borrow{value: 0.375 ether}(1_000 * USDG_UNIT);
    }

    function test_Borrow_RevertsOnZeroAmount() public {
        _seedPool(LIQUIDITY);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(LendingPool.ZeroAmount.selector);
        pool.borrow{value: 1 ether}(0);
    }

    function test_Borrow_ExcessCollateralRaisesHealth() public {
        _seedPool(LIQUIDITY);
        _seedCompositeScore(alice, 100);
        vm.deal(alice, 1 ether);

        vm.prank(alice);
        pool.borrow{value: 0.75 ether}(1_000 * USDG_UNIT); // 2x the 0.375 required

        // required = 0.375 ETH worth 750 USD, collateral 0.75 ETH = 1500 USD -> 200%
        assertEq(pool.healthFactorBps(alice), 20_000);
    }

    // ------------------------------------------------------ add / withdraw collateral ---

    function test_AddCollateral_ImprovesHealth() public {
        _openPosition(alice, 1_000, 15_000, 0.75 ether);
        uint256 before = pool.healthFactorBps(alice);

        vm.deal(alice, 0.5 ether);
        vm.prank(alice);
        pool.addCollateral{value: 0.5 ether}();

        assertGt(pool.healthFactorBps(alice), before);
        assertEq(pool.getBorrowerPosition(alice).collateralWei, 1.25 ether);
    }

    function test_AddCollateral_RevertsWithoutPosition() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(LendingPool.NoPosition.selector);
        pool.addCollateral{value: 1 ether}();
    }

    function test_WithdrawCollateral_ReturnsFreeCollateral() public {
        _openPosition(alice, 1_000, 15_000, 1.5 ether); // health exactly 100%
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        pool.addCollateral{value: 0.5 ether}(); // now 2.0 ETH -> health 133%

        uint256 balanceBefore = alice.balance;
        vm.prank(alice);
        pool.withdrawCollateral(0.25 ether);

        assertEq(alice.balance, balanceBefore + 0.25 ether);
        assertEq(pool.getBorrowerPosition(alice).collateralWei, 1.75 ether);
    }

    function test_WithdrawCollateral_RevertsWhenUnhealthy() public {
        _openPosition(alice, 1_000, 15_000, 0.75 ether); // health exactly 100%
        vm.deal(alice, 1 ether);
        vm.startPrank(alice);
        pool.addCollateral{value: 0.5 ether}(); // 1.25 ETH -> health 166%
        // Pulling back below the required ratio must revert.
        vm.expectRevert(abi.encodeWithSelector(LendingPool.UnhealthyPosition.selector, 8_666));
        pool.withdrawCollateral(0.6 ether);
        vm.stopPrank();
    }

    function test_WithdrawCollateral_RevertsExceedingPosition() public {
        _openPosition(alice, 1_000, 15_000, 1 ether);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(LendingPool.CollateralExceedsPosition.selector, 2 ether, 1 ether)
        );
        pool.withdrawCollateral(2 ether);
    }

    // ---------------------------------------------------------------------------- repay ---

    function test_Repay_PartialKeepsPositionOpen() public {
        _openPosition(alice, 1_000, 15_000, 0.75 ether);
        _mintUsdg(alice, 400);
        _approveUsdg(alice, 400 * USDG_UNIT);

        vm.expectEmit(true, true, false, true);
        emit Repaid(alice, alice, 400 * USDG_UNIT, false);
        vm.prank(alice);
        pool.repay(400 * USDG_UNIT);

        assertEq(pool.getBorrowerPosition(alice).debtUsdg, 600 * USDG_UNIT);
        assertEq(pool.getBorrowerPosition(alice).collateralWei, 0.75 ether, "collateral stays until closed");
        assertEq(pool.totalDebt(), 600 * USDG_UNIT);
    }

    function test_RepayAll_ReturnsCollateral() public {
        _openPosition(alice, 1_000, 15_000, 0.75 ether);
        _mintUsdg(alice, 1_000);
        _approveUsdg(alice, 1_000 * USDG_UNIT);

        uint256 balanceBefore = alice.balance;
        vm.prank(alice);
        pool.repayAll();

        assertEq(pool.getBorrowerPosition(alice).debtUsdg, 0);
        assertEq(pool.getBorrowerPosition(alice).collateralWei, 0);
        assertEq(alice.balance, balanceBefore + 0.75 ether, "ETH collateral returned");
        assertEq(usdg.balanceOf(address(pool)), LIQUIDITY * USDG_UNIT, "LP funds restored");
        assertEq(pool.totalDebt(), 0);
    }

    function test_Repay_RevertsOnOverpayment() public {
        _openPosition(alice, 1_000, 15_000, 0.75 ether);
        _mintUsdg(alice, 2_000);
        _approveUsdg(alice, 2_000 * USDG_UNIT);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(LendingPool.ExcessRepayment.selector, 2_000 * USDG_UNIT, 1_000 * USDG_UNIT)
        );
        pool.repay(2_000 * USDG_UNIT);
    }

    function test_Repay_RevertsWithoutPosition() public {
        vm.prank(alice);
        vm.expectRevert(LendingPool.NoPosition.selector);
        pool.repay(1);
    }

    function test_Withdraw_CappedByOutstandingDebt() public {
        _openPosition(alice, 60_000, 15_000, 45 ether);
        // 100k deposited, 60k borrowed -> 40k free
        vm.expectRevert(
            abi.encodeWithSelector(
                LendingPool.ExcessWithdraw.selector, 41_000 * USDG_UNIT, 40_000 * USDG_UNIT
            )
        );
        vm.prank(lp);
        pool.withdraw(41_000 * USDG_UNIT);
    }

    // ---------------------------------------------------------------- liquidation ---

    function test_Liquidate_RevertsOnHealthyPosition() public {
        _openPosition(alice, 1_000, 15_000, 0.75 ether); // exactly 100% health
        _mintUsdg(liquidator, 1_000);
        _approveUsdg(liquidator, 1_000 * USDG_UNIT);

        vm.prank(liquidator);
        vm.expectRevert(abi.encodeWithSelector(LendingPool.HealthyPosition.selector, 10_000));
        pool.liquidate(alice, 1_000 * USDG_UNIT);
    }

    function test_Liquidate_FullCloseSeizesBonusAndReturnsResidual() public {
        _openPosition(alice, 1_000, 15_000, 0.75 ether); // 0.75 ETH = $1500 vs $1500 required
        _setEthPrice(1_500e18); // collateral now $1125 -> health 7500

        _mintUsdg(liquidator, 1_000);
        _approveUsdg(liquidator, 1_000 * USDG_UNIT);

        uint256 liquidatorBalanceBefore = liquidator.balance;
        uint256 borrowerBalanceBefore = alice.balance;

        vm.expectEmit(true, true, false, true);
        emit Liquidated(alice, liquidator, 1_000 * USDG_UNIT, 0.7 ether, 0.05 ether);
        vm.prank(liquidator);
        pool.liquidate(alice, 1_000 * USDG_UNIT);

        // 1000 USDG repaid, 5% bonus => 1050 USD of ETH = 0.7 ETH at $1500
        assertEq(liquidator.balance, liquidatorBalanceBefore + 0.7 ether);
        assertEq(alice.balance, borrowerBalanceBefore + 0.05 ether, "residual returns to the borrower");
        assertEq(pool.getBorrowerPosition(alice).debtUsdg, 0);
        assertEq(pool.getBorrowerPosition(alice).collateralWei, 0);
        assertEq(pool.totalDebt(), 0);
    }

    function test_Liquidate_PartialSeizesProportionally() public {
        _openPosition(alice, 1_000, 15_000, 0.75 ether);
        _setEthPrice(1_500e18);

        _mintUsdg(liquidator, 500);
        _approveUsdg(liquidator, 500 * USDG_UNIT);

        vm.prank(liquidator);
        pool.liquidate(alice, 500 * USDG_UNIT);

        // 500 * 1.05 = 525 USD -> 525/1500 = 0.35 ETH seized
        LendingPool.Position memory position = pool.getBorrowerPosition(alice);
        assertEq(position.debtUsdg, 500 * USDG_UNIT);
        assertEq(position.collateralWei, 0.4 ether);
        assertGt(pool.healthFactorBps(alice), 7_500);
    }

    function test_Liquidate_SeizesAllWhenCollateralWorthLessThanDebtPlusBonus() public {
        _openPosition(alice, 1_000, 15_000, 0.75 ether);
        _setEthPrice(700e18); // collateral = $525 < debt 1000

        _mintUsdg(liquidator, 1_000);
        _approveUsdg(liquidator, 1_000 * USDG_UNIT);

        vm.prank(liquidator);
        pool.liquidate(alice, 1_000 * USDG_UNIT);

        assertEq(pool.getBorrowerPosition(alice).collateralWei, 0);
        assertEq(liquidator.balance, 0.75 ether, "liquidator takes the whole underwater position");
        assertEq(pool.getBorrowerPosition(alice).debtUsdg, 0);
    }

    function test_Liquidate_RevertsWithoutPosition() public {
        vm.prank(liquidator);
        vm.expectRevert(LendingPool.NoPosition.selector);
        pool.liquidate(alice, 1);
    }

    function test_Liquidate_RevertsOnExcessAmount() public {
        _openPosition(alice, 1_000, 15_000, 0.75 ether);
        _setEthPrice(1_500e18);
        _mintUsdg(liquidator, 2_000);
        _approveUsdg(liquidator, 2_000 * USDG_UNIT);

        vm.prank(liquidator);
        vm.expectRevert(
            abi.encodeWithSelector(LendingPool.ExcessRepayment.selector, 2_000 * USDG_UNIT, 1_000 * USDG_UNIT)
        );
        pool.liquidate(alice, 2_000 * USDG_UNIT);
    }

    function test_LiquidationBonus_IsConfigurable() public {
        vm.prank(admin);
        pool.setLiquidationBonus(1_000); // 10%

        _openPosition(alice, 1_000, 15_000, 0.75 ether);
        _setEthPrice(1_500e18);
        _mintUsdg(liquidator, 1_000);
        _approveUsdg(liquidator, 1_000 * USDG_UNIT);

        vm.prank(liquidator);
        pool.liquidate(alice, 1_000 * USDG_UNIT);

        // 1000 * 1.10 = 1100 USD -> 1100/1500 = 0.7333... ETH (rounded up)
        assertEq(liquidator.balance, 0.733333333333333334 ether);
    }

    // ----------------------------------------------------------------------- views ---

    function test_HealthFactor_IsMaxWithoutDebt() public view {
        assertEq(pool.healthFactorBps(alice), type(uint256).max);
    }

    function test_Views_ExposePriceAndValues() public {
        assertEq(pool.ethPriceUsd18(), ETH_PRICE);
        _openPosition(alice, 1_000, 15_000, 0.75 ether);

        assertEq(pool.collateralValueUsd18(alice), 1_500e18);
        assertEq(pool.debtValueUsd18(alice), 1_000e18);
        assertEq(pool.healthFactorBps(alice), 10_000);
    }

    function test_GetRequiredCollateral_WithoutOpenPosition_UsesCurrentScore() public {
        _seedCompositeScore(alice, 100);
        assertEq(pool.getRequiredCollateral(alice, 1_000 * USDG_UNIT), 0.375 ether);
    }

    function test_GetRequiredCollateral_WithOpenPosition_UsesLockedRatio() public {
        _openPosition(alice, 1_000, 15_000, 0.75 ether);
        assertEq(pool.getRequiredCollateral(alice, 1_000 * USDG_UNIT), 0.75 ether);
    }

    function test_TokenDecimals_AreReadFromUsdg() public view {
        assertEq(pool.usdgDecimals(), 6);
        assertEq(pool.usdgScale(), 1e12);
    }

    function test_AvailableLiquidity_ReflectsDebt() public {
        _seedPool(LIQUIDITY);
        _borrowFullCollateral(alice, 10_000 * USDG_UNIT, 15_000);
        assertEq(pool.availableLiquidity(), 90_000 * USDG_UNIT);
    }

    // ---------------------------------------------------------------- price policy ---

    function test_StalePrice_RevertsOnBorrow() public {
        _seedPool(LIQUIDITY);
        _seedCompositeScore(alice, 100);
        vm.deal(alice, 1 ether);

        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(LendingPool.PriceStale.selector, block.timestamp - (7 days + 1), 7 days)
        );
        pool.borrow{value: 0.375 ether}(1_000 * USDG_UNIT);
    }

    function test_MaxPriceAge_IsConfigurable() public {
        vm.warp(block.timestamp + 8 days);
        vm.prank(admin);
        pool.setMaxPriceAge(30 days);
        assertEq(pool.maxPriceAge(), 30 days);

        // Price is now fresh again relative to the new policy.
        assertEq(pool.ethPriceUsd18(), ETH_PRICE);
    }

    function test_MaxPriceAge_RevertsAboveCap() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(LendingPool.StalePeriodTooLong.selector, 31 days));
        pool.setMaxPriceAge(31 days);
    }

    function test_ZeroPrice_Reverts() public {
        vm.prank(admin);
        vm.expectRevert(AdminPriceOracle.ZeroPrice.selector);
        priceOracle.setPrice(0);
    }

    // ----------------------------------------------------------------- admin ---

    function test_SetCollateralCurve_HappyPath() public {
        uint16[5] memory bps = [uint16(10), 30, 60, 80, 95];
        uint16[6] memory ratios = [uint16(18_000), 16_000, 13_000, 11_000, 9_000, 8_000];

        vm.prank(admin);
        pool.setCollateralCurve(bps, ratios);

        assertEq(pool.getCollateralRatioBps(95), 8_000);
        assertEq(pool.getCollateralRatioBps(96), 8_000);
    }

    function test_SetCollateralCurve_RevertsOnBadInvariants() public {
        uint16[5] memory goodBps = [uint16(10), 30, 60, 80, 95];
        uint16[6] memory goodRatios = [uint16(18_000), 16_000, 13_000, 11_000, 9_000, 8_000];

        vm.startPrank(admin);

        uint16[5] memory zeroFirst = [uint16(0), 30, 60, 80, 95];
        vm.expectRevert(LendingPool.BreakpointsInvalid.selector);
        pool.setCollateralCurve(zeroFirst, goodRatios);

        uint16[5] memory tooHigh = [uint16(10), 30, 60, 80, 101];
        vm.expectRevert(LendingPool.BreakpointsInvalid.selector);
        pool.setCollateralCurve(tooHigh, goodRatios);

        uint16[5] memory notIncreasing = [uint16(10), 30, 30, 80, 95];
        vm.expectRevert(LendingPool.BreakpointsInvalid.selector);
        pool.setCollateralCurve(notIncreasing, goodRatios);

        uint16[6] memory ascending = [uint16(18_000), 19_000, 13_000, 11_000, 9_000, 8_000];
        vm.expectRevert(LendingPool.RatiosNotDescending.selector);
        pool.setCollateralCurve(goodBps, ascending);

        uint16[6] memory tooHighRatio = [uint16(20_001), 16_000, 13_000, 11_000, 9_000, 8_000];
        vm.expectRevert(LendingPool.RatiosNotDescending.selector);
        pool.setCollateralCurve(goodBps, tooHighRatio);

        uint16[6] memory tooLowRatio = [uint16(18_000), 16_000, 13_000, 11_000, 9_000, 4_000];
        vm.expectRevert(LendingPool.RatiosNotDescending.selector);
        pool.setCollateralCurve(goodBps, tooLowRatio);

        vm.stopPrank();
    }

    function test_AdminSetters_OnlyOwner() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        pool.setLiquidationBonus(100);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        pool.pause();
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        pool.setCollateralPriceOracle(IPriceOracle(address(0xBAD)));
        vm.stopPrank();
    }

    function test_SetLiquidationBonus_RevertsAboveCap() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(LendingPool.BonusAboveLimit.selector, 2_001));
        pool.setLiquidationBonus(2_001);
    }

    function test_SetCollateralPriceOracle_RevertsOnZero() public {
        vm.prank(admin);
        vm.expectRevert(LendingPool.ZeroAddress.selector);
        pool.setCollateralPriceOracle(IPriceOracle(address(0)));
    }

    // ------------------------------------------------------------------- pause ---

    function test_Pause_BlocksNewActivityButAllowsExit() public {
        _seedPool(LIQUIDITY);
        _seedCompositeScore(alice, 100);
        _openPosition(alice, 1_000, 15_000, 0.75 ether);

        vm.prank(admin);
        pool.pause();

        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pool.borrow{value: 0.375 ether}(1);

        vm.deal(carol, 1 ether);
        vm.prank(carol);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pool.deposit(1);

        // Exiting positions still works while paused.
        _mintUsdg(alice, 1_000);
        _approveUsdg(alice, 1_000 * USDG_UNIT);
        vm.prank(alice);
        pool.repayAll();

        vm.prank(admin);
        pool.unpause();
        vm.prank(lp);
        pool.withdraw(1_000 * USDG_UNIT);
    }

    // ------------------------------------------------------------------ internals ---

    function _borrowFullCollateral(address who, uint256 debtRaw, uint16 expectedRatioBps) internal {
        _seedCompositeScore(who, 0);
        uint256 requiredWei = (debtRaw * pool.usdgScale() * expectedRatioBps / 10_000) * 1e18 / ETH_PRICE + 1;
        vm.deal(who, requiredWei + 1 ether);
        vm.prank(who);
        pool.borrow{value: requiredWei}(debtRaw);
    }

    /// @dev Open a position with an explicitly locked ratio (bypassing score math).
    function _openPosition(address who, uint256 usdDollars, uint16 ratioBps, uint256 collateralWei) internal {
        _seedPool(LIQUIDITY);
        // Pick a score whose curve ratio equals the requested one.
        uint8 score = _scoreForRatio(ratioBps);
        _seedCompositeScore(who, score);
        vm.deal(who, collateralWei + 1 ether);
        vm.prank(who);
        pool.borrow{value: collateralWei}(usdDollars * USDG_UNIT);
        assertEq(pool.getBorrowerCollateralRatioBps(who), ratioBps, "helper ratio mismatch");
    }

    function _scoreForRatio(uint16 ratioBps) internal view returns (uint8) {
        for (uint8 score = 0; score <= 100; score++) {
            if (pool.getCollateralRatioBps(score) == ratioBps) return score;
        }
        revert("no score maps to that ratio");
    }
}
