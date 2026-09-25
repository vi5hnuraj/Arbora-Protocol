// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {CreditOracle} from "../src/CreditOracle.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {OffchainAttestationRegistry} from "../src/OffchainAttestationRegistry.sol";
import {AdminPriceOracle} from "../src/oracles/AdminPriceOracle.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {IPriceOracle} from "../src/interfaces/IPriceOracle.sol";

/// @title Deploy
/// @notice Deploys the full Arbora stack.
///
/// Environment
///   PRIVATE_KEY            deployer key (required)
///   USDG_TOKEN_ADDRESS     optional: existing USDG (e.g. Paxos USDG on Robinhood Chain).
///                          When unset a MockUSDG is deployed for testnets.
///   PRICE_ORACLE_ADDRESS   optional: existing IPriceOracle (e.g. ChainlinkPriceOracle).
///                          When unset an AdminPriceOracle is deployed for testnets.
///   ETH_USD_PRICE_E18      optional: seed price for the admin oracle (default 2000e18).
///
/// Usage
///   forge script script/Deploy.s.sol:Deploy --rpc-url $ARBITRUM_SEPOLIA_RPC --broadcast --verify
contract Deploy is Script {
    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(privateKey);

        vm.startBroadcast(privateKey);

        // --- USDG (debt + LP asset) ---
        address usdgAddress = vm.envOr("USDG_TOKEN_ADDRESS", address(0));
        if (usdgAddress == address(0)) {
            usdgAddress = address(new MockUSDG());
            console.log("MockUSDG deployed (6 decimals, testnet stand-in for Paxos USDG):", usdgAddress);
        } else {
            console.log("Using existing USDG token:", usdgAddress);
        }

        // --- Collateral price feed ---
        address priceOracleAddress = vm.envOr("PRICE_ORACLE_ADDRESS", address(0));
        if (priceOracleAddress == address(0)) {
            uint256 seedPrice = vm.envOr("ETH_USD_PRICE_E18", uint256(2000e18));
            priceOracleAddress = address(new AdminPriceOracle(deployer, seedPrice));
            console.log("AdminPriceOracle deployed (testnet only):", priceOracleAddress);
        } else {
            console.log("Using existing price oracle:", priceOracleAddress);
        }

        // --- Core protocol ---
        OffchainAttestationRegistry registry = new OffchainAttestationRegistry(deployer);
        CreditOracle oracle = new CreditOracle(deployer, registry);
        registry.setCreditOracle(address(oracle));
        LendingPool pool =
            new LendingPool(deployer, oracle, IERC20(usdgAddress), IPriceOracle(priceOracleAddress));

        vm.stopBroadcast();

        console.log("");
        console.log("=== Arbora Protocol deployed ===");
        console.log("ATTESTATION_REGISTRY_ADDRESS", address(registry));
        console.log("CREDIT_ORACLE_ADDRESS       ", address(oracle));
        console.log("LENDING_POOL_ADDRESS        ", address(pool));
        console.log("USDG_TOKEN_ADDRESS          ", usdgAddress);
        console.log("PRICE_ORACLE_ADDRESS        ", priceOracleAddress);
    }
}
