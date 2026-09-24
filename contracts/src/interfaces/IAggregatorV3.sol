// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IAggregatorV3
/// @notice Subset of the Chainlink AggregatorV3 interface used by {ChainlinkPriceOracle}.
/// @dev Mirrors `@chainlink/contracts` AggregatorV3Interface so the protocol does not take
///      a dependency on the full Chainlink package.
interface IAggregatorV3 {
    function decimals() external view returns (uint8);

    function description() external view returns (string memory);

    function version() external view returns (uint256);

    function getRoundData(uint80 _roundId)
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
