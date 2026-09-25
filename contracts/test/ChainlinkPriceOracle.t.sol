// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ArboraTestBase} from "./TestHelpers.sol";
import {ChainlinkPriceOracle} from "../src/oracles/ChainlinkPriceOracle.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {AdminPriceOracle} from "../src/oracles/AdminPriceOracle.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {MockAggregator} from "../src/mocks/MockAggregator.sol";

contract ChainlinkPriceOracleTest is ArboraTestBase {
    function test_ScalesEightDecimalFeedTo1e18() public {
        MockAggregator feed = new MockAggregator(8, 2_500e8); // $2,500
        ChainlinkPriceOracle oracle_ = new ChainlinkPriceOracle(IAggregatorV3(address(feed)));

        (uint256 price, uint256 updatedAt) = oracle_.latestPrice();
        assertEq(price, 2_500e18);
        assertEq(updatedAt, block.timestamp);
        assertEq(oracle_.feedDecimals(), 8);
    }

    function test_ScalesEighteenDecimalFeed() public {
        MockAggregator feed = new MockAggregator(18, 1_234.5e18);
        ChainlinkPriceOracle oracle_ = new ChainlinkPriceOracle(IAggregatorV3(address(feed)));
        assertEq(_price(oracle_), 1_234.5e18);
    }

    function test_RevertsOnNegativeAnswer() public {
        MockAggregator feed = new MockAggregator(8, -1e8);
        ChainlinkPriceOracle oracle_ = new ChainlinkPriceOracle(IAggregatorV3(address(feed)));
        vm.expectRevert(ChainlinkPriceOracle.InvalidPrice.selector);
        oracle_.latestPrice();
    }

    function test_RevertsOnZeroAnswer() public {
        MockAggregator feed = new MockAggregator(8, 0);
        ChainlinkPriceOracle oracle_ = new ChainlinkPriceOracle(IAggregatorV3(address(feed)));
        vm.expectRevert(ChainlinkPriceOracle.InvalidPrice.selector);
        oracle_.latestPrice();
    }

    function test_RevertsOnZeroFeedAddress() public {
        vm.expectRevert(ChainlinkPriceOracle.ZeroFeed.selector);
        new ChainlinkPriceOracle(IAggregatorV3(address(0)));
    }

    function test_DescriptionComesFromFeed() public {
        MockAggregator feed = new MockAggregator(8, 2_000e8);
        ChainlinkPriceOracle oracle_ = new ChainlinkPriceOracle(IAggregatorV3(address(feed)));
        assertEq(oracle_.description(), "MOCK / USD");
    }

    /// @notice The pool must accept the adapter end-to-end and enforce its own staleness.
    function test_PoolAcceptsChainlinkAdapter() public {
        MockAggregator feed = new MockAggregator(8, 2_000e8);
        ChainlinkPriceOracle adapter = new ChainlinkPriceOracle(IAggregatorV3(address(feed)));

        vm.prank(admin);
        pool.setCollateralPriceOracle(adapter);

        assertEq(pool.ethPriceUsd18(), 2_000e18);
        _seedPool(10_000);

        // Feed goes stale beyond the pool's policy -> borrow reverts.
        feed.setAnswer(2_000e8, block.timestamp);
        vm.warp(block.timestamp + 8 days);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(LendingPool.PriceStale.selector, block.timestamp - 8 days, 7 days)
        );
        pool.borrow{value: 1 ether}(1);
    }

    function test_AdminOracleExposesFreshTimestamp() public view {
        (uint256 price, uint256 updatedAt) = priceOracle.latestPrice();
        assertEq(price, ETH_PRICE);
        assertEq(updatedAt, block.timestamp);
        assertEq(priceOracle.description(), "Admin-fed ETH / USD (testnet)");
    }

    function _price(ChainlinkPriceOracle oracle_) internal view returns (uint256 price) {
        (price,) = oracle_.latestPrice();
    }
}
