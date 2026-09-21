<h1 align="center">🪞 dsh-user-mirror</h1>

<p align="center">
  <strong>Make the AI remember <em>how</em> you think — not <em>what</em> you said.</strong><br>
  A DSH plugin — the model actively records your principles, redlines, and working style, and reuses them across sessions.<br>
  Entries decay, capacity is bounded, every entry carries the reason it was recorded.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@dsh-plugins/dsh-user-mirror"><img src="https://img.shields.io/npm/v/%40dsh-plugins%2Fdsh-user-mirror?style=flat-square&color=8b5cf6&logo=npm&label=npm" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/@dsh-plugins/dsh-user-mirror"><img src="https://img.shields.io/npm/dm/%40dsh-plugins%2Fdsh-user-mirror?style=flat-square&color=6d7f9c&label=downloads" alt="downloads" /></a>
  <img src="https://img.shields.io/badge/DSH-%E2%89%A50.1.1--rc.2-4d6bfe?style=flat-square" alt="DSH" />
  <img src="https://img.shields.io/badge/runtime_deps-1-5A9E6F?style=flat-square" alt="deps" />
  <img src="https://img.shields.io/badge/license-MIT-777?style=flat-square" alt="MIT" />
</p>

<p align="center">
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DeepSeek_Harness-Plugin-4d6bfe?style=flat-square" alt="DSH Plugin" /></a>
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/topic-dsh--plugin-4d6bfe?style=flat-square" alt="dsh-plugin" /></a>
  <a href="https://github.com/topics/ai-memory"><img src="https://img.shields.io/badge/topic-ai--memory-8b5cf6?style=flat-square" alt="ai-memory" /></a>
  &nbsp;·&nbsp; <a href="README.md">中文</a> · <a href="CHANGELOG.md">Changelog</a> · <a href="DEV_NOTES.md">Dev notes</a>
</p>

<p align="center">
  <img src="https://img.webkubor.online/dsh-user-mirror/mirror-portrait.png" alt="Memory tab: a one-line self-portrait, four judgment sections, every line weighted by how often it has been confirmed" width="100%" />
  <br />
  <sub><b>Memory tab</b> — not a record list, but a portrait: one-line self-summary, four judgment sections,<br/>
  redlines in their own block, line weight = how often that judgment has been confirmed.</sub>
</p>

## With vs. without

| | Without | dsh-user-mirror |
|---|---|---|
| New session | You **repeat your principles** | **Auto-injected — the model already knows** |
| What's recorded | Opaque — you can only guess | **Every entry shown in the Memory tab** |
| Why it was recorded | Untraceable | **Every entry carries its reason — click to see** |
| Will it bloat context | Yes | **Injected by token budget, not by entry count** |
| Wrong entry recorded | You have to restart the session | **Click ✕ to withdraw** |
| Outdated preferences | Stays forever, misleads the model | **Decays — entries unconfirmed for 30 days move to the fading section** |

## What this is

A DSH plugin: **the model actively records how you think**, persists it across sessions, and re-injects it into the system prompt.

- 🧠 **Learn** — when the model notices you expressed a reusable judgment, it calls `mirror_remember` and **writes down why**
- 💾 **Store** — persisted locally via `ctx.storageDomain`; **capacity is bounded, entries decay, new beliefs overwrite old**
- 🎯 **Use** — auto-injected into the system prompt by **token budget**, not entry count

### Only judgments, never facts

This is the only design choice that matters. **Facts (paths, accounts, servers, repo addresses) have their own source of truth** — recording them again here creates a second source of truth, and they will eventually drift apart. So this plugin only takes what isn't already in a source of truth: your principles, tradeoffs, redlines, working style.

This is also the answer to "the human brain can't grow infinitely": judgments are inherently bounded (dozens at most), facts are not. By taking only the former, capacity doesn't need to be brute-forced by eviction.

| Category | Records |
|---|---|
| `principle` | Principles / tradeoffs — how to choose under what conditions |
| `redline` | Redlines — never do X |
| `workflow` | Workflow — process & collaboration habits |
| `taste` | Aesthetic / expression — wording, style, presentation |

### Why not infer from the thinking trace

Before v0.4 we regex-scanned the model's reasoning stream looking for phrases like "the user's preference is..." — **zero hits** on real data. The assumption that the model will paraphrase your preference in a specific Chinese phrasing is too brittle; and even when it does, "the user wants me to change this button" would get recorded as a long-term preference.

"Is this a long-term principle or a one-off request?" is a judgment. Regex is a hand. A hand can't make that judgment. So we let the model decide and call the tool itself — which also gives explainability: **every recording happens in the conversation, visible to you, with a reason attached**, instead of being silently written in the background.

## What the Memory tab looks like

After install, a new **Memory** tab appears next to **Conversation / Trace**. It isn't a list — it's a portrait:

