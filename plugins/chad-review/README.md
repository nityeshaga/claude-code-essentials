# Chad Review

A Claude Code plugin that strips the showing-off from AI-written text — code, a prompt, a doc, a landing page. It rewrites the fancy parts plain, shows you the rewrite, and touches your original only when you say so.

![Chad Review, explained as a one-page comic](assets/chad-review-comic.png)

## Why

AI output pads the job with clever words, metaphors, and caveats nobody needed — because it doesn't trust the material to be interesting on its own. Chad is the reviewer who refuses to be impressed.

<img src="assets/chad.png" width="170" align="right" alt="Chad. Yes, that Chad.">

He reads your file knowing only the job it's there to do, and asks the dumb questions: "why is this here?", "why say it this fancy way?". Anything that's only there to sound smart gets rewritten plainer; anything doing real work stays. The rewrite is itself AI-written, so it can pick up new showing-off of its own — a second Chad, reading fresh, catches that before it reaches you.

## Install

In Claude Code:

```
/plugin marketplace add nityeshaga/claude-code-essentials
/plugin install chad-review@claude-code-essentials
```

## Use it

Ask Claude Code in plain words: "strip the showing-off from X", "make this plainer", "run Chad on this file". No command needed — phrases like these make Claude pick up the plugin by itself.

If the file's job isn't obvious, say it: "run Chad on README.md — its job is to get a stranger installed in a minute." Otherwise Claude works the job out from the file and your request.

You get back the full plainer rewrite of each file, plus a ranked list of the changes Chad was least sure about, in case a rewrite cut something you meant to keep. Say "apply it" and Claude overwrites the file with the plain version — or gives you a diff, or a PR if you work in a git repo. Until then, nothing changes.

Internals and full input/output details: `skills/chad-review/SKILL.md`.

## Sibling

Chad rewrites what shows off. If your problem is extra content rather than fancy wording — whole sections that don't need to exist — use the **elon-algorithm** plugin instead. Chad strips the performance; Elon's algorithm deletes the bloat.
