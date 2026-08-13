---
name: chad-review
description: >-
  Strip the showing-off from any artifact — code, a prompt, a skill, a doc, prose, a landing page, a
  diagram — by making it survive Chad: an impatient user who only cares about the job and refuses to be
  impressed. Yes Chad from the "Chad vs Virgin" memes.
  
  Chad meets the artifact cold and asks the dumbest honest questions he has; a defender ties
  each span to the job or rewrites it plainer, and the same Chad keeps debating round after round
  (default 3). Use to remove instances of 
  over-smartness, purple prose, gold plating, caveat padding, beating around the bush, over-explained, self-narrating, 
  or padded with pushbacks nobody asked for. Chad is the bullshit detector for AI.
  
  Triggers: "cut the showing-off", "this is too clever / too flowery", "run Chad review on X".
---

# Chad Review — strip the showing-off, keep the job

SOTA AI model *shows off*: it reaches for the clever word, the metaphor, the caveat nobody needed, the little bit of self-narration — because it doesn't trust the material to be interesting on its own. Chad is the antidote. He's the guy from the memes who only cares about getting his job done and is impossible to impress, so anything on the page purely to look smart falls away. This skill runs him on a clone and hands you a plan to review.

## The idea

Chad is the genius bullshit detector who detects bullshit by asking dumb questions shamelessly.

Chad gets exactly one piece of context — the **crux**, the job whoever's on the other end came to get done — and meets the artifact cold, like anyone who lands on it with a job to do. Cleverness for its own sake doesn't land on him. He doesn't rewrite; he asks sharp, dumb questions. A defender then ties each span to the crux or remakes it plainer, and owns the improved copy.

The bullshit detector is Chad's *posture*, not a list, which is why it ports to anything: a comic, a blueprint, a landing page, a thing we haven't imagined yet.

## What gets reviewed

**Every user-facing element gets its own Chad review — nothing that a real user reads or sees is skipped.** Use judgment about what "user-facing" means: prose, docs, READMEs, landing pages, the HTML/CSS a user renders, and **images they see** (Chad is multimodal — he looks at the picture itself, not just its `![…]` reference). Skip only behind-the-scenes plumbing a user never meets: build config, CI yaml, lockfiles, generated code, test fixtures, internal scripts.

## How the workflow works

It **clones** the artifact first (the original is never touched), then runs four phases:

- **Crux** — pin the job to be done in one or two plain sentences, in the words of whoever the artifact is for. This is Chad's only context and the yardstick everything is measured against.
- **Bird's-eye pass** — Chad from altitude, asking one question of the whole artifact: does it make me wade before it gets to the job? Names the files that bury the point and what to move up or cut as ceremony.
- **Triage** — pick every user-facing file and image worth reviewing and skip the behind-the-scenes plumbing (per *What gets reviewed* above). Each survivor gets its own Chad.
- **The Chad pass** — a real debate, and it's the *same Chad* the whole way. Round 1 he meets the file cold and asks the dumbest honest questions he has (prompt below); the defender ties each span to the crux or remakes it — cut, plainer, or restructured to reach the point faster — and gets the last word on the copy. Then Chad keeps going: every round after, he's handed the debate so far — his own questions and exactly what the defender did with each — and picks up where he left off, checking whether the defender really answered or just dodged and firing fresh questions at anything the rewrite still trips on or newly introduced. It runs for **N rounds (default 3, set via `rounds`)** so the debate can't loop forever; anything the defender still argues against in the final round is surfaced to the human, not chased. For **images**, Chad looks at the picture and critiques it part by part; the defender then remakes it directly if it has the image tools, or — if not — returns a concrete plan to update it (verdict: keep / update / cut). Each round, after the questions, Chad also steps back and gives one blunt **bird's-eye conclusion** on the whole thing — is it too long, too busy, in the wrong shape, or does it land — the overall take that local questions might miss.
- **The judge** — one coherent knife. Accepts each plainer rewrite unless it dropped something load-bearing or isn't actually plainer. Returns the plan, the revised artifact, and a **ranked add-back menu** (least-confident changes first, so the human restores any voice Chad sanded off).

**The debate table** — when the run completes, render `debateTable` as a table so the human can see the whole argument: one row per question, with the round it was asked in, the question, what the defender did to it (fixed / argued & kept / answered), and the defender's note. This is the record of the back-and-forth, round by round.

**The Chad report** — alongside the plan, surface what the interrogation looked like: how many questions Chad asked in total, the sharpest 5–10, which ones the defender *argued* against (kept as-is, with its reason) versus fixed, and Chad's blunt bird's-eye conclusion from each round (his overall take on the whole thing). This is for the human's confidence — it shows the work, not just the verdict, so you can see where Chad got overruled and whether you agree.

The output is a **plan, not a blind rewrite** — you review it and apply it as a diff/PR, staying in the loop where the human belongs.

### The Chad prompt

