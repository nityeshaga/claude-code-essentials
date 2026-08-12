---
name: chad-review
description: >-
  Strip the showing-off from any artifact — code, a prompt, a skill, a doc, prose, a landing page, a
  diagram — by making it survive Chad: an impatient user who only cares about the job and refuses to be
  impressed. Chad meets the artifact cold and asks the dumbest honest questions he has; a defender ties
  each span to the job or rewrites it plainer; a fresh Chad re-reads the rewrite. Returns a reviewable
  plan of plainer rewrites, never touching the original. Use whenever something is too clever, too
  flowery, over-explained, self-narrating, or padded with caveats nobody asked for. Triggers: "cut the
  showing-off", "make this plainer", "this is too clever / too flowery", "strip the fluff", "run Chad on X".
---

# Chad Review — strip the showing-off, keep the job

AI output *shows off*: it reaches for the clever word, the metaphor, the caveat nobody needed, the little bit of self-narration — because it doesn't trust the material to be interesting on its own. Chad is the antidote. He's the guy who only cares about getting his job done and is impossible to impress, so anything on the page purely to look smart falls away. This skill runs him on a clone and hands you a plan to review.

## The idea

There is no symptom checklist — no "watch for metaphors, superlatives, hedges." A list of tells overfits to prose and dies on a diagram or a code plan. The detector is Chad's *posture*, not a list, which is why it ports to anything: a comic, a blueprint, a landing page, a thing we haven't imagined yet.

Chad gets exactly one piece of context — the **crux**, the job whoever's on the other end came to get done — and meets the artifact cold, like anyone who lands on it with a job to do. Cleverness for its own sake doesn't land on him. He doesn't rewrite; he asks sharp, dumb questions. A defender then ties each span to the crux or remakes it plainer, and owns the improved copy.

## How the workflow works

It **clones** the artifact first (the original is never touched), then runs four phases:

- **Crux** — pin the job to be done in one or two plain sentences, in the words of whoever the artifact is for. This is Chad's only context and the yardstick everything is measured against.
- **Bird's-eye pass** — Chad from altitude, asking one question of the whole artifact: does it make me wade before it gets to the job? Names the files that bury the point and what to move up or cut as ceremony.
- **The Chad pass** — Chad meets each part cold and asks the dumbest honest questions he has. The defender ties each span to the crux, or remakes it — plainer, or restructured to reach the point faster — and gets the last word (Chad is doing it a service; the defender owns the copy). Then it runs **again**: a *fresh* Chad, with no memory of the first round, cold-reads the rewrite, and the defender gets one more pass. This second round is where most residue dies — the rewrite is a new generation, so it can smuggle in fresh showing-off the first Chad never saw. Capped at **two rounds** so the polish can't loop forever; anything the defender still argues against in that final pass is surfaced to the human, not chased. Each round, Chad also gives one blunt **bird's-eye conclusion** on the whole thing — too long, too busy, wrong shape, or does it land.
- **The judge** — one coherent knife. Accepts each plainer rewrite unless it dropped something load-bearing or isn't actually plainer. Returns the plan, the revised artifact, and a **ranked add-back menu** (least-confident changes first, so the human restores any voice Chad sanded off).

Alongside the plan comes the **Chad report**: how many questions Chad asked, the sharpest 5–10, which ones the defender *argued* against (kept as-is, with its reason) versus fixed, and Chad's bird's-eye conclusion each round. It shows the work, not just the verdict, so you can see where Chad got overruled and whether you agree.

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

When the target is one file or a small handful, you **don't need the workflow**. Pin the crux, then run the `clone → crux → Chad pass → judge` shape with sub-agents directly: a fresh Chad reads the current version and fires dumb questions, a defender rewrites it plainer and owns the copy, a second fresh Chad re-reads that rewrite (two rounds), then judge the result. Chad gets his context from the crux alone — don't feed him the backstory, that's the whole point.

This is the lighter, faster default for most "strip the showing-off from this one file/prompt" asks.

### Large or multi-file artifact (a directory, a bundle) — use the workflow

When the target spans many files, invoke the bundled **Workflow**, which orchestrates the full fan-out deterministically:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/chad-review.js",
  args: {
    path: "<file OR directory/bundle to strip>",
    crux: "<optional: the job to be done, in plain words; the workflow pins it if omitted>"
  }
})
```

- **`path`** — a single file, or a whole directory/bundle (the bird's-eye pass handles multi-file artifacts). Use **`text`** instead for inline content with no file.
- **`crux`** — the job the artifact is there to do. Supply it when you know it better than an agent would; otherwise the workflow pins it first, and every Chad measures against it.

It returns `{ cloneRoot, crux, chadReport, proposals, plan }` — `plan.decisions` (per-rewrite verdict + confidence) and `plan.addBackMenu`. Hand that to a fresh agent to apply as a PR; don't burn your own context materializing edits.

## Adapt it

The workflow is a starting point, not a black box. Copy `workflows/chad-review.js`, tweak Chad's posture, the phases, or the prompts for your artifact, and run your version. The reusable shape is **clone → crux → Chad → judge**; everything else is tuning.

## When to use

- A skill, prompt, doc, or landing page that reads as too clever, too flowery, or over-explained.
- Reviewing AI-generated writing for self-narration, invented caveats, and sounding-smart before it ships.
- Any "make this plainer / less clever / stop showing off" ask on an artifact you can point at.

## Sibling

For the *subtractive* axis — cutting what isn't load-bearing rather than flattening what shows off — see the **elon-algorithm** plugin. Chad strips the performance; Elon's algorithm deletes the bloat. Run both when an artifact is bloated *and* clever.
