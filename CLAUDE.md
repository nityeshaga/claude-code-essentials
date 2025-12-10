# Claude Code Essentials

This is a **Claude Code plugin marketplace**.

## Structure

```
claude-code-essentials/
├── .claude-plugin/
│   └── marketplace.json    # Lists all plugins
├── plugins/
│   └── coding-tutor/
│       ├── .claude-plugin/
│       │   └── plugin.json
│       ├── commands/
│       └── skills/
└── CLAUDE.md
```

## Plugin Structure

- `.claude-plugin/plugin.json` - Required metadata (name, version, description, author)
- `commands/` - Slash commands as markdown files
- `skills/` - Agent skills with SKILL.md files

Directories must be at plugin root level, NOT inside `.claude-plugin/`.

## Version Management

**Before pushing to main, bump versions in BOTH:**

1. `.claude-plugin/marketplace.json` - `version` and `plugins[].version`
2. `plugins/<plugin-name>/.claude-plugin/plugin.json` - `version`

Use semantic versioning:
- **PATCH** (1.1.0 → 1.1.1): Bug fixes, small improvements
- **MINOR** (1.1.x → 1.2.0): New features
- **MAJOR** (1.x.x → 2.0.0): Breaking changes

## Docs

- [Plugins](https://code.claude.com/docs/en/plugins)
- [Marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
- [Skills](https://code.claude.com/docs/en/skills)
- Keep the README.md upto date