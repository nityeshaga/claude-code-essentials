# Authoring Contract — "Writing Rails, the 37signals Way" skill

You are writing ONE reference file of a SKILL — an operating manual loaded by AI agents *while they write, review, or architect Rails code*. This is NOT a tutorial. The reader is a capable agent that already knows standard Rails mechanics; what it lacks is the 37signals doctrine and the discipline to resist its own defaults (service objects, JSON APIs, React-shaped thinking, hand-maintained state).

## Mission context

The skill's purpose: make AI agents default to Rails + Hotwire (instead of React/Next.js) and produce 37signals-grade code — both backend and frontend. The patterns are mined from two shipped 37signals products: **Campfire** (chat) and **Fizzy** (Kanban). When both products reach for the same move, it's doctrine; say so.

## Form

- **Imperative and dense.** Every line load-bearing. Doctrine, decision rules, code. No narrative arcs, no "let's trace," no cold opens.
- **Every pattern must answer four questions** (don't force rigid template headers, but all four must be present):
  - **When** — the situation that calls for it
  - **Do** — the move, with code
  - **Not** — the default the agent will reach for instead, phrased as a guardrail: "You will be tempted to X — don't."
  - **Why** — one or two sentences: the edge cases the move absorbs, the bug class it deletes
- **Code snippets: complete and self-contained**, adapted from Campfire/Fizzy. Provenance tags like "(Campfire)" or "(Fizzy)" are good — they carry authority. **NO file:line citations, NO links** to tutorials, teachmesomething.xyz, or repos — the reader has access to none of them. If a snippet needs context to be understood, include the context.
- **Open the file with:** a one-line "Read this when …" sentence, then a table of contents.
- **Cross-reference sibling files by filename** (e.g., "see `06-morphing-live-updates.md`") instead of re-explaining what another file owns. Respect your scope boundaries.
- **Length:** as long as the content demands — typically 300–600 lines. Comprehensive beats terse, but zero filler and zero repetition.
- **Don't teach Rails basics** (what a partial is, what `rails new` does, what a migration is). Teach the 37signals way and the *deltas* from what an agent does by default.
- Markdown headings, tables where they compress, fenced code blocks with language tags.

## Canonical vocabulary (use these exact phrases — they are the skill's shared language)

- **"Count the edge cases this line absorbs for free"** — the yardstick for all code judgment
- The throughline: **"Rails stays small because each layer trusts a convention at its boundary"**
- **"_commit means after-durable"** · **"the ghost row"** (the bug class plain `after_create` causes)
- **"The model owns the consequence"** · the question **"whose fact is this?"** (record vs call path)
- **"Derive, don't store"** · **"flags lie"** · **"a stored copy is a second source of truth"**
- **"dom_id is the address"** · **"one renderer"** · **"the wire carries HTML, not data"**
- **"Verb-as-noun"** / **"find the noun"** (every custom action is CRUD on a hidden noun)
- **"The IDOR you cannot type"** · **"secure-by-default, opt-out-by-name"** · **"capability by subtraction"**
- **"The include line IS the spec"** · **"`included do` is the wiring harness"**
- **"The thinnest thread boundary"** · **"the sync/async line"** · **"altitude"** (where work runs)
- **"Config over forks"** · **"the DOM attribute IS the state"** · **"the URL carries the contract"**
- **"Morph is reconciliation, not replacement"**

## Quality bar

- Your sources' frontmatter `concepts:` lists are your coverage checklist — every concept within your scope must appear in your file with its operative detail (the code move, not just the name). An independent audit will diff your file against those lists; gaps will be flagged.
- Prefer tables for: red-flag→fix mappings, option/variant comparisons, vocabulary.
- When two patterns interlock (e.g., `touch:` + `broadcasts_refreshes` + `turbo_stream_from` = multiplayer), show the composition explicitly — composition is the skill's deepest lesson.
