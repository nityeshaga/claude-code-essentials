---
name: prompt-engineer
description: Expert prompt engineering for AI systems. Use when the user wants to write or review prompts for AI, create instructions for AI systems, build system prompts, review or improve existing prompts, optimize AI instructions, or create any form of written communication intended for AI consumption (Claude, GPT, or other LLMs).
---

# Prompt Engineer

This skill helps create high-quality prompts and instructions for AI systems by treating AI as a genius human teammate who needs clear, context-rich communication.

## Core Philosophy

This skill is built on two foundational principles:

1. **The Genius Intern Framework**: Treat AI like a brilliant generalist who can figure things out but needs context about what "good" looks like in your specific situation
2. **Async Remote Teammate**: Write for AI the way you'd write for a smart remote colleague—clear, comprehensive, and decisively opinionated

Modern AI models have both high intelligence and high emotional intelligence. They don't need tricks or "prompt engineering hacks"—they need what any smart remote teammate needs: clear written communication with sufficient context.

## Reference Materials

This skill includes three core reference documents. Read them in full as needed:

### Always Load First
**[Writing for AI Teammates](./reference/writing_for_ai_teammates.md)** - Core philosophy covering:
- Why "prompt engineering" is about clear writing, not tricks
- The 37signals parallel (async remote culture)
- Brevity-clarity balance
- Progressive disclosure ("inverted pyramid")

Load this file at the start of every prompt creation task. It's your primary reference.

### Then Load Prompt Framework
**[Prompt Framework](./reference/prompt_framework.md)** - Comprehensive guide covering:
- Three prompt types (Do This / Know How / Learn Domain)
- Universal principles (examples with reasoning, decision frameworks, visual structure)
- Type-specific patterns and structures
- Anti-patterns to avoid

Always load read this detailed framework to understand best practices based on how Anthropic writes their prompts.

### Load Only for GPT-5 Targets
**[GPT-5 Prompting Guide](./reference/gpt5_prompting_guide.md)** - GPT-5-specific patterns:
- Avoiding contradictory instructions (critical for GPT-5)
- Calibrating autonomy vs asking questions
- Tool preambles and progress updates
- Self-reflection for quality
- Planning protocols

Only load this file if the user explicitly mentions they're targeting GPT-5, OpenAI models, or asks for GPT-5 optimization after seeing the initial draft.

## Workflow

### 1. Understand the Request

When the user asks for help with a prompt, quickly assess:

**Type of prompt needed:**
- **Do This** (single task execution)
- **Know How** (reusable capability/tool)
- **Learn Domain** (acquire knowledge then execute)

**Available context:**
- What's the AI being asked to do?
- Who's the audience for the output?
- What does success look like?
- Are there examples of good/bad outputs?
- What constraints exist?

### 2. Gather Missing Info (Intelligently)

Be smart about asking questions. Ask if:

- You genuinely can't determine the prompt type
- Critical context is completely missing (e.g., no idea what the AI should actually do)
- Multiple valid interpretations exist with very different outcomes
- Output format is not clear

**Don't ask if:**
- You have sufficient context to create a solid first draft
- The user has been comprehensive in their initial request
- Questions would be nitpicky rather than substantive

### 3. Create the Prompt

**Load the Prompt Framework reference first**, then:

1. **Choose the right structure** based on prompt type:
   - Do This: Purpose → Success Criteria → Examples → Constraints
   - Know How: Purpose → When to Use → Examples with Reasoning → Mechanics
   - Learn Domain: Foundation → Study → Synthesis → Execution → Validation

2. **Apply universal principles:**
   - Be decisively opinionated
   - Show examples with reasoning (good AND bad)
   - Provide clear decision frameworks
   - Address common mistakes proactively
   - Use visual structure for complex anatomy
   - Scale complexity to judgment required

3. **Avoid anti-patterns:**
   - Don't explain basic concepts AI already knows
   - Don't apologize or hedge
   - Don't be excessively polite
   - Don't list every edge case
   - Don't add motivational statements
   - Don't over-specify process
   - Don't overfit on given examples by including said examples in the prompt

### 4. Create as File

Always create the prompt as a markdown file.

### 5. GPT-5 Optimization (if needed)

After creating the prompt, ask: **"Will this be used with GPT-5 or OpenAI models?"**

If yes, you MUST load the GPT-5 Prompting Guide and perform a revision pass:

[Official GPT-5 prompting guide](./reference/gpt5_prompting_guide.md)

## Remember

You're not doing "prompt engineering"—you're helping someone communicate clearly with an intelligent teammate. Focus on clarity, context, and decisiveness. Trust the AI to be smart; give them what they need to be effective in your specific context.
