# Claude Code Essentials

A marketplace of essential Claude Code plugins for developers.

## Installation

Add this marketplace to Claude Code:

```
/plugin marketplace add https://github.com/nityeshaga/claude-code-essentials
```

## Available Plugins

### coding-tutor

Personalized coding tutorials that use your actual codebase for examples with spaced repetition quizzes.

**Install:**
```
/plugin install coding-tutor@claude-code-essentials
```

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
- `/sync-tutorials` - Sync your tutorials to GitHub for backup

**Storage:**
Tutorials are stored at `~/coding-tutor-tutorials/`. This is auto-created on first use and shared across all your projects. The `source_repo` field in each tutorial tracks which codebase the examples came from.

---

### basics

Essential Claude Code commands, agents, hooks, and skills for everyday development workflows.

**Install:**
```
/plugin install basics@claude-code-essentials
```

**Commands (15):**
`/cc`, `/cleanup`, `/commit-push`, `/create-developer-doc`, `/create-pitch`, `/depcheck`, `/fix`, `/issue`, `/pinpoint`, `/plan`, `/review`, `/study`, `/tailwind-upgrade`, `/teach`, `/work`

**Agents (3):**
- `code-polisher` - Rails refactoring expert
- `dhh-reviewer` - DHH-style code reviewer
- `tech-advisor` - Technical solution architect

**Hooks:**
- `block-main-push` - Prevents accidental git pushes to main branch

**Skills (4):**
- `ai-tool-designer` - Designing tools for AI agents
- `mcp-builder` - MCP server development guide
- `prompt-engineer` - Prompt engineering for AI systems
- `skill-creator` - Guide for creating Claude skills

## Contributing

Want to add a plugin to this marketplace? Open a PR!

## License

MIT
