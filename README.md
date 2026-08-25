# Claude Code Essentials

A marketplace of essential Claude Code plugins for developers.

## Installation

1. Run `/plugin` to open the plugin manager
2. Go to **Marketplaces** tab (use Tab to cycle between tabs)
3. Select **+ Add Marketplace**
4. Enter: `nityeshaga/claude-code-essentials`
5. Press Enter to add

Then install plugins from the **Discover** tab.

## Available Plugins

### elon-algorithm

Run Elon's algorithm (question every requirement → delete → simplify) on any artifact to cut AI slop and make code, prompts, skills, or docs leaner and denser. Ships a reusable workflow + an accompanying skill.

**Usage:**
- "Cut the slop from this skill"
- "Make this prompt leaner"
- "This file is over-engineered — run the Elon algorithm on it"

**What's inside:**
- `workflows/elon-algorithm.js` - clone → bird's-eye + per-file review → asymmetric debate → cut-by-default judge → cut-plan + ranked add-back menu
- `skills/elon-algorithm` - when and how to reach for the workflow

---

### basics

Essential Claude Code commands, agents, hooks, and skills for everyday development workflows.

**Commands (11):**
`/cc`, `/cleanup`, `/compound`, `/create-developer-doc`, `/depcheck`, `/gem-upgrade`, `/help-me-write`, `/interview-me`, `/pinpoint`, `/review`, `/tidy-commits`

**Hooks:**
- `block-main-push` - Prevents accidental git pushes to main branch

**Skills (4):**
- `ai-tool-designer` - Designing tools for AI agents
- `beautiful-rails-like-dhh` - Write, review, and architect Rails apps the 37signals way — full backend + frontend (Hotwire) doctrine mined from Campfire and Fizzy, with the official Hotwire handbooks vendored in
- `kamal-deploy` - Expert Kamal deployment for containerized apps
- `prompt-engineer` - Prompt engineering for AI systems

---

### safe-push

Prevents accidental pushes to main branch in Claude Code bypassPermissions mode.

**Important:** Install at the **user level** (`~/.claude/settings.json`) to protect all repositories.

**The vulnerability:** If Repo A has `basics` installed at project level but Repo B has no plugin, Claude running in Repo B can push to Repo A's main branch via `git -C /path/to/RepoA push origin main`. Project-level hooks don't help - protection depends on where Claude runs, not the target repo.

**Hooks:**
- `block-main-push` - Blocks git pushes to main branch (PreToolUse on Bash)

See [safe-push README](./plugins/safe-push/README.md) for installation instructions and technical details.

## Contributing

Want to add a plugin to this marketplace? Open a PR!

## License

MIT
