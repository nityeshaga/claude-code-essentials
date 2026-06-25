---
name: elon-algorithm
description: >-
  Aggressively simplify any artifact — code, a prompt, a skill, a doc, or prose — by running Elon's
  algorithm (question every requirement → delete → simplify) on a clone of it via an agent swarm, then
  returning a reviewable cut-plan. Use whenever you want to cut AI slop, trim bloat, de-pad a file, make
  something leaner/denser, "delete what isn't load-bearing", or shrink an over-engineered artifact without
  losing what matters. Especially for AI-generated output, which is *additive* by nature (padded,
  over-explained, over-built) — this is the subtractive antidote. Triggers: "cut the slop", "make this
  leaner", "trim this skill/prompt", "this is over-engineered", "run the Elon algorithm on X".
---

# Elon Algorithm — cut AI slop, keep what's load-bearing

AI output is *additive*: it pads, hedges, over-explains, and invents requirements nobody asked for. Elon's algorithm is *subtractive* — the exact antidote. This skill runs it on any artifact and hands you a cut-plan to review.

## The algorithm (the per-artifact filter)

1. **Question every requirement** — trace each part back to a real ask. If no human/prompt asked for it, it's a cut candidate. Requirements the model invented and stated confidently are the most dangerous.
2. **Delete** — default to removing; you add back only the ~10% that something concrete breaks without.
3. **Simplify** what survives.

(Steps 4–5, *accelerate* and *automate*, are about the factory, not the part — out of scope for a single-artifact pass.)

## How the workflow works

It **clones** the artifact first (the original is never touched), then runs four phases:

- **Bird's-eye pass** — cross-file fate you can only see by looking *across* files: whole files/dirs that duplicate each other (mirror trees, vendored docs restating guidance), with each redundancy mapped to its canonical home.
- **Per-file pass** — one coarse outcome per surviving file: a leaner rewrite, a whole-file delete, or keep. (Files sealed for deletion above aren't re-simplified — don't polish a part you're removing.)
- **Asymmetric debate** — per proposed cut, a lone objection must name a *concrete* breakage (a lost instruction, the sole place a fact appears, a dangling reference); "it's useful / adds context" doesn't count. The deletion side gets the **last word**.
- **Cut-by-default judge** — one coherent knife. Keeps something only if a concrete objection survived the rebuttal. Returns a cut-plan + a **ranked add-back menu** (least-confident cuts first, for the human to restore their 10%).

The output is a **plan, not a blind rewrite** — you review it and apply it as a diff/PR, staying in the loop at the deletion step where the human belongs.

## Run it

The four phases above are the *spirit* of the algorithm, not a tool. How you run them depends on the size of the artifact:

### Small artifact (a single file, or a couple) — run it directly

When the target is one file or a small handful, you **don't need the workflow**. The bird's-eye/cross-file pass exists for multi-file trees; with one or two files there's almost nothing to see across them. Just run the algorithm yourself: clone the target so the original is never touched, then launch sub-agents directly to follow the spirit — e.g. one reviewer per file proposing cuts/rewrites, one skeptic arguing each cut back (deletion gets the last word), then judge cut-by-default and hand back a cut-plan + ranked add-back menu. Same `clone → review → debate → judge` shape, no dynamic workflow.

This is the lighter, faster default for most "trim this one file/prompt/skill" asks.

### Large or multi-file artifact (a directory, a bundle, a mirror tree) — use the workflow

When the target spans many files, invoke the bundled **Workflow**, which orchestrates the full fan-out deterministically:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/elon-algorithm.js",
  args: {
    path: "<file OR directory/bundle to simplify>",
    standardHint: "<the standard the artifact aspires to>"
  }
})
```

- **`path`** — a single file, or a whole directory/bundle (the bird's-eye pass handles multi-file artifacts). Use **`text`** instead for inline content with no file.
- **`standardHint`** *(optional but high-leverage)* — the taste/standard to judge against: a style rule, a skill's own doctrine, "every line must change agent behavior at a decision point", etc. The sharper the standard, the sharper the cuts.

It returns `{ cloneRoot, proposals, plan }` — `plan.decisions` (per-target verdict + confidence) and `plan.addBackMenu`. Hand that to a fresh agent to apply as a PR; don't burn your own context materializing edits.

## Adapt it

The workflow is a starting point, not a black box. Copy `workflows/elon-algorithm.js`, tweak the lenses, the phases, or the prompts for your artifact, and run your version. The reusable shape is **clone → review → debate → judge**; everything else is tuning.

## When to use

- Trimming a bloated skill, prompt, system message, or doc.
- Reviewing AI-generated code or writing for slop before it ships.
- Any "make this leaner / denser / less over-engineered" ask on an artifact you can point at.
