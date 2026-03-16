# Telegram Bot Setup

AgentHedge includes an optional Telegram bot for real-time trade alerts and system control.

## 1. Create a Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Name: `AgentHedge Bot` (or any name)
4. Username: `agenthedge_bot` (must be unique, try variations)
5. Copy the bot token (format: `123456789:ABCdefGHIjklMNOpqrSTUvwxYZ`)

## 2. Get Your Chat ID

1. Start a conversation with your new bot (click "Start")
2. Send any message to it (e.g. "hello")
3. Open this URL in your browser (replace `<TOKEN>` with your bot token):
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
4. Find `"chat":{"id":123456789}` in the JSON response
5. Copy the numeric chat ID

For group chats: add the bot to the group, send a message in the group, then check getUpdates. Group IDs are negative numbers (e.g. `-1001234567890`).

## 3. Configure Environment

Add to your `.env`:

```bash
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
TELEGRAM_CHAT_ID=987654321
ALERT_SPREAD_THRESHOLD=0.4     # Alert when spread > 0.4%
TELEGRAM_THROTTLE_MONITOR=10   # Send every 10th MONITOR cycle
```

## 4. Available Commands

| Command | Description |
|---------|-------------|
| `/status` | System status, agent info, portfolio |
| `/trades` | Last 5 executed trades |
| `/pnl` | Session P&L summary with venue stats |
| `/pause` | Pause the trading pipeline |
| `/resume` | Resume the trading pipeline |
| `/help` | Show command list |

## 5. Alert Types

| Alert | Trigger | Throttled? |
|-------|---------|------------|
| Trade Executed | Every trade | No (always sent) |
| On-Chain Attestation | Every attestation tx | No |
| Spread Alert | Spread > threshold | Max 1/minute |
| Monitor Update | MONITOR cycles | Every Nth cycle |
| Startup | System start | Once |
| Shutdown | System stop | Once |

## 6. Security

- The bot only responds to messages from the configured `TELEGRAM_CHAT_ID`
- Commands from other users/chats are silently ignored
- Never share your bot token publicly
- The bot token is not committed to version control (it's in `.env`)

## 7. Disabling

Set `TELEGRAM_ENABLED=false` or leave `TELEGRAM_BOT_TOKEN` empty. The bot will be completely disabled with no errors or network requests.
