// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IPriceOracle
/// @notice Minimal price oracle interface consumed by {LendingPool}.
/// @dev Implementations must return the price of the collateral asset (ETH) denominated
///      in USD, normalised to 18 decimals, together with the timestamp of the last update
///      so callers can enforce their own staleness policy.
interface IPriceOracle {
    /// @notice USD price of one unit of collateral (18 decimals).
    /// @return priceUsd18 Price scaled to 1e18 (e.g. 2500e18 for $2,500).
    /// @return updatedAt Unix timestamp of the most recent price update.
    function latestPrice() external view returns (uint256 priceUsd18, uint256 updatedAt);

    /// @notice Human readable description of the feed ("ETH / USD").
    function description() external view returns (string memory);
}
