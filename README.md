<div align="center">

# 🛡️ AI Privacy Guardrail

**Redact before you prompt. Restore after it replies.**

A browser-only tool that strips personal data and secrets from text before it goes to ChatGPT, Claude, Gemini or any other AI model, then puts the real values back into the model's answer.

[**Live demo**](https://liuxiaomingskm.github.io/AI-Privacy-Guardrail/) · [Report an issue](https://github.com/liuxiaomingskm/AI-Privacy-Guardrail/issues)

![License: MIT](https://img.shields.io/badge/license-MIT-0f766e?style=flat-square)
![No backend](https://img.shields.io/badge/backend-none-1d4ed8?style=flat-square)
![Dependencies](https://img.shields.io/badge/dependencies-0-7e22ce?style=flat-square)
![Tests](https://img.shields.io/badge/tests-node%20--test-15803d?style=flat-square)

</div>

---

## Contents

- [Why](#why)
- [How it works](#how-it-works)
- [What gets detected](#what-gets-detected)
- [Quick start](#quick-start)
- [Using the engine in code](#using-the-engine-in-code)
- [Project layout](#project-layout)
- [Limitations](#limitations)
- [Roadmap](#roadmap)
- [License](#license)

## Why

Text pasted into AI assistants often carries more than intended: customer emails in a support ticket, an API key in a config snippet, an internal IP in a stack trace, a client's name in meeting notes. Once it's sent, it's out of your hands.

Most redaction tools stop at blanking values out, which makes the AI's answer less useful: it can no longer tell *which* email or *which* host it is talking about. AI Privacy Guardrail keeps that structure:

- **Consistent placeholders.** The same value always gets the same tag (`[EMAIL_1]`, `[EMAIL_2]`, `[IP_1]` …), so the model can still reason about who did what.
- **Reversible.** Paste the model's reply back in and every placeholder is swapped back to the real value, locally.

## How it works

```
 your text ──► ① redact ──► [EMAIL_1] [IP_1] … ──► AI model
                    │                                   │
            mapping kept in this tab                    ▼
                    └──────────► ③ restore ◄── reply mentioning [EMAIL_1]
```

1. **Redact.** Detectors run in priority order (secrets → email → card → SSN → IP → phone → custom terms). Each match claims its characters, so overlapping rules can never split a value or leave part of it visible.
2. **Send.** Copy the safe text into any AI tool.
3. **Restore.** Paste the reply; placeholders are replaced from the in-memory mapping. Unknown placeholders are left untouched.

Nothing is uploaded, logged or stored. The only thing saved (in `localStorage`) is which detectors you switched on and your term options, never your text or your custom terms.

## What gets detected

| Detector | Placeholder | Notes |
| --- | --- | --- |
| API keys & secrets | `[SECRET_n]` | OpenAI/Anthropic-style `sk-…`, AWS, Google, GitHub, GitLab, Slack, Stripe, Hugging Face, JWTs, `Bearer` tokens, PEM private keys, and `*_SECRET=` / `"api_key": "…"` assignments (only the value is replaced) |
| Email | `[EMAIL_n]` | Case-insensitive grouping: `A@X.com` and `a@x.com` share a tag |
| Credit card | `[CARD_n]` | 13–19 digits, **Luhn-validated** so random digit runs are ignored |
| US SSN | `[SSN_n]` | Excludes invalid ranges (`000`, `666`, `9xx`, …) |
| IP address | `[IP_n]` | IPv4 with octet validation; version strings like `1.2.3.4.5` are skipped |
| Phone number | `[PHONE_n]` | International `+…` and 10–11 digit national formats with spaces, dots, dashes or `( )` |
| Custom terms | `[TERM_n]` | Your own names, companies, code names; whole-word and case options |

Things deliberately **left alone**: dates and times, version numbers, prices, numeric ranges, ticket numbers, UUIDs and code like `std::io`.

## Quick start

No build step and no dependencies.

```bash
git clone https://github.com/liuxiaomingskm/AI-Privacy-Guardrail.git
cd AI-Privacy-Guardrail
open index.html          # or: npx serve .
```

Click **Sample** to see every detector in action.

Run the tests (Node 18+):

```bash
npm test
```

## Using the engine in code

`src/guardrail.js` has no DOM dependencies and works in the browser (`window.Guardrail`) or Node:

```js
const { redact, restore } = require('./src/guardrail.js');

const { text, mapping, counts } = redact(
  'Ping jane@acme.com about host 10.0.0.12 for Project Bluebird',
  { terms: ['Project Bluebird'] }
);
// text   → 'Ping [EMAIL_1] about host [IP_1] for [TERM_1]'
// counts → { email: 1, ip: 1, term: 1 }

restore('I contacted [EMAIL_1] and rebooted [IP_1].', mapping);
// → 'I contacted jane@acme.com and rebooted 10.0.0.12.'
```

Options for `redact(text, options)`:

| Option | Default | Description |
| --- | --- | --- |
| `enabled` | all on | `{ email: false, … }` to switch detectors off |
| `terms` | `[]` | Custom words or phrases to redact |
| `wholeWord` | `true` | Only match terms as whole words |
| `caseSensitive` | `false` | Match terms case-sensitively |

## Project layout

```
index.html              Page markup
src/guardrail.js        Redaction engine (pure functions)
src/app.js              UI wiring
src/styles.css          Styles, light and dark
tests/guardrail.test.js Engine tests (node --test)
```

## Limitations

This is a safety net, not a guarantee. Detection is pattern-based:

- Free-form personal data (names, street addresses) is only caught if you add it as a custom term.
- Short local phone numbers without an area code are skipped to avoid false positives.
- New or unusual key formats may slip through.

**Always review the output before sending it.**

## Roadmap

- [ ] IBAN and passport-style ID detectors
- [ ] Export / import the mapping so a session can be restored later
- [ ] Browser extension that redacts directly in AI chat inputs
- [ ] Optional detector packs per region (EU, UK, CN, …)

## License

[MIT](LICENSE) © 2026 liuxiaomingskm
