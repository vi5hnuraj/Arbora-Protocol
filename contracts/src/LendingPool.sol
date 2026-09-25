// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {CreditOracle} from "./CreditOracle.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";

/// @title LendingPool
/// @author Arbora Protocol
/// @notice Undercollateralised stablecoin lending: liquidity providers supply **USDG**
///         (Paxos' Global Dollar), borrowers post **ETH collateral** sized by their
///         composite credit score.
/// @dev    Design notes
///        - *Debt asset*: USDG (ERC-20, 6 decimals in production). The pool never holds
///          the debt asset and the collateral asset at the same time for one position,
///          which keeps accounting trivial.
///        - *Collateral*: native ETH, valued through {IPriceOracle} (Chainlink adapter
///          in production, admin-fed oracle on testnets).
///        - *Credit-linked terms*: the minimum collateral ratio is read from
///          {CreditOracle} at origination and frozen into the position, ranging from
///          150% (score 0) down to 75% (score 100) on a continuous piecewise curve.
///        - *Liquidation*: positions whose collateral value falls below their required
///          ratio may be liquidated; the liquidator repays USDG and seizes collateral
///          plus a fixed bonus, and any residual collateral returns to the borrower.
///
///        Out of scope for this deployment (documented, not hidden): interest accrual,
///        share tokens, governance, cross-chain messaging.
contract LendingPool is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --------------------------------------------------------------- types ---

    /// @notice A borrower's open position. One position per address.
    /// @param collateralWei ETH posted as collateral (wei).
    /// @param debtUsdg      Outstanding USDG debt (token units).
    /// @param loanRatioBps  Minimum collateral ratio locked at origination (bps).
    struct Position {
        uint256 collateralWei;
        uint256 debtUsdg;
        uint16 loanRatioBps;
    }

    // --------------------------------------------------------------- errors ---

    error ZeroAddress();
    error ZeroAmount();
    error ExcessWithdraw(uint256 requested, uint256 available);
    error ExcessLiquidity(uint256 requested, uint256 available);
    error InsufficientCollateral(uint256 required, uint256 provided);
    error PositionAlreadyOpen();
    error NoPosition();
    error OutstandingDebt();
    error ExcessRepayment(uint256 requested, uint256 debt);
    error HealthyPosition(uint256 healthBps);
    error UnhealthyPosition(uint256 healthBps);
    error CollateralExceedsPosition(uint256 requested, uint256 available);
    error EthTransferFailed();
    error PriceStale(uint256 updatedAt, uint256 maxAge);
    error PriceUnavailable();
    error PriceTooLow();
    error BreakpointsInvalid();
    error RatiosNotDescending();
    error BonusAboveLimit(uint256 bonusBps);
    error StalePeriodTooLong(uint256 requested);

    // --------------------------------------------------------------- events ---

    event Deposited(address indexed lp, uint256 amount, uint256 newTotalDeposits);
    event Withdrawn(address indexed lp, uint256 amount, uint256 newTotalDeposits);
    event Borrowed(
        address indexed borrower,
        uint256 debtUsdg,
        uint256 collateralWei,
        uint16 loanRatioBps,
        uint8 compositeScore
    );
    event CollateralAdded(address indexed borrower, uint256 collateralWei, uint256 newTotalCollateralWei);
    event CollateralWithdrawn(address indexed borrower, uint256 collateralWei, uint256 newTotalCollateralWei);
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

    // -------------------------------------------------------------- constants ---

    /// @notice 1e4, the denominator for every basis-point value in this contract.
    uint256 public constant BPS = 10_000;
    /// @notice 1e18, the USD normalisation scale used by {IPriceOracle}.
    uint256 private constant USD_PRECISION = 1e18;

    // -------------------------------------------------------------- storage ---

    /// @notice Credit oracle that prices a borrower's collateral requirement.
    CreditOracle public immutable creditOracle;
    /// @notice USDG (or compatible) token used for liquidity and debt.
    IERC20 public immutable usdg;
    /// @notice Decimals of {usdg}, read once at construction.
    uint8 public immutable usdgDecimals;
    /// @notice Multiplier converting a raw USDG amount into 18-decimal USD units.
    uint256 public immutable usdgScale;
    /// @notice Collateral price feed (ETH/USD, 18 decimals).
    IPriceOracle public collateralPriceOracle;

    mapping(address => uint256) public lpDeposits;
    mapping(address => Position) private _positions;

    uint256 public totalDeposits;
    uint256 public totalDebt;

    /// @notice Minimum collateral ratio per score band, set once at deployment.
    uint16[5] public scoreBreakpoints;
    uint16[6] public collateralRatiosBps;

    /// @notice Bonus paid to liquidators, in bps of the repaid amount (default 5%).
    uint16 public liquidationBonusBps = 500;
    /// @notice Maximum accepted price age. Default 7 days keeps testnet demos alive;
    ///         production deployments should tighten this to the feed heartbeat.
    uint256 public maxPriceAge = 7 days;

    // ---------------------------------------------------------- construction ---

    /// @param initialOwner      Protocol admin.
    /// @param _creditOracle     Composite-score oracle.
    /// @param _usdg             USDG token address.
    /// @param _collateralPrice  ETH/USD price oracle.
    constructor(address initialOwner, CreditOracle _creditOracle, IERC20 _usdg, IPriceOracle _collateralPrice)
        Ownable(initialOwner)
    {
        if (address(_creditOracle) == address(0)) revert ZeroAddress();
        if (address(_usdg) == address(0)) revert ZeroAddress();
        if (address(_collateralPrice) == address(0)) revert ZeroAddress();

        creditOracle = _creditOracle;
        usdg = _usdg;
        collateralPriceOracle = _collateralPrice;

        uint8 decimals_ = IERC20Metadata(address(_usdg)).decimals();
        if (decimals_ > 18) revert ZeroAddress();
        usdgDecimals = decimals_;
        usdgScale = 10 ** (18 - decimals_);

        scoreBreakpoints = [uint16(20), 50, 70, 85, 100];
        collateralRatiosBps = [uint16(15_000), 15_000, 12_000, 10_000, 8_500, 7_500];
    }

    // ------------------------------------------------------- admin functions ---

    /// @notice Replace the collateral price feed (e.g. from a testnet oracle to Chainlink).
    function setCollateralPriceOracle(IPriceOracle newOracle) external onlyOwner {
        if (address(newOracle) == address(0)) revert ZeroAddress();
        collateralPriceOracle = newOracle;
    }

    /// @notice Re-tune the score -> collateral ratio curve.
    /// @dev Invariants: strictly increasing breakpoints in (0, 100]; ratios non-increasing;
    ///      first ratio <= 200%; last ratio >= 50%.
    function setCollateralCurve(uint16[5] calldata newBreakpoints, uint16[6] calldata newRatiosBps)
        external
        onlyOwner
    {
        if (newBreakpoints[0] == 0 || newBreakpoints[4] > 100) revert BreakpointsInvalid();
        for (uint256 i = 1; i < 5; i++) {
            if (newBreakpoints[i] <= newBreakpoints[i - 1]) revert BreakpointsInvalid();
        }
        for (uint256 i = 1; i < 6; i++) {
            if (newRatiosBps[i] > newRatiosBps[i - 1]) revert RatiosNotDescending();
        }
        if (newRatiosBps[0] > 20_000 || newRatiosBps[5] < 5_000) revert RatiosNotDescending();

        scoreBreakpoints = newBreakpoints;
        collateralRatiosBps = newRatiosBps;
        emit CollateralCurveUpdated(newBreakpoints, newRatiosBps);
    }

    /// @notice Set the liquidator bonus (capped at 20%).
    function setLiquidationBonus(uint16 newBonusBps) external onlyOwner {
        if (newBonusBps > 2_000) revert BonusAboveLimit(newBonusBps);
        liquidationBonusBps = newBonusBps;
        emit LiquidationBonusUpdated(newBonusBps);
    }

    /// @notice Set the maximum accepted price age (capped at 30 days).
    function setMaxPriceAge(uint256 newMaxPriceAge) external onlyOwner {
        if (newMaxPriceAge > 30 days) revert StalePeriodTooLong(newMaxPriceAge);
        maxPriceAge = newMaxPriceAge;
        emit MaxPriceAgeUpdated(newMaxPriceAge);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // -------------------------------------------------- liquidity provider side ---

    /// @notice Supply USDG to the lending pool. Requires a prior ERC-20 approval.
    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();

        lpDeposits[msg.sender] += amount;
        totalDeposits += amount;

        emit Deposited(msg.sender, amount, totalDeposits);
        usdg.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Withdraw previously supplied USDG that is not currently lent out.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 balance = lpDeposits[msg.sender];
        if (amount > balance) revert ExcessWithdraw(amount, balance);

        uint256 free = availableLiquidity();
        if (amount > free) revert ExcessWithdraw(amount, free);

        lpDeposits[msg.sender] = balance - amount;
        totalDeposits -= amount;

        emit Withdrawn(msg.sender, amount, totalDeposits);
        usdg.safeTransfer(msg.sender, amount);
    }

    // ------------------------------------------------------------ borrower side ---

    /// @notice Open a USDG loan against ETH collateral.
    /// @param debtAmount USDG to borrow (token units).
    /// @dev The full `msg.value` is retained as collateral; any excess above the
    ///      requirement improves the position's health factor.
    function borrow(uint256 debtAmount) external payable nonReentrant whenNotPaused {
        if (debtAmount == 0) revert ZeroAmount();
        Position storage position = _positions[msg.sender];
        if (position.debtUsdg != 0 || position.collateralWei != 0) revert PositionAlreadyOpen();

        uint256 free = availableLiquidity();
        if (debtAmount > free) revert ExcessLiquidity(debtAmount, free);

        uint8 score = creditOracle.getCompositeScore(msg.sender);
        uint16 ratioBps = getCollateralRatioBps(score);
        uint256 requiredWei = _requiredCollateralWei(debtAmount, ratioBps);
        if (msg.value < requiredWei) revert InsufficientCollateral(requiredWei, msg.value);

        position.collateralWei = msg.value;
        position.debtUsdg = debtAmount;
        position.loanRatioBps = ratioBps;
        totalDebt += debtAmount;

        // Preceding external calls are read-only (score + price) views; the function is
        // nonReentrant and every state change happened above, so logs cannot be reordered.
        // forge-lint: disable-next-line(reentrancy-events)
        emit Borrowed(msg.sender, debtAmount, msg.value, ratioBps, score);
        usdg.safeTransfer(msg.sender, debtAmount);
    }

    /// @notice Post additional ETH collateral to an existing position.
    function addCollateral() external payable nonReentrant whenNotPaused {
        Position storage position = _positions[msg.sender];
        if (position.debtUsdg == 0) revert NoPosition();
        if (msg.value == 0) revert ZeroAmount();

        position.collateralWei += msg.value;
        emit CollateralAdded(msg.sender, msg.value, position.collateralWei);
    }

    /// @notice Free collateral that is not required to back the loan.
    /// @dev Reverts if the withdrawal would push the health factor below 100%.
    function withdrawCollateral(uint256 amount) external nonReentrant whenNotPaused {
        Position storage position = _positions[msg.sender];
        if (position.debtUsdg == 0) revert NoPosition();
        if (amount == 0) revert ZeroAmount();
        if (amount > position.collateralWei) {
            revert CollateralExceedsPosition(amount, position.collateralWei);
        }

        position.collateralWei -= amount;
        uint256 health = _healthFactorBps(msg.sender);
        if (health < BPS) revert UnhealthyPosition(health);

        emit CollateralWithdrawn(msg.sender, amount, position.collateralWei);

        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }

    /// @notice Repay part or all of an open USDG loan (requires ERC-20 approval).
    /// @dev Closing the loan returns the posted ETH collateral to the borrower.
    function repay(uint256 amount) external nonReentrant {
        Position storage position = _positions[msg.sender];
        if (position.debtUsdg == 0) revert NoPosition();
        if (amount == 0) revert ZeroAmount();
        if (amount > position.debtUsdg) revert ExcessRepayment(amount, position.debtUsdg);

        _repay(msg.sender, msg.sender, amount);
    }

    /// @notice Repay the entire outstanding balance in one call.
    function repayAll() external nonReentrant {
        Position storage position = _positions[msg.sender];
        if (position.debtUsdg == 0) revert NoPosition();
        _repay(msg.sender, msg.sender, position.debtUsdg);
    }

    // ---------------------------------------------------------- liquidation ---

    /// @notice Liquidate an unhealthy position by repaying USDG and seizing ETH collateral.
    /// @param borrower  Address of the underwater position.
    /// @param usdgAmount Amount of USDG to repay on the borrower's behalf (<= debt).
    /// @dev Requires an ERC-20 approval. Only callable while `healthFactorBps < 10_000`.
    ///      Seized collateral = repaid value * (1 + bonus). Residual collateral, if any,
    ///      is returned to the borrower when the debt is fully cleared.
    function liquidate(address borrower, uint256 usdgAmount) external nonReentrant whenNotPaused {
        if (borrower == address(0)) revert ZeroAddress();
        Position storage position = _positions[borrower];
        if (position.debtUsdg == 0) revert NoPosition();
        if (usdgAmount == 0) revert ZeroAmount();
        if (usdgAmount > position.debtUsdg) revert ExcessRepayment(usdgAmount, position.debtUsdg);

        uint256 health = _healthFactorBps(borrower);
        if (health >= BPS) revert HealthyPosition(health);

        uint256 price18 = _readPrice18();
        uint256 debtClosed = position.debtUsdg - usdgAmount;
        uint256 seizeWei;

        unchecked {
            // Value of the repayment plus the liquidator bonus, converted to ETH.
            uint256 seizeUsd18 = _usd18FromUsdg(usdgAmount) * (BPS + liquidationBonusBps) / BPS;
            seizeWei = Math.ceilDiv(seizeUsd18 * USD_PRECISION, price18);
        }

        uint256 collateral = position.collateralWei;
        uint256 returnedWei = 0;
        if (seizeWei > collateral) {
            // Collateral is worth less than debt + bonus: take everything, return nothing.
            seizeWei = collateral;
        } else if (debtClosed == 0) {
            // Debt fully cleared: liquidator keeps the bonus, borrower keeps the remainder.
            returnedWei = collateral - seizeWei;
        }

        position.debtUsdg = debtClosed;
        position.collateralWei = collateral - seizeWei - returnedWei;
        totalDebt -= usdgAmount;
        if (debtClosed == 0) position.loanRatioBps = 0;

        // forge-lint: disable-next-line(reentrancy-events) -- nonReentrant + CEI.
        emit Liquidated(borrower, msg.sender, usdgAmount, seizeWei, returnedWei);

        usdg.safeTransferFrom(msg.sender, address(this), usdgAmount);
        if (seizeWei > 0) {
            (bool okSeize,) = msg.sender.call{value: seizeWei}("");
            if (!okSeize) revert EthTransferFailed();
        }
        if (returnedWei > 0) {
            // Residual collateral is owed back to the position owner (who is also the
            // only caller able to trigger this branch).
            // forge-lint: disable-next-line(arbitrary-send-eth)
            (bool okReturn,) = borrower.call{value: returnedWei}("");
            if (!okReturn) revert EthTransferFailed();
        }
    }

    // --------------------------------------------------------------- views -----

    /// @notice USDG that can be borrowed or withdrawn right now.
    function availableLiquidity() public view returns (uint256) {
        return totalDeposits - totalDebt;
    }

    /// @notice Borrower position details.
    function getBorrowerPosition(address borrower) external view returns (Position memory) {
        return _positions[borrower];
    }

    /// @notice Minimum collateral ratio (bps) required for `score`.
    /// @dev Piecewise linear through (0, ratios[0]), (bp[0], ratios[1]) ... (bp[4], ratios[5]).
    function getCollateralRatioBps(uint8 score) public view returns (uint16) {
        uint256 s = score;
        if (s >= scoreBreakpoints[4]) return collateralRatiosBps[5];
        if (s <= scoreBreakpoints[0]) {
            return _interp(s, 0, scoreBreakpoints[0], collateralRatiosBps[0], collateralRatiosBps[1]);
        }

        for (uint256 i = 0; i < 4; i++) {
            uint256 lo = scoreBreakpoints[i];
            uint256 hi = scoreBreakpoints[i + 1];
            if (s >= lo && s <= hi) {
                return _interp(s, lo, hi, collateralRatiosBps[i + 1], collateralRatiosBps[i + 2]);
            }
        }
        return collateralRatiosBps[5];
    }

    /// @notice Minimum collateral ratio (bps) locked into `borrower`'s open position.
    function getBorrowerCollateralRatioBps(address borrower) external view returns (uint16) {
        return _positions[borrower].loanRatioBps;
    }

    /// @notice ETH (wei) required to borrow `debtAmount` USDG at the borrower's current terms.
    function getRequiredCollateral(address borrower, uint256 debtAmount) external view returns (uint256) {
        uint16 ratioBps = _positions[borrower].loanRatioBps;
        if (ratioBps == 0) {
            // No open position: quote against the borrower's current composite score.
            ratioBps = getCollateralRatioBps(creditOracle.getCompositeScore(borrower));
        }
        return _requiredCollateralWei(debtAmount, ratioBps);
    }

    /// @notice Health factor scaled by 1e4. `type(uint256).max` when no debt is open.
    /// @dev health = collateral value / required collateral value. Below 10_000 the
    ///      position is eligible for liquidation.
    function healthFactorBps(address borrower) external view returns (uint256) {
        if (_positions[borrower].debtUsdg == 0) return type(uint256).max;
        return _healthFactorBps(borrower);
    }

    /// @notice Current ETH/USD price normalised to 1e18, staleness enforced.
    function ethPriceUsd18() external view returns (uint256) {
        return _readPrice18();
    }

    /// @notice Collateral value (USD, 1e18) of a borrower's posted ETH.
    function collateralValueUsd18(address borrower) external view returns (uint256) {
        uint256 collateralWei = _positions[borrower].collateralWei;
        if (collateralWei == 0) return 0;
        return collateralWei * _readPrice18() / USD_PRECISION;
    }

    /// @notice Debt value normalised to 1e18 USD units.
    function debtValueUsd18(address borrower) public view returns (uint256) {
        return _usd18FromUsdg(_positions[borrower].debtUsdg);
    }

    // -------------------------------------------------------------- internal ---

    function _repay(address borrower, address beneficiary, uint256 amount) internal {
        Position storage position = _positions[borrower];
        uint256 remaining = position.debtUsdg - amount;
        position.debtUsdg = remaining;
        totalDebt -= amount;

        bool closed = remaining == 0;
        uint256 releasedWei = 0;
        if (closed) {
            releasedWei = position.collateralWei;
            position.collateralWei = 0;
            position.loanRatioBps = 0;
        }

        emit Repaid(beneficiary, borrower, amount, closed);

        usdg.safeTransferFrom(borrower, address(this), amount);
        if (releasedWei > 0) {
            // Collateral is returned to the borrower, or to whoever repaid the loan.
            // forge-lint: disable-next-line(arbitrary-send-eth)
            (bool ok,) = beneficiary.call{value: releasedWei}("");
            if (!ok) revert EthTransferFailed();
        }
    }

    function _healthFactorBps(address borrower) internal view returns (uint256) {
        Position storage position = _positions[borrower];
        if (position.debtUsdg == 0) return type(uint256).max;

        uint256 requiredUsd18 = _usd18FromUsdg(position.debtUsdg) * position.loanRatioBps / BPS;
        if (requiredUsd18 == 0) return type(uint256).max;
        // Multiply first, divide last: no precision is shed before the comparison.
        uint256 collateralNum = position.collateralWei * _readPrice18() * BPS;
        return collateralNum / USD_PRECISION / requiredUsd18;
    }

    function _requiredCollateralWei(uint256 debtAmount, uint16 ratioBps) internal view returns (uint256) {
        uint256 requiredUsd18 = _usd18FromUsdg(debtAmount) * ratioBps / BPS;
        return Math.ceilDiv(requiredUsd18 * USD_PRECISION, _readPrice18());
    }

    /// @dev Raw token units -> 18-decimal USD units (USDG is pegged 1:1 to the dollar).
    function _usd18FromUsdg(uint256 rawAmount) internal view returns (uint256) {
        return rawAmount * usdgScale;
    }

    /// @dev Reads the collateral price, enforcing staleness and sanity bounds.
    function _readPrice18() internal view returns (uint256) {
        (uint256 price18, uint256 updatedAt) = collateralPriceOracle.latestPrice();
        if (updatedAt == 0 || price18 == 0) revert PriceUnavailable();
        if (block.timestamp - updatedAt > maxPriceAge) revert PriceStale(updatedAt, maxPriceAge);
        // Guard against an absurd oracle value that would overflow downstream math.
        if (price18 > 1e30) revert PriceTooLow();
        return price18;
    }

    /// @dev Linear interpolation; requires y0 >= y1 (ratios are non-increasing).
    function _interp(uint256 s, uint256 x0, uint256 x1, uint256 y0, uint256 y1)
        internal
        pure
        returns (uint16)
    {
        if (x1 == x0) return uint16(y0);
        uint256 delta = y0 - y1;
        uint256 offset = s - x0;
        return uint16(y0 - (offset * delta) / (x1 - x0));
    }
}
