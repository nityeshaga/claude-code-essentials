# Claude Code Essentials

A marketplace of essential Claude Code plugins for developers.

## Installation

Add this marketplace to Claude Code:

```
/plugin marketplace add https://github.com/nityeshaga/claude-code-essentials
```

## Available Plugins

### rails-tutor

Personalized Rails tutorials that use your actual codebase for examples with spaced repetition quizzes.

**Install:**
```
/plugin install rails-tutor@claude-code-essentials
```

**Features:**
- Personalized onboarding to understand your learning goals
- Tutorials that use YOUR code as examples
- Spaced repetition quiz system to reinforce learning
- Tracks your progress across tutorials
- Curriculum planning based on your current knowledge

**Usage:**
- "Teach me about ActiveRecord associations"
- "Quiz me on Rails concepts"
- "What should I learn next?"

**Commands:**
- `/teach-me` - Learn something new!
- `/sync-tutorials` - Sync your tutorials to a companion GitHub repo for backup and mobile reading

**Storage:**
Tutorials are stored in a central repo at `../rails-tutor-tutorials/` (sibling to your projects). This is auto-created on first use and shared across all your codebases. The `source_repo` field in each tutorial tracks which codebase the examples came from.

Run `/sync-tutorials` to commit and push your tutorials to GitHub for backup.

## Contributing

Want to add a plugin to this marketplace? Open a PR!

## License

MIT
