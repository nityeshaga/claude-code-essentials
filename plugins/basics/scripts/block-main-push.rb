#!/usr/bin/env ruby

require 'json'

begin
  input_data = JSON.parse(STDIN.read)
rescue JSON::ParserError => e
  STDERR.puts "Error: Invalid JSON input: #{e.message}"
  exit 1
end

tool_name = input_data['tool_name']
exit 0 unless tool_name == 'Bash'

tool_input = input_data['tool_input'] || {}
command = tool_input['command'] || ''

exit 0 if command.empty?

# Extract just the git command part, ignoring commit messages in heredocs
# This prevents false positives when commit messages contain "main"
command_parts = command.strip.split(/\n/)[0] || command
normalized_command = command_parts.strip.downcase

# Only check for git push commands targeting the main branch
# More precise patterns to avoid false positives with branch names containing "main"
dangerous_patterns = [
  /^git\s+push\s+\S+\s+main$/,                    # git push origin main
  /^git\s+push\s+\S+\s+\S+:main$/,                # git push origin feature:main
  /^git\s+push\s+\S+\s+main\s+/,                  # git push origin main --force
  /^git\s+push\s+.*\s+main:main/,                 # git push origin main:main
  /^git\s+push\s+.*\bHEAD:main\b/,                # git push origin HEAD:main
  /^git\s+push\s+(-u|--set-upstream)\s+\S+\s+main/, # git push -u origin main
  /^git\s+push\s+(-f|--force)\s+\S+\s+main/,      # git push -f origin main
  /^git\s+push\s+\S+\s+(-f|--force)\s+main/,      # git push origin -f main
  /^git\s+push\s+.*--all/                        # git push --all (pushes all branches)
]

dangerous_command = dangerous_patterns.any? { |pattern| normalized_command.match?(pattern) }

if dangerous_command
  STDERR.puts <<~ERROR
    This is blocked to prevent accidental commits to the main branch.
    Please push to a feature branch instead.
  ERROR

  # Exit code 2 blocks the tool call and shows stderr to Claude
  exit 2
end

if normalized_command.match?(/^git\s+push\s*$/) || normalized_command.match?(/^git\s+push\s+origin\s*$/)
  project_dir = ENV['CLAUDE_PROJECT_DIR'] || input_data['cwd'] || Dir.pwd
  current_branch = `cd "#{project_dir}" && git branch --show-current 2>/dev/null`.strip rescue ''

  if current_branch.downcase == 'main' || current_branch.empty?
    branch_status = current_branch.empty? ? "unknown/undetectable" : current_branch

    STDERR.puts <<~ERROR
      This is blocked to prevent accidental commits to the main branch.
      Please push to a feature branch instead.
    ERROR

    exit 2
  end
end

exit 0
