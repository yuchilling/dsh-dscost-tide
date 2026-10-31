# dsh-dscost-tide

> One glance at the DeepSeek Harness sidebar footer tells you **whether DeepSeek is in its peak-priced window, how much balance you have left, and where those tokens went.**

A DSH bundle plugin that occupies the `sidebar.footer.action` seat in the sidebar footer, right after the built-in balance widget.

## What you get

A two-row card in the sidebar footer, tinted red during peak hours and green off-peak, plus a click-through dashboard.

```
● Peak     2h 30m to off-peak
¥balance                   14:32
```

The dashboard is split into four sections: a peak-phase hero, the pricing schedule (countdown, next switch, 24-hour strip), the account balance (total, topped-up wallet, granted wallet), and usage statistics.

```
Usage          [Today][7 days][30 days][All time]
Tokens        12.58M        Cache hit rate   98.00%
Cost          ¥1.2345       API requests       128
Prompt        12,345,678 (hit 12,098,764 · miss 246,914)
Output        234,567
Model calls   128 · ¥1.1945
Web search    2 · ¥0.0400
Days          7 · avg ¥0.1764
Window        2026-01-01 to 2026-01-07
```

> Every number above is illustrative and has nothing to do with any real account.

## Features

- **Peak/valley at a glance** — official windows (Beijing time, weekdays 09:00–12:00 and 14:00–18:00 are peak; everything else, including whole weekends since 2026-08-23, is off-peak), with a live countdown to the next switch.
- **Account balance** — the Host's authorized DeepSeek account balance (topped-up + granted wallets), falling back to `DEEPSEEK_API_KEY` against `api.deepseek.com/user/balance`.
- **Usage by time dimension** — `today` / `7 days` / `30 days` / `all time`, with consumed tokens, cache hit rate, cost and API request count, plus the prompt hit/miss split, output, model calls, web-search calls, daily average and covered window.
- **Real prices** — every `assistant/message` usage record is priced with the band in force **at its own timestamp** (including the 2026-09-10 12:00 flash reprice); web searches are billed at ¥0.02 each.
- **Quiet** — usage is fetched only while the dashboard is open, and folded session logs are memoised by their revision so a refresh only re-reads what changed.

## Install

### From the plugin catalogue

Once published:

```bash
dsh plugin add dsh-dscost-tide
```

or open it in **Plugins → Installed**. Afterwards, **fully quit and restart DeepSeek Harness** — the client bundle is preloaded at startup, so a hot reload cannot pick up new UI code.

### From local source (`link:`)

For development, add to `~/.dsh/profiles/<profile>/package.json`:

```json
{
  "dependencies": { "dsh-dscost-tide": "link:E:/path/to/dsh-dscost-tide" },
  "dsh": { "profile": { "bundles": ["...", "dsh-dscost-tide"] } }
}
```

Then run `pnpm install` in the profile directory and restart DSH.

## Pricing model

| Family | Off-peak input | Off-peak cache hit | Off-peak output | Peak |
| --- | ---: | ---: | ---: | ---: |
| Flash (`deepseek-v4-flash`, `deepseek-flash`) | ¥1 / 1M | ¥0.02 / 1M | ¥4 / 1M | ×2 |
| Flash before 2026-09-10 12:00 | ¥1.5 / 1M | ¥0.05 / 1M | ¥4.5 / 1M | ×2 |
| Pro (`deepseek-v4-pro`) | ¥4.5 / 1M | ¥0.15 / 1M | ¥13.5 / 1M | ×2 |

Peak/valley pricing starts 2026-08-17; older records are charged the off-peak rate. Amounts are CNY. If a number disagrees with your bill, the [official price page](https://api-docs.deepseek.com/quick_start/pricing) wins.

## Data and privacy

- **Phase** is computed locally from the wall clock — no network.
- **Balance** comes from the Host's account grant (or your `DEEPSEEK_API_KEY`), exposed on the loopback route `/dsh-dscost-tide/api/balance`.
- **Usage** is folded from local `~/.dsh/sessions/**` logs only. Message content is never read or sent anywhere; fork/sub-agent sessions skip their inherited parent prefix via `inheritedEventCount`.
- Both routes serve loopback requests only: the `Host` header must be loopback/trusted, cross-site requests are refused, and `Origin` must match.

## Compatibility

- DeepSeek Harness **0.2.x** (`engines.dsh: >=0.2.0-rc.1 <0.3.0-0`), verified on `0.2.1-rc.5` (Windows desktop).
- The browser half uses `@deepseek-ai/dsh-client-ui-primitives` when present and falls back to its own modal otherwise.
- Node.js ≥ 22 is only needed for development and tests.

## Development

```bash
node --test test/plugin.test.mjs  # offline unit tests, no DSH runtime needed
node scripts/check-publish.mjs     # manifest / files / placeholder checks
node scripts/prepare-publish.mjs   # build the publishable copy and pack it
```

The working tree keeps `"name": "dsh-dscost-tide"` (it is the install key in the profile's `dependencies` / `dsh.profile.bundles`), and that same unscoped name is used on npm, so publishing starts with:

```bash
node scripts/prepare-publish.mjs --repo yuchilling/dsh-dscost-tide
cd _intermediate/publish && npm publish --access public
```

> npm writes a `0.0.0-stage` placeholder version when the package is first created and then uploads the real version — that is npm's current policy for bypass-2FA tokens, not a failure. One `npm publish` is enough; no approval step is involved.

## License

[MIT](./LICENSE)
