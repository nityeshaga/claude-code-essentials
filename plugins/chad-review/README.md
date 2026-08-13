# Chad Review

Strip the showing-off. Make any artifact — code, a prompt, a skill, a doc, a landing page — survive Chad: an impatient user who only cares about getting his job done and refuses to be impressed.

![Chad Review, explained as a one-page comic](assets/chad-review-comic.png)

## Why

AI output *shows off*: it reaches for the clever word, the metaphor, the caveat nobody needed, the bit of self-narration — because it doesn't trust the material to be interesting on its own. That performance buries the job under noise.

<img src="assets/chad.png" width="170" align="right" alt="Chad. Yes, that Chad.">

Chad is the antidote. He gets one piece of context — the **crux**, the job the artifact is there to do — and meets it cold, like anyone who lands on it with a job to do. Cleverness for its own sake doesn't land on him. He doesn't rewrite; he asks sharp, dumb questions ("wait, why is this here?", "why say it this fancy way?"). A defender then ties each span to the crux or remakes it plainer, and a *fresh* Chad re-reads the rewrite so new showing-off can't sneak back in.

There is no symptom checklist — a list of tells overfits to prose and dies on a diagram or a code plan. The detector is Chad's posture, not a list, which is why it ports to anything.

## What's inside

- **`workflows/chad-review.js`** — the workflow. Clone → crux → Chad (interrogate + defend, up to 2 rounds) → judge → plan of plainer rewrites + ranked add-back menu + a Chad report.
- **`skills/chad-review/`** — the accompanying skill that tells an agent when and how to reach for the workflow (directly, or adapted).

## Use it

Ask Claude Code to "strip the showing-off from X", "make this plainer", or "run Chad on this file" — the skill triggers and runs the workflow. Or invoke it directly:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/chad-review.js",
  args: { path: "<file or directory>", crux: "<the job it's there to do, in plain words>" }
})
```

It returns a plan you review and apply as a diff/PR. See the skill for the full contract.

## Sibling

For the *subtractive* axis — cutting what isn't load-bearing rather than flattening what shows off — see the **elon-algorithm** plugin. Chad strips the performance; Elon's algorithm deletes the bloat.

## Install

Add the `claude-code-essentials` marketplace and install the `chad-review` plugin.
