// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IRouterClient} from "../../src/interfaces/IRouterClient.sol";
import {Client} from "../../src/interfaces/Client.sol";
import {IAny2EVMMessageReceiver} from "../../src/interfaces/IAny2EVMMessageReceiver.sol";

contract MockCCIPRouter is IRouterClient {
    uint256 public fee = 0.01 ether;
    mapping(bytes32 => bool) public sentMessages;

    function setFee(uint256 _fee) external {
        fee = _fee;
    }

    function isChainSupported(uint64) external pure returns (bool) {
        return true;
    }

    function getSupportedTokens(uint64) external pure returns (address[] memory) {
        return new address[](0);
    }

    function getFee(uint64, Client.EVM2AnyMessage memory) external view returns (uint256) {
        return fee;
    }

    function ccipSend(
        uint64 destinationChainSelector,
        Client.EVM2AnyMessage calldata message
    ) external payable returns (bytes32) {
        if (msg.value < fee) revert InsufficientFeeTokenAmount();

        bytes32 messageId = keccak256(abi.encode(destinationChainSelector, message, block.timestamp));
        sentMessages[messageId] = true;

        return messageId;
    }

    function deliverMessage(
        address receiver,
        bytes32 messageId,
        uint64 sourceChainSelector,
        bytes memory sender,
        bytes memory data
    ) external {
        Client.Any2EVMMessage memory message = Client.Any2EVMMessage({
            messageId: messageId,
            sourceChainSelector: sourceChainSelector,
            sender: sender,
            data: data,
            destTokenAmounts: new Client.EVMTokenAmount[](0)
        });

        IAny2EVMMessageReceiver(receiver).ccipReceive(message);
    }
}
