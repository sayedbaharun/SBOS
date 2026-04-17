# Trading — Venture Knowledge

**Domain:** Trading / Personal Finance
**Status:** Active (ongoing skill development)
**Venture type:** Personal trading — forex, indices

---

## Overview

Active trading as a personal revenue stream and skill. SB-OS has a built-in trading module to support daily discipline and consistency.

---

## SB-OS Trading Module

Full trading system built into SB-OS at `/trading`:

- **Session Indicator** — live clocks showing London, New York, Asian sessions with killzone highlighting
- **Strategy Manager** — create and manage trading strategies with dynamic checklists
- **Daily Checklist** — execute strategy checklist for the day (instances from templates)
- **Trade Logger** — log individual trades with entry/exit/P&L
- **End-of-Session Review** — lessons learned, followed-plan flag, no-trade-is-success flag
- **Trading Journal** — historical session log with P&L

**Economic Calendar:** `GET /api/trading/economic-calendar` — ForexFactory proxy, 1hr cache, Dubai timezone

---

## Trading Sessions (GMT)

| Session | Hours (GMT) | Focus |
|---------|-------------|-------|
| London | 8am–4pm | High volatility open |
| New York | 1pm–9pm | Overlap with London most liquid |
| Asian | 11pm–7am | Lower volatility |

---

## Broker API

Broker API endpoint exists as placeholder. Platform not yet confirmed — awaiting decision on OANDA / IBKR / MT4 / cTrader.

---

## Strategic Context for Agents

- Trading is about discipline and process, not prediction. Agents should reinforce checklist adherence and journaling habits.
- No-trade-is-success is a first-class outcome — encourage selective high-quality setups only.
- Economic calendar awareness is critical — flag high-impact news before sessions.
- Performance tracking: P&L trends, win rate, adherence rate to checklist are the key metrics.

---

## Tags
trading, forex, indices, journal, checklist, london-session, new-york-session, killzone, pnl, discipline
