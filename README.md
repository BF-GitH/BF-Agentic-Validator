# BF's Agentic Response Validator

**Version 2.0.0** | [License](LICENSE) | For SillyTavern Platform

<!-- ![Extension Settings](screenshot.png) -->

## Overview

A SillyTavern extension that automatically validates AI responses against user-defined criteria using a multi-stage pipeline — and retries with targeted OOC corrections when validation fails. Think of it as an AI proofreader that catches bad habits before you ever see them.

### Key Features

- **3-Stage Validation Pipeline** — Local checks + LLM quality checks + automatic retry
- **Profile Switching** — Seamlessly uses a separate validator profile for checking
- **11 Preset Rules** — Quick-start validation rules for common issues
- **Custom Criteria** — Define your own validation rules for any scenario
- **Cliché Detection** — 30+ built-in regex patterns catch purple prose instantly
- **Smart OOC Injection** — Targeted corrections injected without polluting chat history
- **Text Selection** — Click-to-add cliché patterns from AI responses
- **Debug Mode** — Real-time validation logs for full transparency

## Problem Statement

LLMs in roleplay scenarios develop persistent bad habits:

- Purple prose and overused clichés ("heart skipped a beat", "electricity coursed through")
- Echoing the user's message back in different words
- One-dimensional characters defined only by their profession
- Inconsistent POV, robotic dialogue, or breaking character
- Responses that are too short, too long, or miss the mark

Manual correction is tedious — you end up re-rolling and hoping for better output, or writing lengthy OOC instructions every time.

## Solution

This extension intercepts every AI response, runs it through a configurable validation pipeline, and automatically retries with precise OOC feedback when issues are detected. The corrections are never saved to chat history, keeping your conversation clean.

## How It Works

```
User sends message → AI generates response
                            ↓
                    [Intercept Response]
                    [Hide from view]
                            ↓
            ┌───────────────────────────────┐
            │  STAGE 0: Local Quick-Check   │
            │  • Word count validation      │
            │  • Cliché pattern detection   │
            │  • Echo/repetition detection  │
            │  (Fast — no API call needed)  │
            └───────────────┬───────────────┘
                            ↓
            ┌───────────────────────────────┐
            │  STAGE 1: LLM Quality Check   │
            │  • Switches to validator       │
            │    profile                     │
            │  • Checks each rule            │
            │    individually               │
            │  • Returns failed rule numbers │
            └───────────────┬───────────────┘
                            ↓
         ┌──────────────────┴──────────────────┐
         ↓                                     ↓
     [ALL PASS]                            [FAIL]
         ↓                                     ↓
  Display response                    Retries remaining?
                                     ↓              ↓
                                   [YES]           [NO]
                                     ↓              ↓
                              Delete response    Display anyway
                              Inject targeted    (give up)
                              OOC correction
                              Regenerate
                                     ↓
                              [Loop back to intercept]
```

## Installation

### Automatic (Recommended)

1. Open SillyTavern
2. Navigate to **Extensions** → **Install Extension**
3. Paste URL: `https://github.com/BF-GitH/bf-agentic-validator`
4. Click **Install**

### Manual

1. Download and extract this repository
2. Place the `bf-agentic-validator` folder in:
   ```
   SillyTavern/public/scripts/extensions/third-party/
   ```
3. Restart SillyTavern
4. Enable in **Extensions** settings

## Setup

### 1. Create a Validator Profile

1. Go to **API Connections** in SillyTavern
2. Create a new connection profile specifically for validation
3. Configure it with a fast, instruction-following model (GPT-4o-mini, Haiku, etc.)
4. Name it something like "Validator" or "Checker"

### 2. Configure the Extension

1. Open **Extensions** → **BF's Agentic Response Validator**
2. Enable the extension with the toggle
3. Select your validator profile from the dropdown
4. Add validation rules — use presets or write your own

## Configuration

### Stage 0: Local Checks (No API Cost)

Fast regex-based checks that run before any API call:

