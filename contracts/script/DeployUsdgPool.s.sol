// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {CreditOracle} from "../src/CreditOracle.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {IPriceOracle} from "../src/interfaces/IPriceOracle.sol";

/// @title DeployUsdgPool
/// @notice Deploys ONLY a new LendingPool backed by an existing USDG token
///         (e.g. Paxos USDG on Arbitrum Sepolia), reusing the live
///         CreditOracle, AttestationRegistry and price oracle.
///         Unlike Deploy.s.sol this never touches the registry/oracle,
///         so onchain scores and attestations are preserved.
///
/// Environment
///   PRIVATE_KEY            deployer key (required)
///   USDG_TOKEN_ADDRESS     existing USDG token (required)
///   CREDIT_ORACLE_ADDRESS  existing CreditOracle (required)
///   PRICE_ORACLE_ADDRESS   existing IPriceOracle (required)
///
/// Usage
///   forge script script/DeployUsdgPool.s.sol:DeployUsdgPool \
///     --rpc-url $ARBITRUM_SEPOLIA_RPC --broadcast
contract DeployUsdgPool is Script {
    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(privateKey);

        address usdgAddress = vm.envAddress("USDG_TOKEN_ADDRESS");
        address oracleAddress = vm.envAddress("CREDIT_ORACLE_ADDRESS");
        address priceOracleAddress = vm.envAddress("PRICE_ORACLE_ADDRESS");

        vm.startBroadcast(privateKey);
        LendingPool pool =
            new LendingPool(deployer, CreditOracle(oracleAddress), IERC20(usdgAddress), IPriceOracle(priceOracleAddress));
        vm.stopBroadcast();

        console.log("");
        console.log("=== LendingPool (real USDG) deployed ===");
        console.log("LENDING_POOL_ADDRESS", address(pool));
        console.log("USDG_TOKEN_ADDRESS  ", usdgAddress);
        console.log("CREDIT_ORACLE       ", oracleAddress);
        console.log("PRICE_ORACLE        ", priceOracleAddress);
    }
}
