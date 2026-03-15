// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

contract AgentRegistry is Ownable {
    struct Agent {
        address wallet;
        string agentId;
        string role;          // "scout" | "analyst" | "executor" | "treasury"
        string endpoint;      // "http://host:port"
        uint256 pricePerReq;  // in stablecoin base units (6 decimals for USDC)
        address payToken;     // USDC or USDT address on X Layer
        uint256 successCount;
        uint256 failCount;
        uint256 registeredAt;
        bool active;
    }

    mapping(string => Agent) public agents;
    string[] public agentIds;

    event AgentRegistered(string indexed agentId, address wallet, string role);
    event AgentUpdated(string indexed agentId);
    event SuccessRecorded(string indexed agentId, uint256 total);
    event FailureRecorded(string indexed agentId, uint256 total);
    event AgentDeactivated(string indexed agentId);

    constructor() Ownable(msg.sender) {}

    function register(
        string calldata _agentId,
        string calldata _role,
        string calldata _endpoint,
        uint256 _pricePerReq,
        address _payToken
    ) external {
        require(agents[_agentId].wallet == address(0), "Agent ID already taken");
        require(bytes(_agentId).length > 0, "Agent ID cannot be empty");
        require(bytes(_role).length > 0, "Role cannot be empty");

        agents[_agentId] = Agent({
            wallet: msg.sender,
            agentId: _agentId,
            role: _role,
            endpoint: _endpoint,
            pricePerReq: _pricePerReq,
            payToken: _payToken,
            successCount: 0,
            failCount: 0,
            registeredAt: block.timestamp,
            active: true
        });

        agentIds.push(_agentId);
        emit AgentRegistered(_agentId, msg.sender, _role);
    }

    function getAgent(string calldata _agentId) external view returns (Agent memory) {
        require(agents[_agentId].wallet != address(0), "Agent not found");
        return agents[_agentId];
    }

    function getAgentCount() external view returns (uint256) {
        return agentIds.length;
    }

    function getAllAgents() external view returns (Agent[] memory) {
        Agent[] memory result = new Agent[](agentIds.length);
        for (uint256 i = 0; i < agentIds.length; i++) {
            result[i] = agents[agentIds[i]];
        }
        return result;
    }

    function updateEndpoint(string calldata _agentId, string calldata _newEndpoint) external {
        require(agents[_agentId].wallet == msg.sender, "Not agent owner");
        agents[_agentId].endpoint = _newEndpoint;
        emit AgentUpdated(_agentId);
    }

    function updatePrice(string calldata _agentId, uint256 _newPrice) external {
        require(agents[_agentId].wallet == msg.sender, "Not agent owner");
        agents[_agentId].pricePerReq = _newPrice;
        emit AgentUpdated(_agentId);
    }

    function recordSuccess(string calldata _agentId) external {
        require(agents[_agentId].wallet == msg.sender, "Not agent owner");
        agents[_agentId].successCount++;
        emit SuccessRecorded(_agentId, agents[_agentId].successCount);
    }

    function recordFailure(string calldata _agentId) external {
        require(agents[_agentId].wallet == msg.sender, "Not agent owner");
        agents[_agentId].failCount++;
        emit FailureRecorded(_agentId, agents[_agentId].failCount);
    }

    function deactivate(string calldata _agentId) external {
        require(agents[_agentId].wallet == msg.sender, "Not agent owner");
        agents[_agentId].active = false;
        emit AgentDeactivated(_agentId);
    }
}
