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

### coding-tutor

Personalized coding tutorials that use your actual codebase for examples with spaced repetition quizzes.

**Features:**
- Personalized onboarding to understand your learning goals
- Tutorials that use YOUR code as examples
- Spaced repetition quiz system to reinforce learning
- Tracks your progress across tutorials
- Curriculum planning based on your current knowledge

**Usage:**
- "Teach me about React hooks"
- "Quiz me on something"
- "What should I learn next?"

**Commands:**
- `/teach-me` - Learn something new
- `/quiz-me` - Test your retention with spaced repetition

**Storage:**
All tutorials and learning data are stored securely in the cloud, synced automatically across all your devices and Claude platforms. Your data is tied to your account and accessible wherever you use Claude.

---

### basics

Essential Claude Code commands, agents, hooks, and skills for everyday development workflows.

**Commands (12):**
`/cc`, `/cleanup`, `/compound`, `/create-developer-doc`, `/create-pitch`, `/depcheck`, `/gem-upgrade`, `/logically-commit`, `/pinpoint`, `/review`, `/study`, `/tidy-commits`

**Agents (1):**
- `dhh-reviewer` - DHH-style code reviewer

**Hooks:**
- `block-main-push` - Prevents accidental git pushes to main branch

**Skills (6):**
- `ai-tool-designer` - Designing tools for AI agents
- `beautiful-rails-like-dhh` - Write, review, and architect Rails apps the 37signals way — full backend + frontend (Hotwire) doctrine mined from Campfire and Fizzy, with the official Hotwire handbooks vendored in
- `kamal-deploy` - Expert Kamal deployment for containerized apps
- `mcp-builder` - MCP server development guide
- `prompt-engineer` - Prompt engineering for AI systems
- `skill-creator` - Guide for creating Claude skills

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
