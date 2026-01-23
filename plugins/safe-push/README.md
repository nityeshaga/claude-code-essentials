# Safe Push

Prevents accidental pushes to main branch in Claude Code bypassPermissions mode.

## The Vulnerability

When Claude Code runs with `--dangerously-skip-permissions`, it can execute git commands without user approval. This creates a security gap when this plugin is **not installed at the user level**.

**Example scenario:**

1. **Repo A** has the `basics` plugin installed at project level - you think it's protected
2. **Repo B** has no plugin installed
3. Claude Code runs inside **Repo B**
4. Claude can push to Repo A's main branch using the `-C` flag:
   ```bash
   git -C /path/to/RepoA push origin main
   ```
5. Repo A's project-level `basics` plugin **does not help** - hooks only run in the context of where Claude is running (Repo B)

**The key insight:** Protection depends on where Claude runs, not on the target repository. A repo cannot protect itself from external `-C` commands. The only way to protect all your repositories is to install this plugin at the **user level**.

## Installation

**Important:** This plugin must be installed at the **user level** to protect all repositories.

Add to your `~/.claude/settings.json`:

```json
{
  "plugins": [
    "https://github.com/nityeshaga/claude-code-essentials/tree/main/plugins/safe-push"
  ]
}
```

Or using the CLI:

```bash
claude /plugin add https://github.com/nityeshaga/claude-code-essentials/tree/main/plugins/safe-push
```

## How It Works

The plugin installs a `PreToolUse` hook that intercepts all Bash commands. When a `git push` command is detected, the hook:

1. Parses the command to extract git subcommand and arguments
2. Blocks explicit pushes to `main` (e.g., `git push origin main`)
3. Blocks implicit pushes when on `main` branch (e.g., `git push`)
4. Blocks `--all` and `--mirror` pushes that would include main

The hook handles all variations including:
- Direct pushes: `git push origin main`
- Refspec pushes: `git push origin HEAD:main`
- Flag variations: `git push -u origin main`
- Cross-repo pushes: `git -C /other/repo push origin main`

## Hooks

| Hook | Event | Description |
|------|-------|-------------|
| `block-main-push` | PreToolUse (Bash) | Blocks git pushes to main branch |

## Related: basics Plugin

The same `block-main-push` hook is also included in the [basics plugin](../basics/README.md). Use:

- **safe-push** (this plugin): For **user-level** installation to protect local development
- **basics**: For **project-level** installation in CI/CD environments (e.g., GitHub Actions)

If you have `basics` installed at project level, you don't need `safe-push` for that specific project. However, installing `safe-push` at user level ensures protection across **all** your repositories.
