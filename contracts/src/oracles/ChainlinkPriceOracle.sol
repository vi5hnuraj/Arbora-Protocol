// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

/// @title ChainlinkPriceOracle
/// @author Arbora Protocol
/// @notice Adapter that exposes a Chainlink AggregatorV3 feed through {IPriceOracle},
///         normalising the feed's decimals to 1e18.
/// @dev Production implementation. Guards against a negative or zero answer at read time;
///      staleness is enforced by {LendingPool} using its own `maxPriceAge` policy.
contract ChainlinkPriceOracle is IPriceOracle {
    error ZeroFeed();
    error InvalidPrice();

    IAggregatorV3 public immutable feed;
    uint8 public immutable feedDecimals;

    constructor(IAggregatorV3 _feed) {
        if (address(_feed) == address(0)) revert ZeroFeed();
        feed = _feed;
        uint8 decimals_ = _feed.decimals();
        if (decimals_ > 18) revert InvalidPrice();
        feedDecimals = decimals_;
    }

    /// @inheritdoc IPriceOracle
    function latestPrice() external view returns (uint256 priceUsd18, uint256 updatedAt) {
        (, int256 answer,, uint256 updated,) = feed.latestRoundData();
        if (answer <= 0) revert InvalidPrice();
        priceUsd18 = uint256(answer) * (10 ** (18 - feedDecimals));
        updatedAt = updated;
    }

    /// @inheritdoc IPriceOracle
    function description() external view returns (string memory) {
        return feed.description();
    }
}
