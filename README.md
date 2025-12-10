# Claude Code Essentials

A marketplace of essential Claude Code plugins for developers.

## Why

AI is already smarter than any single human being across the breadth of tasks it can perform. It beats PhDs, aces entrance exams in every field, and this gap will only widen.

In this world, humans have two paths: let their cognitive capabilities decline, or rise to match AI. The long-term future of humanity depends heavily on which path we take.

My belief is simple: today's AI is smarter than any private tutor anyone on the planet can hire. So why not use it to give every human access to the best personal tutor imaginable? One that knows your background, adapts to your pace, uses your actual work as teaching material, and helps you retain what you learn.

This project starts with programming - the domain where AI has the most immediate economic impact. Use it to learn about the programs you're vibe coding and level up your skills. Don't just vibe code, vibe learn.

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

## Contributing

Want to add a plugin to this marketplace? Open a PR!

## License

MIT
