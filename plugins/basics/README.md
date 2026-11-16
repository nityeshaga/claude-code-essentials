# Basics

Essential Claude Code commands, agents, hooks, and skills for everyday development workflows.

## Installation

1. Run `/plugin` to open the plugin manager
2. Go to **Marketplaces** tab (use Tab to cycle)
3. Select **+ Add Marketplace** → enter `nityeshaga/claude-code-essentials`
4. Go to **Discover** tab and select **basics** to install

## Commands

| Command | Description |
|---------|-------------|
| `/cc` | Commit changes |
| `/cleanup` | Rails code review with architecture and quality analysis |
| `/compound` | Reflect on session learnings and extract tacit knowledge |
| `/create-developer-doc` | Generate developer documentation |
| `/depcheck` | Analyze Dependabot PRs for safe merging |
| `/gem-upgrade` | Analyze gem upgrade impact with release notes and commits |
| `/pinpoint` | Investigate and pinpoint root cause before suggesting solutions |
| `/review` | Objective branch review for code smells and unintended changes |
| `/tidy-commits` | Organize changes into reviewable commits |

## Hooks

| Hook | Description |
|------|-------------|
| `rubocop-autocorrect` | Runs `bin/rubocop -a` on a file after Claude edits it, in projects that have `bin/rubocop` |

The `block-main-push` hook used to ship here. It now lives only in the [safe-push plugin](../safe-push/README.md); install that if you want pushes to main blocked.

## Skills

| Skill | Description |
|-------|-------------|
| `ai-tool-designer` | Designing tools for AI agents with agent-centric design principles |
| `dhh-rails-expert` | Writing and reviewing Rails code following DHH's style |
| `kamal-deploy` | Expert-level Kamal deployment guidance for containerized apps |
| `prompt-engineer` | Prompt engineering for AI systems |
