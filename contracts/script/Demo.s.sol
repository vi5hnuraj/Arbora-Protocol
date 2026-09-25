// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {CreditOracle} from "../src/CreditOracle.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {OffchainAttestationRegistry} from "../src/OffchainAttestationRegistry.sol";

/// @title Demo
/// @notice Four-beat onchain demo, run against an already-deployed stack:
///         0. seed USDG liquidity,
///         1. publish an onchain-only score -> thin-file composite (capped terms),
///         2. attach an offchain attestation -> composite jumps, required ratio falls,
///         3. open a real ETH-collateralised USDG loan on the improved terms.
///
/// @dev The broadcaster *is* the demo subject. `PRIVATE_KEY` must be the owner of the
///      registry/oracle/pool (the deployer key) so the score pushes and the attestation
///      are signed by the one key you already hold — no private keys live in this file.
///      The wallet needs testnet ETH for gas and collateral; the script sizes the loan
///      to whatever the balance can support and reverts with a clear message if empty.
///
/// Environment
///   PRIVATE_KEY                     required; deployer/owner key, funded with testnet ETH
///   ATTESTATION_REGISTRY_ADDRESS    required
///   CREDIT_ORACLE_ADDRESS           required
///   LENDING_POOL_ADDRESS            required
///   USDG_TOKEN_ADDRESS              required (mock is mintable, real USDG must be funded)
///
/// Usage
///   forge script script/Demo.s.sol:Demo --rpc-url $ARBITRUM_SEPOLIA_RPC --broadcast
contract Demo is Script {
    bytes32 constant DEMO_IDENTITY = keccak256("arbora-demo-identity-001");

    /// @dev Kept back from the demo balance so every broadcast tx can pay gas.
    uint256 constant GAS_MARGIN_WEI = 0.004 ether;
    /// @dev Ceiling on the demo loan so the narrative stays at "1,000 USDG or less".
    uint256 constant MAX_DEBT = 1_000e6;
    uint256 constant MIN_DEBT = 1e6;

    struct Ctx {
        OffchainAttestationRegistry registry;
        CreditOracle oracle;
        LendingPool pool;
        IERC20 usdg;
        address demo;
    }

    function run() external {
        Ctx memory ctx = Ctx({
            registry: OffchainAttestationRegistry(payable(vm.envAddress("ATTESTATION_REGISTRY_ADDRESS"))),
            oracle: CreditOracle(payable(vm.envAddress("CREDIT_ORACLE_ADDRESS"))),
            pool: LendingPool(payable(vm.envAddress("LENDING_POOL_ADDRESS"))),
            usdg: IERC20(vm.envAddress("USDG_TOKEN_ADDRESS")),
            demo: vm.addr(vm.envUint("PRIVATE_KEY"))
        });

        // A re-run starts with the attestation already in place, so the improvement
        // assertions only make sense on the first pass.
        bool firstRun = !ctx.registry.hasAttestation(ctx.demo);

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        _seedLiquidity(ctx);
        uint8 compositeBefore = _pushOnchainScore(ctx);
        uint16 ratioBefore = _pushAttestation(ctx);
        _borrow(ctx);

        vm.stopBroadcast();

        if (firstRun) {
            uint8 compositeAfter = ctx.oracle.getCompositeScore(ctx.demo);
            uint16 ratioAfter = ctx.pool.getCollateralRatioBps(compositeAfter);
            require(compositeAfter > compositeBefore, "attestation must improve the composite");
            require(ratioAfter < ratioBefore, "terms must improve");
        }
    }

    // ------------------------------------------------------------- beats ---

    /// @dev Beat 0: fund the demo wallet from the mock faucet and supply the pool.
    function _seedLiquidity(Ctx memory ctx) internal {
        try MockUSDG(address(ctx.usdg)).mint(ctx.demo, 200_000e6) {} catch {}
        ctx.usdg.approve(address(ctx.pool), type(uint256).max);
        if (ctx.pool.lpDeposits(ctx.demo) == 0) {
            require(ctx.usdg.balanceOf(ctx.demo) >= 50_000e6, "demo wallet holds no USDG");
            ctx.pool.deposit(50_000e6);
            console.log("[0] Seeded pool with 50,000 USDG");
        }
    }

    /// @dev Beat 1: onchain-only score. Returns the pre-attestation composite.
    function _pushOnchainScore(Ctx memory ctx) internal returns (uint8 compositeBefore) {
        ctx.oracle.setOnchainScore(ctx.demo, 98, 5);
        compositeBefore = ctx.oracle.getCompositeScore(ctx.demo);
        uint16 ratioBefore = ctx.pool.getCollateralRatioBps(compositeBefore);
        console.log("[1] Onchain score 98 -> composite", compositeBefore);
        console.log("    required collateral ratio (bps):", ratioBefore);
        console.log("    collateral for 1,000 USDG (wei):", ctx.pool.getRequiredCollateral(ctx.demo, 1_000e6));
    }

    /// @dev Beat 2: attach an offchain attestation and re-push. Returns the prior ratio.
    function _pushAttestation(Ctx memory ctx) internal returns (uint16 ratioBefore) {
        uint8 compositeBefore = ctx.oracle.getCompositeScore(ctx.demo);
        ratioBefore = ctx.pool.getCollateralRatioBps(compositeBefore);

        ctx.registry
            .setAttestation(
                ctx.demo,
                OffchainAttestationRegistry.OffchainAttestation({
                    identityHash: DEMO_IDENTITY,
                    paymentHistoryScore: 90,
                    creditUtilizationPct: 20,
                    creditHistoryMonths: 84,
                    numberOfAccounts: 5,
                    hardInquiries: 1,
                    ficoScore: 780,
                    isVerified: true,
                    timestamp: 0
                })
            );
        // Re-push seeds the identity's historical score for sybil protection.
        ctx.oracle.setOnchainScore(ctx.demo, 98, 5);

        uint8 compositeAfter = ctx.oracle.getCompositeScore(ctx.demo);
        console.log("[2] + FICO 780 attestation -> composite", compositeAfter);
        console.log("    required collateral ratio (bps):", ctx.pool.getCollateralRatioBps(compositeAfter));
        console.log("    collateral for 1,000 USDG (wei):", ctx.pool.getRequiredCollateral(ctx.demo, 1_000e6));
    }

    /// @dev Beat 3: open a real loan sized to what this wallet can post.
    function _borrow(Ctx memory ctx) internal {
        if (ctx.pool.getBorrowerPosition(ctx.demo).debtUsdg != 0) {
            console.log("[3] Loan already open - skipping borrow");
            return;
        }

        uint256 spendable = ctx.demo.balance > GAS_MARGIN_WEI ? ctx.demo.balance - GAS_MARGIN_WEI : 0;
        uint256 debt = _maxAffordableDebt(ctx, spendable);
        if (debt > MAX_DEBT) debt = MAX_DEBT;
        require(debt >= MIN_DEBT, "fund the demo wallet with ~0.05 testnet ETH");

        uint256 collateral = ctx.pool.getRequiredCollateral(ctx.demo, debt);
        collateral += collateral / 20; // +5% health buffer
        require(collateral + GAS_MARGIN_WEI <= ctx.demo.balance, "demo balance too low");

        ctx.pool.borrow{value: collateral}(debt);
        console.log("[3] Borrowed USDG against ETH collateral:");
        console.logUint(debt);
        console.log("    collateral posted (wei):", collateral);
        console.log("    health factor (bps):", ctx.pool.healthFactorBps(ctx.demo));
    }

    // ------------------------------------------------------------ helpers ---

    /// @notice Largest debt (USDG raw units) whose required collateral still fits in
    ///         `spendableWei`, leaving a 15% cushion over the minimum ratio.
    function _maxAffordableDebt(Ctx memory ctx, uint256 spendableWei) internal view returns (uint256) {
        if (spendableWei == 0) return 0;
        uint16 ratioBps = ctx.pool.getCollateralRatioBps(ctx.oracle.getCompositeScore(ctx.demo));
        if (ratioBps == 0) return 0;

        uint256 collateralUsd18 = spendableWei * ctx.pool.ethPriceUsd18() / 1e18;
        uint256 maxDebtUsd18 = collateralUsd18 * 10_000 / ratioBps;
        maxDebtUsd18 = maxDebtUsd18 * 100 / 115;
        return maxDebtUsd18 / ctx.pool.usdgScale();
    }
}
