#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'shellwords'

# Git global options that take an argument
GIT_OPTS_WITH_ARG = %w[-C -c --git-dir --work-tree --namespace --super-prefix --exec-path --config-env].freeze
# Git global flags (no argument)
GIT_FLAGS = %w[-v --version -h --help -p --paginate -P --no-pager --bare --no-replace-objects
               --literal-pathspecs --glob-pathspecs --noglob-pathspecs --icase-pathspecs
               --no-optional-locks].freeze

def extract_git_subcommand_and_args(command)
  # Handle compound commands - find the git push part
  return [ nil, nil ] unless command.match?(/\bgit\b/)

  # Extract the git command portion
  tokens = begin
    Shellwords.split(command)
  rescue StandardError
    command.split
  end

  git_index = tokens.index('git')
  return [ nil, nil ] unless git_index

  tokens = tokens[git_index..]
  i = 1 # Skip 'git'

  # Skip global options
  while i < tokens.size
    token = tokens[i]

    if GIT_OPTS_WITH_ARG.include?(token)
      i += 2 # Skip option and its argument
    elsif GIT_OPTS_WITH_ARG.any? { |opt| token.start_with?("#{opt}=") || (token.start_with?(opt) && opt.length == 2) }
      i += 1 # Option with attached value like -C/path or --git-dir=.git
    elsif GIT_FLAGS.include?(token) || token.start_with?('-')
      i += 1 # Skip flag
    else
      # Found the subcommand
      return [ token, tokens[(i + 1)..] ]
    end
  end

  [ nil, nil ]
end

def targets_main_branch?(push_args)
  return false if push_args.nil? || push_args.empty?

  push_args.each do |arg|
    next if arg.start_with?('-') # Skip flags

    # Check refspecs: main, :main, HEAD:main, +main, refs/heads/main, feature:main
    return true if arg.match?(%r{(?:^|:|\+)(?:refs/heads/)?(main|master)(?:$|:)})
  end

  # Check for --all or --mirror
  return true if push_args.include?('--all') || push_args.include?('--mirror')

  false
end

def implicit_push?(push_args)
  return true if push_args.nil? || push_args.empty?

  # Filter out flags
  non_flag_args = push_args.reject { |a| a.start_with?('-') }

  # If only 0 or 1 non-flag args, could be implicit
  # "git push" -> 0 args
  # "git push origin" -> 1 arg (just remote)
  non_flag_args.size <= 1
end

def current_branch_is_main?(project_dir)
  branch = `cd "#{project_dir}" && git rev-parse --abbrev-ref HEAD 2>/dev/null`.strip
  %w[main master].include?(branch.downcase)
rescue StandardError
  false
end

# Main
begin
  input_data = JSON.parse($stdin.read)
rescue JSON::ParserError => e
  warn "Error: Invalid JSON: #{e.message}"
  exit 1
end

exit 0 unless input_data['tool_name'] == 'Bash'

command = input_data.dig('tool_input', 'command') || ''
exit 0 if command.empty?

subcommand, push_args = extract_git_subcommand_and_args(command)
exit 0 unless subcommand == 'push'

# Check for explicit main references
if targets_main_branch?(push_args)
  warn 'BLOCKED: This push targets main/master branch. Push to a feature branch instead.'
  exit 2
end

# Check for implicit push while on main
if implicit_push?(push_args)
  project_dir = ENV['CLAUDE_PROJECT_DIR'] || input_data['cwd'] || Dir.pwd
  if current_branch_is_main?(project_dir)
    warn 'BLOCKED: Implicit push while on main/master branch. Checkout a feature branch first.'
    exit 2
  end
end

exit 0