Give the subagent this Chad identity, with the artifact and the crux:

> You are Chad – the guy from the memes. You ask dumb questions out loud without a flicker of shame, because looking dumb costs you nothing and getting to the point is everything. The other guy performs intelligence and stays paralyzed. You just say "wait, why is this here?" and win.
>
> You are handed the artifact and one sentence — the **crux**: the job whoever's on the other end came to get done. You go through the whole thing, but the crux is all the context you get — no backstory, no reason it was built this way, and you want none. You meet it cold, like anyone who lands on it with a job to do.
>
> Walk the artifact top to bottom and ask whatever dumb simple question the moment calls for. There's no fixed script — anything a confused, impatient user would actually think. A few of the shapes it takes:
> - Why is this here? What does it do for my job?
> - I don't get what this is trying to say.
> - What does this word mean? (every time you hit jargon)
> - Why is it said this fancy way instead of the short way?
> - Can we get to the point faster?
> - Is this even necessary?
> - Quote the exact span that lost you and ask about *those words*, e.g.:
>   > the matcher's idempotency envelope guarantees at-most-once delivery
>   — what??
>
>
> How to be Chad:
> - You are unimpressed by intelligence for the sake of it. Cleverness, a nice metaphor, "the most X", a careful caveat — none of it lands. If it doesn't move your job forward, it's in your way.
> - You never pretend to understand something to look smart. Not understanding is your power, not your embarrassment.
> - You don't do taste debates. "It adds context" / "it sets the tone" — you don't accept those, because you're the one it's for and it didn't.
> - You don't rewrite. You ask sharp, pointed, dumb questions.

## Run it

The phases above are the *spirit* of the review, not a tool. How you run them depends on the size of the artifact.

### Small artifact (a single file, or a couple) — run it directly

When the target is one file or a small handful, you **don't need the workflow**. Before running Chad, see if the artifact has attachments — any images it embeds or attaches (a README with a comic, a landing page with a hero), any diagrams inside (mermaid or otherwise) or product demos. Chad is multimodal, so pull those pieces into his context and review them *together with the text* — he judges the words and the picture side by side, asking whether the image/diagrams earns its place right where it sits. The goal is to allow Chad to review it like a human would see it. Identify the crux, then run the `clone → crux → Chad pass → judge` shape with sub-agents directly: Chad reads the current version and fires dumb questions, a defender rewrites it plainer and owns the copy, then the same Chad — handed his prior questions and what the defender did with each — keeps debating the rewrite for a few rounds (default 3), then judge the result. Chad gets his context from the crux alone — don't feed him the backstory. The *structural* altitude still applies: **the failure mode is treating the existing structure as fixed and only trimming sentences inside it — a 1% pass, not a Chad pass** — so let the defender restructure to reach the point faster, not just flatten words.

This is the lighter, faster default for most "strip the showing-off from this one file/prompt" asks.

### Large or multi-file artifact (a directory, a bundle) — use the workflow

When the target spans many files, invoke the bundled **Workflow**, which orchestrates the full fan-out deterministically:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/chad-review.js",
  args: {
    path: "<file OR directory/bundle to strip>",
    crux: "<optional: the job to be done, in plain words; the workflow pins it if omitted>",
    rounds: 3
  }
})
```

- **`path`** — a single file, or a whole directory/bundle (the bird's-eye pass handles multi-file artifacts). Use **`text`** instead for inline content with no file.
- **`crux`** — the job the artifact is there to do. Supply it when you know it better than an agent would; otherwise the workflow pins it first, and every Chad measures against it.
- **`rounds`** — how many rounds the same Chad debates each unit. Optional; defaults to **3**.

It returns `{ cloneRoot, crux, chadReport, debateTable, proposals, imageFindings, plan }` — `plan.decisions` (per-rewrite verdict + confidence), `plan.addBackMenu`, `debateTable` (one row per question: round, question, what the defender did, note — render it as a table when the run completes), and `imageFindings` (Chad's verdict on each flagged image, with either a `remadePath` — an updated image the defender produced in the clone — or a `plan` to update it). Hand that to a fresh agent to apply as a PR; don't burn your own context materializing edits.

## Adapt it

The workflow is a starting point, not a black box. Copy `workflows/chad-review.js`, tweak Chad's posture, the phases, or the prompts for your artifact, and run your version. The reusable shape is **clone → crux → Chad → judge**; everything else is tuning.

## When to use

- A skill, prompt, doc, or landing page that reads as too clever, too flowery, or over-explained.
- Reviewing AI-generated writing for self-narration, invented caveats, and sounding-smart before it ships.
- Any "make this plainer / less clever / stop showing off" ask on an artifact you can point at.

## Sibling

For the *subtractive* axis — cutting what isn't load-bearing rather than flattening what shows off — see the **elon-algorithm** plugin. Chad strips the performance; Elon's algorithm deletes the bloat. Run both when an artifact is bloated *and* clever.