- **One-line self-summary** at the top — the most-confirmed judgment, i.e. the one the model is most sure about you
- **Four sections** — redlines in their own block (crossing one has cost and they don't decay), principles as the main body, workflow & taste compressed into two columns
- **Weight = confidence** — the more often a judgment is confirmed, the heavier the line; weak ones fade to grey. No "strength 3.7" numbers — those don't mean anything to humans
- **Evidence folded inside** — the front face is the abstract judgment; click "which sessions" to expand into the concrete events
- **Decaying** — judgments unconfirmed for 30 days move into a folded section, so "it decays" is visible, not theoretical
- Every entry can be withdrawn via `✕`. Two-step: first click becomes "confirm withdrawal?", the second click deletes — the deletion endpoint only accepts DELETE/POST, returns 405 on GET, so browser pre-fetch or back/forward replay never accidentally deletes
- An [ai-orb](https://github.com/webkubor/ai-orb) status pill speaks up: reading / refreshing / just-recorded (with badge) / failed

## Memory model: structured and decaying

Memory isn't unbounded — humans forget, and new beliefs overwrite old ones:

| Mechanism | Rule |
|---|---|
| **Strength** | `strength = hits × time-decay` (forgetting curve) |
| **Decay** | Half-life default 30 days: how long without re-confirmation until strength halves |
| **Overwrite** | Same-topic new statements overwrite old (no near-synonym piling) |
| **Cap** | Default 20 entries; weakest evicted first |
| **Budget** | Injected by token budget (default 500), not "dump everything" |

Same-topic detection uses two channels: English entities (`r2` / `picx` / `main` — in tech context these are basically topic tags; two shared = same topic) plus Chinese bigram overlap. **Known boundary**: purely-Chinese paraphrases with no shared entities ("reply in Chinese" vs "always Chinese, keep technical terms in English") fall through, recorded as two. To truly fix it you'd need embeddings — not worth the weight for one edge case. Plus the model sees existing memory when recording, so dedup is mostly the model's job; `findSimilar` is only the safety net.

### Known limitation: heavy-paraphrase Chinese gets recorded twice

Same-topic detection runs on two channels — English entities (`r2` / `picx` etc.; two shared = same topic) and Chinese bigram overlap (threshold 0.3). Pure-Chinese statements that **differ by only one or two characters** merge correctly (measured similarity 0.67–0.77), but **restated freely** slips through:

| A | B | bigram similarity | Outcome |
|---|---|---|---|
| Always run tests before committing | Always run the tests once before commit | 0.77 | ✅ merged |
| Must ask me before deleting anything | Before you delete something, come ask me first | 0.18 | ❌ recorded twice |

The cause: bigram only sees surface overlap, not synonymy. With a hard entry cap, duplicates push out useful memory.

**Current workaround**: when calling `mirror_remember`, reuse the existing phrasing; if you spot a duplicate, call `mirror_forget` to drop one.
**Real fix** is synonym merging (word vectors or letting the model self-dedupe) — not done yet. This limitation is locked down by a test (`test/memory-core.test.mjs` "known defect" case); improving it later will fail that test on purpose, reminding you to update this section.

## Install

```bash
dsh plugin --profile web add @dsh-plugins/dsh-user-mirror
```

⚠️ **Only works on profiles that provide `storageDomain` and `webServer`** (i.e. `web`). A headless profile has neither — the plugin will sit in `pending (waiting for services: storageDomain, webServer)` and break boot. The first is the foundation for persistence; the second is the channel the **Memory** tab reads from.

### On ai-orb vendoring

The sole runtime dependency is [ai-orb](https://github.com/webkubor/ai-orb) (an SVG status pill, zero deps). It's declared in `dependencies` but **is not bundled into the client** — the client loads it from same-origin via `import('/dsh-mirror/vendor/ai-orb/index.js')`. The path is served by the host side, which exposes `node_modules/ai-orb/src/` as the static route `/dsh-mirror/vendor/ai-orb`.

Why not bundle: the status pill is instantiated by multiple pages at once; a separate ESM module rides on HTTP/2 multiplexing without blocking first paint. And upgrading ai-orb is just `pnpm update ai-orb` — no hand-copied source to keep in sync.

## How it works

1. The model sees existing memory in the system prompt (sorted by strength, bounded by token budget)
2. When you express a reusable judgment, the model calls `mirror_remember(text, kind, reason)`
3. Normalize + run entity/bigram dual-channel matching to decide: overwrite same-topic old memory, or add new
4. If capacity is exceeded after adding, evict the weakest entry
5. Next time the system prompt is assembled, this entry is already in it

Tool calls are visible, so "what did it record and when" you see right in the conversation. The Memory tab also shows the `reason` (why recorded) plus strength, confirmation count, and last-confirmed time.

## Configuration

Override in `cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-mirror
      name: dsh-user-mirror
      config:
        maxPreferences: 20   # Memory capacity cap (entries)
        halfLifeDays: 30     # Half-life in days; longer = slower decay
        maxTokens: 500       # Token budget for injection
        sectionOrder: 160    # Position in the system prompt (smaller = earlier)
```

## Tools

- `mirror_remember(text, kind, reason)` — record a judgment
- `mirror_forget(text, reason)` — withdraw an incorrectly-recorded one (matched by topic, exact wording not needed)

**There is no query tool, by design.** Memory is already injected into the system prompt; adding a query tool would be a second read path, eating tokens for nothing. v0.6 replaced the old `mirror_preferences` with `mirror_forget` — without withdrawal, a wrongly-recorded entry would either take half a month to decay or wait for the same-topic new statement to overwrite it (and Chinese paraphrases miss), polluting every system prompt turn in the meantime.

## Privacy

- Preferences stay local (`~/.dsh/storages/`)
- No network, no upload
- Want to wipe? Delete the `dsh_mirror` domain

## License

MIT © [webkubor](https://github.com/webkubor)