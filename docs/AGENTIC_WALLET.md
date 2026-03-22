# Agentic Wallet Integration Guide

## Overview

AgentHedge supports OKX Agentic Wallet as an alternative to standard ethers.js wallet management. Agentic Wallet provides TEE-secured key storage, zero gas on X Layer, and built-in risk detection.

## Architecture

```
Standard Mode:
Agent → ethers.js Wallet → Private Key (.env) → Sign → Broadcast

Agentic Wallet Mode:
Agent → Agentic Wallet API → TEE Enclave → Sign → Broadcast
                                ↑
                        Private key NEVER leaves TEE
```

## Setup

### Prerequisites

- OKX account with email verified
- Agentic Wallet access (via OKX Developer Portal)

### Step 1: Install OnchainOS Skills

```bash
npx skills add okx/onchainos-skills
```

This installs the `okx-agentic-wallet` skill along with 10 other OnchainOS skills for Claude Code, Cursor, and other AI agents.

### Step 2: Create Agentic Wallet

Using Claude Code or any MCP-compatible agent:

```
> "Log in to Agentic Wallet with email"
```

The skill handles the full login flow: email → OTP verification → wallet creation.

### Step 3: Get API Token

After wallet creation, obtain your session token from the Agentic Wallet dashboard or via `onchainos wallet status`.

### Step 4: Configure AgentHedge

```env
WALLET_PROVIDER=agentic
AGENTIC_WALLET_TOKEN=your_token_here
```

### Step 5: Start AgentHedge

```bash
npm run dev:all
```

All agent wallet operations will now use TEE-secured signing.

## Security Comparison

| Feature | ethers.js (Standard) | Agentic Wallet |
|---------|---------------------|----------------|
| Key Storage | .env file (plaintext) | TEE enclave |
| Key Access | Anyone with server access | No one (including OKX) |
| Gas on X Layer | ~$0.000001 | $0.00 (zero) |
| Risk Detection | None | Automatic |
| Multi-wallet | Manual (4 separate keys) | Up to 50 sub-wallets |
| Setup Complexity | Low (copy private keys) | Medium (email verification) |
| Best For | Development, testing | Production, institutional |

## Wallet Provider Architecture

AgentHedge uses a provider abstraction (`WalletProvider` interface) that allows switching between ethers.js and Agentic Wallet without changing agent code:

```typescript
import { createWalletProvider } from '@agenthedge/shared';

// Standard mode (default)
const wallet = createWalletProvider('ethers', {
  privateKey: process.env.SCOUT_PK,
  rpcUrl: 'https://rpc.xlayer.tech',
});

// Agentic Wallet mode
const wallet = createWalletProvider('agentic', {
  agenticToken: process.env.AGENTIC_WALLET_TOKEN,
  agentId: 'scout',
  chainIndex: '196',
});

// Same interface regardless of provider
const address = await wallet.getAddress();
const result = await wallet.sendTransaction(tx);
```

## OnchainOS Skills Integration

The `onchainos-skills` package provides 11 skills for AI agent development:

| Skill | Purpose |
|-------|---------|
| `okx-agentic-wallet` | Wallet lifecycle: auth, balance, transfers, contract calls |
| `okx-dex-swap` | DEX aggregator quotes and swaps |
| `okx-dex-market` | Market data, candles, PnL analysis |
| `okx-dex-token` | Token search and metadata |
| `okx-dex-signal` | Smart money / whale / KOL signals |
| `okx-dex-trenches` | Meme token scanning |
| `okx-wallet-portfolio` | Public address portfolio queries |
| `okx-onchain-gateway` | Transaction broadcasting |
| `okx-security` | Token/DApp/transaction security scanning |
| `okx-audit-log` | Audit log queries |
| `okx-x402-payment` | x402 micropayment protocol |

## Key Features

### TEE-Secured Signing

All transaction signing happens inside a Trusted Execution Environment. The private key is generated in the TEE and never leaves — not even OKX can access it.

### Zero Gas on X Layer

X Layer (chainIndex 196) charges zero gas fees for Agentic Wallet transactions, sponsored by OKX.

### Built-in Risk Detection

Every transaction is automatically scanned for:
- Malicious contract interactions
- Suspicious approval patterns
- Known scam addresses
- Anomalous transaction patterns

### Multi-Wallet Support

Each agent can manage up to 50 sub-wallets, enabling parallel operations and capital isolation per trading strategy.

## CLI Reference

```bash
# Check login status
onchainos wallet status

# Login with email
onchainos wallet login user@example.com

# Check balance on X Layer
onchainos wallet balance --chain 196

# Send tokens
onchainos wallet send --amount "0.02" --receipt "0xAbc..." --chain 196 --contract-token "0xUSDC..."

# Smart contract interaction
onchainos wallet contract-call --to "0xContract..." --chain 196 --input-data "0x..."
```

See the [full CLI reference](https://web3.okx.com/onchainos/dev-docs/wallet/agentic-wallet) for all available commands.
