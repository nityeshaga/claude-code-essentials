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

Version bumping is not functionally required for updates (Claude Code fetches latest content regardless), but is recommended as a best practice for tracking releases.

### When changing a plugin

Bump **2 places** and keep them in sync:

1. `plugins/<plugin-name>/.claude-plugin/plugin.json` → `version`
2. `.claude-plugin/marketplace.json` → matching `plugins[].version`

### When making marketplace-level changes

Optionally bump **1 additional place**:

3. `.claude-plugin/marketplace.json` → root `version`

Only bump the marketplace root version for significant marketplace changes (adding new plugins, restructuring, etc.), not for every plugin update.

### Semantic versioning

- **PATCH** (1.1.0 → 1.1.1): Bug fixes, small improvements
- **MINOR** (1.1.x → 1.2.0): New features
- **MAJOR** (1.x.x → 2.0.0): Breaking changes

## Docs

- [Plugins](https://code.claude.com/docs/en/plugins)
- [Marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
- [Skills](https://code.claude.com/docs/en/skills)
- Keep the README.md upto date