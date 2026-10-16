# Crypto price and unlock details

`GET /api/crypto-details?symbols=USDC,ARB,...` is the browser-facing, read-only contract for the Crypto Wallet detail panels.

## Sources

- CoinGecko `/coins/markets` supplies USD price, 1h/24h/7d changes, 24h high/low, and the 7-day sparkline.
- Tokenomist `/v5/unlock/events/upcoming` supplies the next reported unlock date, amount, event value-to-market-cap percentage, and allocation breakdown.

Both providers are called server-side. Keys never enter browser responses. Requests are batched for all eight demo symbols, cached (5 minutes for markets; 6 hours for unlocks), limited to 5 seconds, and are not retried automatically.

## Activation

Market data requires `COINGECKO_MODE=live` and `COINGECKO_API_KEY`. Unlock data requires `TOKENOMIST_MODE=live` and `TOKENOMIST_API_KEY`. If either provider is disabled or unavailable, the response reports that state independently and the wallet keeps working.

The public response deliberately excludes provider quota metadata, raw upstream errors, Tokenomist reference prices, and unrelated supply/cap fields.

## Financial boundary

All holdings and market prices are informational. The Safe-to-Spend engine remains THB-only and does not include cryptocurrency holdings or infer a USD/THB exchange rate.

## Supported symbols

`USDC`, `ARB`, `OP`, `SUI`, `APT`, `STRK`, `TIA`, and `ENA`. USDC can have CoinGecko market data while correctly returning `not_covered` for Tokenomist upcoming unlocks.
