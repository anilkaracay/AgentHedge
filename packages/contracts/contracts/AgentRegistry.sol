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

    struct CycleAttestation {
        uint256 cycleId;
        uint256 timestamp;
        uint256 bestBidPrice;      // cheapest venue price (18 decimals)
        uint256 bestAskPrice;      // most expensive venue price (18 decimals)
        uint16 spreadBps;          // spread in basis points
        uint8 venueCount;          // how many venues responded
        bytes32 buyVenueHash;      // keccak256 of cheapest venue name
        bytes32 sellVenueHash;     // keccak256 of most expensive venue name
        uint8 decision;            // 0=MONITOR, 1=EXECUTE, 2=SKIP
        int256 estimatedProfitUsd; // estimated profit in cents (can be negative)
        address attestedBy;        // which agent submitted this
    }

    mapping(string => Agent) public agents;
    mapping(address => bool) public activeAgentWallets;
    string[] public agentIds;

    CycleAttestation[] public attestations;
    uint256 public attestationCount;

    event AgentRegistered(string indexed agentId, address wallet, string role);
    event AgentUpdated(string indexed agentId);
    event SuccessRecorded(string indexed agentId, uint256 total);
    event FailureRecorded(string indexed agentId, uint256 total);
    event AgentDeactivated(string indexed agentId);
    event CycleAttested(
        uint256 indexed cycleId,
        uint16 spreadBps,
        uint8 decision,
        int256 estimatedProfitUsd,
        uint256 timestamp
    );

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

        activeAgentWallets[msg.sender] = true;
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
        activeAgentWallets[msg.sender] = false;
        emit AgentDeactivated(_agentId);
    }

    // ── Cycle Attestation ──

    function attestCycle(
        uint256 _cycleId,
        uint256 _bestBidPrice,
        uint256 _bestAskPrice,
        uint16 _spreadBps,
        uint8 _venueCount,
        bytes32 _buyVenueHash,
        bytes32 _sellVenueHash,
        uint8 _decision,
        int256 _estimatedProfitUsd
    ) external {
        require(activeAgentWallets[msg.sender], "Not an active agent");

        attestations.push(CycleAttestation({
            cycleId: _cycleId,
            timestamp: block.timestamp,
            bestBidPrice: _bestBidPrice,
            bestAskPrice: _bestAskPrice,
            spreadBps: _spreadBps,
            venueCount: _venueCount,
            buyVenueHash: _buyVenueHash,
            sellVenueHash: _sellVenueHash,
            decision: _decision,
            estimatedProfitUsd: _estimatedProfitUsd,
            attestedBy: msg.sender
        }));

        attestationCount++;

        emit CycleAttested(
            _cycleId,
            _spreadBps,
            _decision,
            _estimatedProfitUsd,
            block.timestamp
        );
    }

    function getAttestation(uint256 index) external view returns (CycleAttestation memory) {
        require(index < attestationCount, "Index out of bounds");
        return attestations[index];
    }

    function getLatestAttestations(uint256 count) external view returns (CycleAttestation[] memory) {
        uint256 start = attestationCount > count ? attestationCount - count : 0;
        uint256 length = attestationCount - start;
        CycleAttestation[] memory result = new CycleAttestation[](length);
        for (uint256 i = 0; i < length; i++) {
            result[i] = attestations[start + i];
        }
        return result;
    }
}
