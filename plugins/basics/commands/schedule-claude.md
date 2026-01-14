Help the user set up a scheduled Claude Code job on macOS for: **$ARGUMENTS**

## Critical Knowledge: Why Cron Doesn't Work

**Do NOT use cron for Claude Code.** Claude uses OAuth credentials stored in the macOS Keychain. Cron runs in a minimal environment without Keychain access, causing `Invalid API key · Please run /login` errors.

**Use launchd instead** - Apple's native scheduler that runs in the user session with full Keychain access.

## Implementation Pattern

### 1. Create a wrapper script

Location: `~/.claude/scripts/<job-name>.sh`

```bash
#!/bin/bash
LOG="/Users/<username>/.<job-name>.log"

echo "=== Started at $(date) ===" >> "$LOG"
cd /path/to/working/directory

/Users/<username>/.local/bin/claude -p "<prompt>" --allowedTools "<tools>" >> "$LOG" 2>&1

echo "=== Finished at $(date) ===" >> "$LOG"
```

Key points:
- Script writes to its own log file (launchd stdout capture is unreliable)
- Use full path to claude binary
- Redirect both stdout and stderr to log

### 2. Create launchd plist

Location: `~/Library/LaunchAgents/com.<username>.<job-name>.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.<username>.<job-name></string>

    <key>ProgramArguments</key>
    <array>
        <string>/path/to/wrapper-script.sh</string>
    </array>

    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>18</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>

    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>
```

For weekday-only schedules, use an array of dicts with `Weekday` key (1=Monday, 5=Friday).

### 3. Load and test

```bash
# Make script executable
chmod +x ~/.claude/scripts/<job-name>.sh

# Load the agent
launchctl load ~/Library/LaunchAgents/com.<username>.<job-name>.plist

# Test manually (don't wait for schedule)
launchctl start com.<username>.<job-name>

# Check logs
cat ~/.<job-name>.log

# Verify it's scheduled
launchctl list | grep <job-name>
```

### 4. Useful commands

```bash
# Unload (stop scheduling)
launchctl unload ~/Library/LaunchAgents/com.<username>.<job-name>.plist

# Check job status
launchctl list com.<username>.<job-name>

# Remove completely
launchctl unload ~/Library/LaunchAgents/com.<username>.<job-name>.plist
rm ~/Library/LaunchAgents/com.<username>.<job-name>.plist
```

## Schedule Examples

| Schedule | StartCalendarInterval |
|----------|----------------------|
| Daily 6 PM | `<key>Hour</key><integer>18</integer>` |
| Weekdays 9 AM | Array with Weekday 1-5, Hour 9 |
| Every hour | `<key>Minute</key><integer>0</integer>` |
| Monthly 1st | `<key>Day</key><integer>1</integer>` |

## Now help the user

1. Ask what they want Claude to do on a schedule
2. Ask what schedule they need (time, frequency)
3. Create the wrapper script and plist
4. Test it with `launchctl start`
