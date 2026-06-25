# Authoring Contract — "Writing Rails, the 37signals Way" skill

You are writing ONE reference file of a SKILL: an operating manual loaded by AI agents while they write, review, or architect Rails code. The reader is a capable agent that already knows standard Rails mechanics. What it lacks is 37signals doctrine and the discipline to resist its own defaults (service objects, JSON APIs, React-shaped thinking, hand-maintained state). Make it default to Rails + Hotwire and produce 37signals-grade code, backend and frontend.

Patterns are mined from two shipped 37signals products: **Campfire** (chat) and **Fizzy** (Kanban). When both products reach for the same move, it's doctrine — say so.

## Form

- **Imperative and dense.** Every line load-bearing: doctrine, decision rules, code. No narrative.
- **Every pattern answers four questions** (no rigid headers, but all four present):
  - **When** — the situation that calls for it
  - **Do** — the move, with code
  - **Not** — the default the agent reaches for instead, as a guardrail: "You will be tempted to X — don't."
  - **Why** — one or two sentences: the edge cases absorbed, the bug class deleted
- **Code: complete and self-contained**, adapted from Campfire/Fizzy. Keep provenance tags like "(Campfire)" — they carry authority. NO file:line citations, NO links (the reader can't open them); include any context a snippet needs inline.
- **Open with** a one-line "Read this when …" sentence, then a table of contents.
- **Cross-reference sibling files by filename** (e.g., "see `06-morphing-live-updates.md`") instead of re-explaining what another file owns. Respect scope boundaries.
- **Don't teach Rails basics** (partials, `rails new`, migrations). Teach the 37signals way and the *deltas* from the agent's default.
- Markdown headings; tables where they compress; fenced code blocks with language tags.

## Vocabulary

`01-doctrine.md` is the canonical source for the rule phrasings (P1–P9). Use its exact phrases as the skill's shared language; don't re-define them here. Two cross-cutting yardsticks apply everywhere: **"Count the edge cases this line absorbs for free"** and **"Rails stays small because each layer trusts a convention at its boundary."**

## Quality bar

- Your sources' frontmatter `concepts:` lists are your coverage checklist — every concept within your scope must appear with its operative detail (the code move, not just the name). An audit will diff your file against those lists; gaps get flagged.
- Prefer tables for red-flag→fix mappings, option/variant comparisons, and vocabulary.
- When patterns interlock (e.g., `touch:` + `broadcasts_refreshes` + `turbo_stream_from` = multiplayer), show the composition explicitly — composition is the skill's deepest lesson.