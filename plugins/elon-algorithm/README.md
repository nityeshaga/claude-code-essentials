# Elon Algorithm

Cut AI slop. Make any artifact — code, a prompt, a skill, a doc — leaner and denser by running Elon's algorithm (question every requirement → delete → simplify) on a clone of it.

## Why

AI output is *additive*: it pads, hedges, over-explains, and invents requirements nobody asked for. Left unchecked, that slop accretes into bloated skills, over-engineered code, and prompts three times longer than they need to be.

Elon's algorithm is the *subtractive* antidote. This plugin encodes it as a reusable agent workflow that clones an artifact, attacks it from a bird's-eye and a per-file altitude, stress-tests every proposed cut in an asymmetric debate where deletion gets the last word, and returns a reviewable cut-plan — so the original is never touched and the human stays in the loop at the deletion step.

It earned its place: pointed at a 12,356-line skill bundle, it proposed cutting it roughly in half — deleting a vendored mirror-doc tree the authors hadn't noticed was pure duplication — without losing a single load-bearing instruction.

## What's inside

- **`workflows/elon-algorithm.js`** — the workflow. Clone → review (bird's-eye + per-file) → asymmetric debate → cut-by-default judge → cut-plan + ranked add-back menu.
- **`skills/elon-algorithm/`** — the accompanying skill that tells an agent when and how to reach for the workflow (directly, or adapted).

## Use it

Ask Claude Code to "cut the slop from X", "make this skill/prompt leaner", or "run the Elon algorithm on this file" — the skill triggers and runs the workflow. Or invoke it directly:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/elon-algorithm.js",
  args: { path: "<file or directory>", standardHint: "<the standard it should aspire to>" }
})
```

It returns a cut-plan you review and apply as a diff/PR. See the skill for the full contract.

## Install

Add the `claude-code-essentials` marketplace and install the `elon-algorithm` plugin.