| Setting | Description |
|---------|-------------|
| **Cliché Patterns** | 30+ built-in patterns for purple prose detection |
| **Min Words** | Minimum word count requirement |
| **Max Words** | Maximum word count limit |
| **Echo Detection** | N-gram analysis to catch response echoing |

Custom patterns can be added by selecting text in AI responses and clicking the floating "Add Pattern" button.

### Stage 1: LLM Quality Check

Uses your validator profile to check responses against rules:

| Setting | Description |
|---------|-------------|
| **Validator Profile** | The connection profile used for checking |
| **Validation Rules** | Custom rules responses must follow |
| **Context Messages** | Number of recent messages sent to validator (default: 5) |
| **Max Retries** | How many times to retry before giving up (1–5) |
| **Feedback Template** | OOC correction message template |

### General Settings

| Setting | Description |
|---------|-------------|
| **Show Toast** | Display notifications for validation results |
| **Debug Mode** | Show detailed validation logs in settings panel |

## Available Preset Rules

| Preset | Description |
|--------|-------------|
| **Third Person** | Enforce third-person narrative, no first-person pronouns |
| **Natural Dialogue** | Informal, conversational tone — not robotic or formal |
| **Heroine Only** | Only the main character can have dialogue lines |
| **No Echoes** | Don't quote or paraphrase the user's message |
| **No Repetition** | Fresh content, no recycled phrases |
| **Beyond Profession** | Character depth, not one-dimensional |
| **No Clichés** | Simple prose, no purple prose or forced metaphors |
| **No Asterisks** | Plain prose only, no roleplay \*action\* formatting |
| **Minimum Length** | Responses must be at least 100 words |
| **No OOC** | Stay in character, no meta-commentary |
| **Dialogue Focus** | Must contain actual spoken dialogue |

## Correction Template Variables

The OOC correction template supports these placeholders:

| Variable | Description |
|----------|-------------|
| `{criteria}` | The validation criteria that failed |
| `{violation}` | Why the response failed |
| `{attempt}` | Current attempt number |
| `{max_attempts}` | Maximum retry attempts |

## Comparison

| Feature | Agentic Validator | Manual Re-rolling | Static OOC |
|---------|------------------|-------------------|------------|
| Automatic Checking | ✅ Yes | ❌ No | ❌ No |
| Targeted Feedback | ✅ Per-rule | ❌ No | ⚠️ Generic |
| Chat History Pollution | ✅ Clean | ✅ Clean | ❌ Bloated |
| Local Pre-checks | ✅ Free | ❌ No | ❌ No |
| Cliché Detection | ✅ 30+ patterns | ❌ No | ❌ No |
| Preset Management | ✅ Yes | ❌ No | ❌ No |
| Setup Effort | ✅ Once | ❌ Continuous | ⚠️ Once |

## Tips

1. **Use a fast model for validation** — The validator makes an extra API call, so use a fast/cheap model (GPT-4o-mini, Haiku, etc.)
2. **Be specific with criteria** — Vague criteria leads to inconsistent validation
3. **Start with Stage 0** — Local checks are free and catch the most common issues
4. **Keep max retries low** — Higher values mean more API calls and latency
5. **Use debug mode initially** — See what's happening before trusting it fully

## Compatibility

- Requires **SillyTavern 1.12.6** or later (Connection Profiles support)
- Works with all API backends (OpenAI, Claude, local models, etc.)
- Compatible with both Chat Completion and Text Completion APIs

## Known Limitations

- Validation adds latency (one extra generation per response when Stage 1 is enabled)
- Some models may not reliably return the expected validation format
- Very long responses may hit context limits on the validator model

## Contributing

Bug reports and feature requests welcome via [GitHub Issues](https://github.com/BF-GitH/bf-agentic-validator/issues).

Pull requests accepted. For major changes, please open an issue first to discuss proposed modifications.

## License

[MIT License](LICENSE)

## Credits

- **Author**: BF-GitH
- **Based on**: BF's OOC Injection + Nox's Chapterized Summary

## Support

Find this extension useful? Consider [supporting development](https://ko-fi.com/bfgith) ☕

---

**Made for the SillyTavern community**
