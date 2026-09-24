// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDG
/// @notice Testnet stand-in for Paxos' Global Dollar (USDG).
/// @dev Mirrors the production token's 6 decimals so the pool's decimal normalisation is
///      exercised exactly as it will be against the real asset. **Mint is open**: this
///      contract must never be used on a production network.
contract MockUSDG is ERC20 {
    uint8 private constant _DECIMALS = 6;

    constructor() ERC20("Global Dollar (Testnet)", "USDG") {}

    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }

    /// @notice Faucet: anyone can mint testnet USDG.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
