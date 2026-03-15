# Deployment & Environment Guide

## Prerequisites

- Node.js 20+
- npm 10+
- Git

## Initial Setup

### 1. Initialize Monorepo

```bash
mkdir agenthedge && cd agenthedge
npm init -y

# Configure workspaces in package.json
```

Root `package.json`:
```json
{
  "name": "agenthedge",
  "private": true,
  "workspaces": [
    "packages/*",
    "packages/agents/*"
  ],
  "scripts": {
    "build": "npm run build --workspaces",
    "dev": "npm run dev --workspaces --if-present",
    "deploy:contract": "cd packages/contracts && npx hardhat run scripts/deploy.ts --network xlayer_testnet",
    "start:agents": "concurrently \"npm run start -w @agenthedge/scout\" \"npm run start -w @agenthedge/analyst\" \"npm run start -w @agenthedge/executor\" \"npm run start -w @agenthedge/treasury\"",
    "start:orchestrator": "npm run start -w @agenthedge/orchestrator",
    "start:dashboard": "npm run dev -w @agenthedge/dashboard"
  },
  "devDependencies": {
    "concurrently": "^8.0.0",
    "typescript": "^5.4.0"
  }
}
```

### 2. Create Shared tsconfig

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true
  }
}
```

### 3. Environment Variables

Create `.env` from `.env.example`:

```env
# ── X Layer Network ──
XLAYER_RPC=https://rpc.xlayer.tech
XLAYER_TESTNET_RPC=https://testrpc.xlayer.tech
XLAYER_CHAIN_ID=196

# ── Agent Wallets ──
# Generate 5 separate wallets (e.g., via ethers.Wallet.createRandom())
# Fund each with small amount of USDC on X Layer
SCOUT_PK=0x...
ANALYST_PK=0x...
EXECUTOR_PK=0x...
TREASURY_PK=0x...
DEPLOYER_PK=0x...

# ── OnchainOS API ──
# Get from https://web3.okx.com/build/dev-portal
OKX_API_KEY=
OKX_SECRET_KEY=
OKX_PASSPHRASE=
OKX_PROJECT_ID=

# ── Smart Contract ──
REGISTRY_ADDRESS=  # Fill after deployment

# ── Tokens on X Layer ──
# Verify these on X Layer explorer before using
USDC_ADDRESS=
USDT_ADDRESS=

# ── Agent Configuration ──
SCOUT_PORT=3001
ANALYST_PORT=3002
EXECUTOR_PORT=3003
TREASURY_PORT=3004
ORCHESTRATOR_WS_PORT=3005
DASHBOARD_PORT=3000

# ── Strategy Parameters ──
SPREAD_THRESHOLD=0.003
MAX_TRADE_SIZE_USDC=500
DAILY_LOSS_LIMIT_PCT=0.05
SCOUT_POLL_INTERVAL=5000
PORTFOLIO_POLL_INTERVAL=30000
```

### 4. Generate Agent Wallets

Quick script to generate wallets:
```typescript
import { ethers } from 'ethers';

for (const role of ['SCOUT', 'ANALYST', 'EXECUTOR', 'TREASURY', 'DEPLOYER']) {
  const wallet = ethers.Wallet.createRandom();
  console.log(`${role}_PK=${wallet.privateKey}`);
  console.log(`${role}_ADDRESS=${wallet.address}`);
  console.log('');
}
```

### 5. Get OnchainOS API Keys

1. Go to https://web3.okx.com/build/dev-portal
2. Create a new project
3. Generate API key, secret key, passphrase
4. Copy project ID
5. Add all to .env

### 6. Fund Wallets

For testnet:
- Get testnet OKB from X Layer faucet
- Bridge testnet USDC if available

For mainnet:
- Bridge USDC to X Layer via OKX bridge
- Send ~2 USDC to each agent wallet
- Send ~0.01 OKB to deployer wallet for contract deployment gas

## Deployment Steps

### Step 1: Deploy Smart Contract

```bash
# Compile
cd packages/contracts
npx hardhat compile

