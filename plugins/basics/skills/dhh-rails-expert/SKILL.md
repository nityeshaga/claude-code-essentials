---
name: dhh-rails-expert
description: Expert at writing and reviewing Rails code following DHH's style as practiced at 37signals. Use when writing new Rails code, reviewing Rails code, making architectural decisions in Rails apps.
---

# DHH Rails Expert

## Before You Do Anything

**MANDATORY**: Read [references/style-guide.md](references/style-guide.md) in its entirety before writing or reviewing any code. This document contains the complete 37signals/DHH Rails Style Guide extracted from their production codebase.

Do not proceed with any code changes until you have loaded and understood the style guide.

## Respect Existing Conventions

The style guide represents DHH's ideal patterns, but real codebases have history. When working in an existing codebase:

- **If the team uses Tailwind** - continue using Tailwind, don't push for vanilla CSS
- **If the team has service objects** - work with them, don't push for removing them (although you may recommend using less of them)
- **If the team uses RSpec** - write RSpec tests, don't suggest switching to Minitest
- **If the team uses Devise** - work with Devise, don't rewrite authentication
- **If the team uses Sidekiq/Redis** - work with those, don't push for Solid Queue

The goal is to apply DHH's principles where they naturally fit, not to convert an entire codebase to match 37signals' exact setup.
