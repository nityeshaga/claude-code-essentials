---
name: elon-algorithm
description: >-
  Aggressively simplify any artifact — code, a prompt, a skill, a doc, prose, a landing page, a diagram —
  by running Elon's algorithm (question every requirement → delete → simplify) on a clone of it, then
  returning a reviewable cut-plan. Alongside the cut, a bullshit detector strips showing-off — purple
  prose, gold-plating, invented caveats, self-narration, sounding-smart — by making the artifact survive
  someone who only cares about the job and refuses to be impressed. Use whenever you want to cut AI slop,
  kill over-engineering, de-pad a file, make something leaner or plainer, "delete what isn't load-bearing",
  or "cut the showing-off". Triggers: "cut the slop", "make this leaner", "this is over-engineered",
  "too clever / too flowery", "run the Elon algorithm on X".
---

# Elon Algorithm — cut AI slop, keep what's load-bearing

AI output is *additive*: it pads, hedges, over-explains, and invents requirements nobody asked for. It also *shows off* — reaches for the clever word, the metaphor, the caveat nobody needed, the little bit of self-narration — because it doesn't trust the material to be interesting on its own. Elon's algorithm is the subtractive antidote. This skill runs it on a clone and hands you a plan to review.

## The algorithm (the per-part filter)

1. **Question every requirement** — trace each part back to a real ask. If no human/prompt asked for it, it's a cut candidate. Requirements the model invented and stated confidently are the most dangerous.
2. **Delete** — default to removing; add back only the ~10% that something concrete breaks without.
3. **Simplify** what survives.

(Steps 4–5, *accelerate* and *automate*, are about the factory, not the part — out of scope for a single-artifact pass.)

## How the workflow works

It **clones** the artifact first (the original is never touched), then judges everything against two questions at once — *is this load-bearing?* and *does it serve the job to be done, the simplest way?* — across these phases:

- **Crux** — pin the job to be done in one or two plain sentences, in the words of whoever the artifact is for. This is the yardstick everything downstream is measured against.
- **Bird's-eye pass** — the fate you can only see *across* files: whole files/dirs that duplicate each other (each mapped to its canonical home), and structure that buries the point (reorder, front-load, cut the ceremony before the payoff).
- **Per-file pass** — one coarse outcome per surviving file: a leaner rewrite, a delete, or keep. (Files sealed for deletion above aren't re-simplified — don't polish a part you're removing.)
- **Two passes on what survives:**
  - **The deletion debate** — per proposed cut, a lone objection must name a *concrete* breakage (a lost instruction, the sole place a fact appears, a dangling reference); "it's useful / adds context" doesn't count. Deletion gets the last word.
  - **The Chad pass** — Chad meets the artifact cold and asks the dumbest honest questions he has (prompt below). The defender ties each span to the crux, or remakes it — cut, plainer, or restructured to reach the point faster. The defender gets the last word: Chad is doing it a service, and the defender owns the improved copy.
- **The judge** — one coherent knife. Keeps a cut only if a concrete objection survived the rebuttal; applies the Chad rewrite on what remains (a delete beats a rewrite on the same span). Returns a cut-plan, the revised artifact, and a ranked add-back menu (least-confident changes first, so the human restores their 10% — including any voice Chad sanded off).

No symptom list, ever — a checklist of tells ("watch for metaphors, superlatives…") overfits to prose and dies on a diagram or a code plan. The detector is Chad's *posture*, not a list, which is why it ports to anything: a comic, a blueprint, a landing page, a thing we haven't imagined yet.

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

The phases above are the *spirit* of the algorithm, not a tool. How you run them depends on the size of the artifact.

### Small artifact (a single file, or a couple) — run it directly

When the target is one file or a small handful, you **don't need the workflow** — but the *structural* altitude still applies. The cross-file pass is moot with one file; questioning whether each **section / block / requirement deserves to exist** is not, and that's where the deepest cuts live. So attack structure before copy: default to deleting or merging whole sections, then simplify the survivors line-by-line. **The failure mode is treating the existing structure as fixed and only trimming sentences inside it — a 1% pass, not an Elon pass.** Pin the crux, then run the `clone → review → { deletion debate + Chad pass } → judge` shape with sub-agents directly, no dynamic workflow.

This is the lighter, faster default for most "trim this one file/prompt/skill" asks.

### Large or multi-file artifact (a directory, a bundle, a mirror tree) — use the workflow

When the target spans many files, invoke the bundled **Workflow**, which orchestrates the full fan-out deterministically:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/elon-algorithm.js",
  args: {
    path: "<file OR directory/bundle to simplify>",
    crux: "<optional: the job to be done, in plain words; the workflow finds it if omitted>",
    standardHint: "<optional: the standard the artifact aspires to>"
  }
})
```

- **`path`** — a single file, or a whole directory/bundle (the bird's-eye pass handles multi-file artifacts). Use **`text`** instead for inline content with no file.
- **`crux`** — the job the artifact is there to do. Supply it when you know it better than an agent would; otherwise the workflow pins it first and the Chad pass measures against it.
- **`standardHint`** *(optional but high-leverage)* — the taste/standard to judge against: a style rule, a skill's own doctrine, "every line must change agent behavior at a decision point". The sharper the standard, the sharper the cuts.

It returns `{ cloneRoot, proposals, plan }` — `plan.decisions` (per-target verdict + confidence) and `plan.addBackMenu`. Hand that to a fresh agent to apply as a PR; don't burn your own context materializing edits.

## Adapt it

The workflow is a starting point, not a black box. Copy `workflows/elon-algorithm.js`, tweak the lenses, the phases, or the prompts for your artifact, and run your version. The reusable shape is **clone → review → { delete + Chad } → judge**; everything else is tuning.

## When to use

- Trimming a bloated skill, prompt, system message, or doc.
- Reviewing AI-generated code, writing, or a landing page for slop and showing-off before it ships.
- Any "make this leaner / plainer / less clever / less over-engineered" ask on an artifact you can point at.