# Deploy to testnet first
npx hardhat run scripts/deploy.ts --network xlayer_testnet

# Copy deployed address to .env REGISTRY_ADDRESS

# When ready, deploy to mainnet
npx hardhat run scripts/deploy.ts --network xlayer
```

### Step 2: Verify Contract (Optional but recommended)

```bash
npx hardhat verify --network xlayer <CONTRACT_ADDRESS>
```

### Step 3: Start Agents

```bash
# Terminal 1: Start all agents
npm run start:agents

# Terminal 2: Start orchestrator
npm run start:orchestrator

# Terminal 3: Start dashboard
npm run start:dashboard
```

Or with Docker:
```bash
docker-compose up
```

## Docker Compose

```yaml
# docker-compose.yml
version: '3.8'
services:
  scout:
    build:
      context: .
      dockerfile: packages/agents/scout/Dockerfile
    ports: ["3001:3001"]
    env_file: .env
    environment:
      - AGENT_ROLE=scout

  analyst:
    build:
      context: .
      dockerfile: packages/agents/analyst/Dockerfile
    ports: ["3002:3002"]
    env_file: .env
    depends_on: [scout]

  executor:
    build:
      context: .
      dockerfile: packages/agents/executor/Dockerfile
    ports: ["3003:3003"]
    env_file: .env
    depends_on: [analyst]

  treasury:
    build:
      context: .
      dockerfile: packages/agents/treasury/Dockerfile
    ports: ["3004:3004"]
    env_file: .env

  orchestrator:
    build:
      context: .
      dockerfile: packages/orchestrator/Dockerfile
    ports: ["3005:3005"]
    env_file: .env
    depends_on: [scout, analyst, executor, treasury]

  dashboard:
    build:
      context: packages/dashboard
      dockerfile: Dockerfile
    ports: ["3000:3000"]
    depends_on: [orchestrator]
```

## Testing Strategy

### Unit Tests
- OnchainOS API client: mock HTTP responses, verify auth headers
- Profit analyzer: test slippage/impact calculations with known inputs
- Risk manager: test circuit breaker logic

### Integration Tests (Testnet)
1. Deploy registry to X Layer testnet
2. Register all 4 agents
3. Run 1 full cycle with small amount
4. Verify x402 payments on testnet explorer
5. Verify trade execution on testnet

### Mainnet Smoke Test
1. Run 2-3 cycles with minimal capital ($5-10)
2. Collect tx hashes for submission
3. Verify all hashes on X Layer mainnet explorer

## Hackathon Submission Checklist

- [ ] GitHub repo is PUBLIC
- [ ] README.md has: project description, architecture diagram, setup instructions, demo video link
- [ ] At least 1 X Layer mainnet transaction hash in submission
- [ ] X (Twitter) account created for the project
- [ ] Reply to hackathon thread with: intro, demo video, GitHub link
- [ ] Google Form submitted: https://forms.gle/BgBD4SuvJ7936F...
- [ ] Demo video recorded (max 2 minutes)
- [ ] Code uses Onchain OS APIs (bonus points)
- [ ] Code uses x402 payments (bonus points)

## Troubleshooting

### "OnchainOS API returns 401"
- Check API key, secret, passphrase, project ID
- Verify timestamp is in ISO format and within 30s of server time
- Verify HMAC signature computation (stringToSign = timestamp + method + path + query)

### "x402 payment fails"
- Ensure agent wallet has sufficient USDC balance
- Check that USDC contract address is correct for X Layer
- Verify network identifier is `eip155:196`

### "Transaction reverts on X Layer"
- Check gas limit is sufficient (use value from swap API response)
- Verify token approval was completed before swap
- Check slippage tolerance (increase if market is volatile)

### "Rate limited by OnchainOS API"
- Implement exponential backoff in onchainOS.ts
- Reduce polling frequency (increase SCOUT_POLL_INTERVAL)
- Consider caching recent price data (5s TTL)
