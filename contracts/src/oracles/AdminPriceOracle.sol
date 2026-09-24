// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

/// @title AdminPriceOracle
/// @author Arbora Protocol
/// @notice Owner-fed price oracle intended **for testnets and local development only**.
/// @dev Chainlink ETH/USD feeds are not available on every testnet, so this implementation
///      lets the deployer publish a price directly. A production deployment must point
///      {LendingPool} at {ChainlinkPriceOracle} instead — swap the feed via
///      `LendingPool.setCollateralPriceOracle`.
contract AdminPriceOracle is IPriceOracle, Ownable {
    error ZeroPrice();

    event PriceUpdated(uint256 priceUsd18);

    uint256 public priceUsd18;
    uint256 public updatedAt;

    constructor(address initialOwner, uint256 initialPriceUsd18) Ownable(initialOwner) {
        if (initialPriceUsd18 == 0) revert ZeroPrice();
        priceUsd18 = initialPriceUsd18;
        updatedAt = block.timestamp;
    }

    /// @notice Publish a fresh ETH/USD price (1e18 scale).
    function setPrice(uint256 newPriceUsd18) external onlyOwner {
        if (newPriceUsd18 == 0) revert ZeroPrice();
        priceUsd18 = newPriceUsd18;
        updatedAt = block.timestamp;
        emit PriceUpdated(newPriceUsd18);
    }

    /// @inheritdoc IPriceOracle
    function latestPrice() external view returns (uint256, uint256) {
        return (priceUsd18, updatedAt);
    }

    /// @inheritdoc IPriceOracle
    function description() public pure returns (string memory) {
        return "Admin-fed ETH / USD (testnet)";
    }
}
