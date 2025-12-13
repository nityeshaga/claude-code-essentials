# Tool Evaluation Guide

## Overview

This guide provides a comprehensive methodology for creating evaluations that test whether AI agents can effectively use your tools to accomplish realistic, complex tasks.

The quality of a tool system is measured by how well it enables AI agents to answer realistic questions using only the tools provided - not by feature completeness or API coverage.

---

## Quick Reference

### Evaluation Requirements
- Create 10+ human-readable questions
- Questions must be READ-ONLY, INDEPENDENT, NON-DESTRUCTIVE
- Each question requires multiple tool calls (potentially dozens)
- Answers must be single, verifiable values
- Answers must be STABLE (won't change over time)

### Output Format
```xml
<evaluation>
   <qa_pair>
      <question>Your question here</question>
      <answer>Single verifiable answer</answer>
   </qa_pair>
</evaluation>
```

---

## Purpose of Evaluations

Evaluations test whether LLMs can effectively use your tools to accomplish real-world tasks. They reveal:
- Which tools are confusing or poorly documented
- Where context limits cause failures
- Which workflows require too many steps
- Which error messages aren't actionable
- What information is missing from tool outputs

---

## Question Creation Guidelines

### Core Requirements

**1. Questions MUST be independent**
- Each question should NOT depend on the answer to any other question
- Should not assume prior write operations from processing another question
- Can be answered in any order

**2. Questions MUST require ONLY NON-DESTRUCTIVE AND IDEMPOTENT tool use**
- Should not instruct or require modifying state to arrive at the correct answer
- Use read-only operations: search, list, get, etc.
- Avoid: create, update, delete, send operations

**3. Questions must be REALISTIC, CLEAR, CONCISE, and COMPLEX**
- Must require multiple (potentially dozens of) tools or steps to answer
- Should represent real tasks users would want to accomplish
- Should be unambiguous despite complexity

### Complexity and Depth

**4. Questions must require deep exploration**
Consider multi-hop questions requiring:
- Multiple sub-questions
- Sequential tool calls where each step depends on previous results
- Synthesizing information from multiple sources
- Understanding relationships between different entities

**Example multi-hop question:**
```
"Find the repository that was archived in Q3 2023 and had previously been
the most forked project in the organization. What was the primary programming
language used in that repository?"

Steps required:
1. List repositories with archived status
2. Filter by Q3 2023 archive date
3. For each, get fork count
4. Identify most forked
5. Get language information
```

**5. Questions may require extensive pagination**
- May need paging through multiple pages of results
- May require querying old data (1-2 years out-of-date) to find niche information
- Should test how tools handle large result sets
- The questions must be DIFFICULT

**6. Questions must require deep understanding**
Rather than surface-level knowledge:
- Pose complex ideas as True/False questions requiring evidence
- Use multiple-choice format where agent must evaluate different hypotheses
- Require analysis and synthesis, not just retrieval

**Example deep understanding question:**
```
"Among all bugs reported in January 2024 that were marked as critical
priority, which assignee resolved the highest percentage of their assigned
bugs within 48 hours? Provide the assignee's username."

Requires:
- Understanding bug statuses and priority levels
- Calculating time differences from timestamps
- Aggregating by assignee
- Computing percentages
- Identifying maximum
```

**7. Questions must not be solvable with straightforward keyword search**
- Do not include specific keywords from the target content
- Use synonyms, related concepts, or paraphrases
- Require multiple searches, analyzing multiple related items, extracting context, then deriving the answer

**Example requiring synthesis:**
```
❌ Bad: "Find the pull request titled 'Add authentication feature'"
✅ Good: "Locate the initiative focused on improving customer onboarding that
was completed in late 2023. What was the project lead's role title?"
```

### Tool Testing

**8. Questions should stress-test tool return values**
- May elicit tools returning large JSON objects or lists
- Should require understanding multiple modalities of data:
  - IDs and names
  - Timestamps and datetimes (months, days, years, seconds)
  - File IDs, names, extensions, and mimetypes
  - URLs, identifiers, etc.
- Should probe the tool's ability to return all useful forms of data

**9. Questions should MOSTLY reflect real human use cases**
- The kinds of information retrieval tasks that HUMANS assisted by an AI would care about
- Practical scenarios from actual usage patterns
- Not contrived or artificial queries

**10. Questions may require dozens of tool calls**
- This challenges AI agents with limited context
- Encourages tool designers to return concise, high-signal information
- Tests whether pagination and filtering work effectively

**11. Include ambiguous questions**
- May be ambiguous OR require difficult decisions on which tools to call
- Force the agent to potentially make mistakes or misinterpret
- Ensure that despite AMBIGUITY, there is STILL A SINGLE VERIFIABLE ANSWER

### Stability

**12. Questions must be designed so the answer DOES NOT CHANGE**
Do not ask questions that rely on "current state" which is dynamic.

**Examples of unstable questions (avoid):**
- "How many open issues are currently assigned to the engineering team?"
- "How many members are in the #general channel?"
- "What's the most recent post in the forum?"
- "How many reactions does the announcement have?"

**Examples of stable questions (use):**
- "How many issues were opened in January 2024?"
- "Who created the project 'Website Redesign' that launched in Q2 2023?"
- "What was the final task count when Project Alpha was completed in Dec 2023?"

**13. DO NOT let tool limitations RESTRICT the questions you create**
- Create challenging and complex questions
- Some may not be perfectly solvable with the available tools (that's valuable feedback!)
- Questions may require specific output formats (datetime vs. epoch time, JSON vs. Markdown)
- Questions may require dozens of tool calls to complete
- If agents struggle, that reveals tool design improvements needed

---

## Answer Guidelines

### Verification

**1. Answers must be VERIFIABLE via direct string comparison**

If the answer can be re-written in many formats, clearly specify the output format in the QUESTION.

**Examples:**
- "Use YYYY-MM-DD format."
- "Respond with True or False only."
- "Answer A, B, C, or D and nothing else."
- "Provide the username only, no additional text."

**Answer should be a single VERIFIABLE value:**
- User ID, user name, display name, first name, last name
- Channel ID, channel name
- Message ID, message string
- URL, title
- Numerical quantity
- Timestamp, datetime
- Boolean (for True/False questions)
- Email address, phone number
- File ID, file name, file extension
- Multiple choice answer (A/B/C/D)

**Answers must not require:**
- Special formatting
- Complex, structured output
- Lists that could be in different orders
- Natural language explanations

### Readability

**2. Answers should generally prefer HUMAN-READABLE formats**

Examples of human-readable:
- Names over IDs: "John Doe" vs "usr_xyz789"
- Dates over timestamps: "2024-03-15" vs "1710460800"
- File names over file IDs: "report.pdf" vs "file_abc123"
- Yes/No over true/false
- Email addresses, URLs

The VAST MAJORITY of answers should be human-readable, not opaque identifiers.

**When IDs are acceptable:**
- When no human-readable alternative exists
- When the ID itself is the meaningful identifier in the system
- When explicitly asking for an ID in the question

### Stability

**3. Answers must be STABLE/STATIONARY**

Look at old content:
- Conversations that have ended
- Projects that have launched/completed
- Questions that were answered
- Historical data from specific time periods

Create QUESTIONS based on "closed" concepts that will always return the same answer.

**Techniques for stability:**
- Ask about completed projects/events
- Query historical time windows ("in Q1 2024")
- Focus on immutable data (creation dates, authors, titles)
- Avoid metrics that change (reaction counts, member counts, open issues)

**4. Answers must be CLEAR and UNAMBIGUOUS**
- Questions must be designed so there is a single, clear answer
- Answer can be derived from using the tools
- No interpretation or subjective judgment required

### Diversity

**5. Answers must be DIVERSE**

Answer should span diverse modalities and formats across your evaluation set:

**User concept:**
- User ID: "usr_xyz789"
- Username: "john_doe"
- Full name: "John Doe"
- First name: "John"
- Email: "john@example.com"

**Project/Resource concept:**
- ID: "proj_abc123"
- Name: "Website Redesign"
- Status: "completed"
- Count: 42

**Time concept:**
- Date: "2024-03-15"
- Month: "March"
- Day number: 15
- Year: 2024
- Timestamp: "2024-03-15T10:30:00Z"

**6. Answers must NOT be complex structures**

Avoid:
- Lists of values (unless order guaranteed and easily reproduced)
- Complex objects
- Lists of IDs or strings
- Natural language text paragraphs
- JSON structures

UNLESS the answer can be straightforwardly verified using DIRECT STRING COMPARISON and can be realistically reproduced identically.

---

## Evaluation Creation Process

### Step 1: Understand Available Tools

First, understand what tools are available and how they work:

**Actions:**
1. List all available tools
2. Read tool descriptions, input schemas, output formats
3. Understand tool capabilities and limitations
4. Identify which tools work together for workflows
5. Note any gaps in functionality

**Do NOT yet call the tools** - just understand what's available.

### Step 2: Study the Domain

Understand the domain and data your tools operate on:

**Actions:**
1. Read any API documentation
2. Understand data models and relationships
3. Research typical use cases
4. Identify realistic scenarios users would encounter
5. Fetch additional information from the web if needed

**Parallelize this step** with multiple focused research tasks.

### Step 3: Explore Available Data (Read-Only)

Now use the tools to explore what data is available:

**Actions:**
1. Use READ-ONLY, NON-DESTRUCTIVE operations ONLY
2. Make INCREMENTAL, SMALL, TARGETED tool calls
3. Use limit parameters to restrict results (typically <10 for exploration)
4. Use pagination to avoid context overflow
5. Identify specific content (users, projects, messages, etc.) for questions

**Important warnings:**
- BE CAREFUL: Some tools may return LOTS OF DATA
- NEVER call tools that modify state
- Start with small limits and expand cautiously
- Parallelize exploration with multiple focused sub-tasks

**Example exploration:**
```
1. List projects with limit=5 to see structure
2. Get details on one completed project
3. List users with limit=5
4. Search for specific historical events (Q1 2024, Q2 2023, etc.)
5. Examine different resource types (issues, PRs, messages, etc.)
```

### Step 4: Generate Questions

Based on your exploration, create 10+ questions that:

**Meet all requirements:**
- Read-only, independent, non-destructive
- Complex (multiple tool calls required)
- Realistic (humans would want to know this)
- Specific (single verifiable answer)
- Stable (answer won't change)

**Cover diverse patterns:**
- Multi-hop reasoning questions
- Aggregation/counting questions
- Comparison/superlative questions (most, least, highest, etc.)
- Time-based filtering questions
- Cross-entity relationship questions

**Example question types:**

**Multi-hop:**
```xml
<qa_pair>
  <question>Find the user who created the most issues in the repository with
  the highest star count. What is their email address?</question>
  <answer>alice@example.com</answer>
</qa_pair>
```

**Aggregation:**
```xml
<qa_pair>
  <question>Among all pull requests merged in Q1 2024, how many unique
  contributors worked on changes to files in the /api directory?</question>
  <answer>7</answer>
</qa_pair>
```

**Superlative:**
```xml
<qa_pair>
  <question>Which project completed in 2023 had the longest duration from
  start to finish? Provide the project name.</question>
  <answer>Mobile App Redesign</answer>
</qa_pair>
```

**Time-based:**
```xml
<qa_pair>
  <question>On what date was the first issue labeled "bug" created in the
  backend-api repository? Format: YYYY-MM-DD</question>
  <answer>2023-06-15</answer>
</qa_pair>
```

### Step 5: Verify Answers

After creating questions, solve them yourself using the tools:

**Process:**
1. For each question, use the tools to find the answer
2. Document the tool calls required
3. Verify the answer is correct
4. Check that no write/destructive operations needed
5. Confirm answer format matches question requirements
6. Update the answer in the XML if your initial guess was wrong

**Parallelize:** Solve questions in parallel to avoid context overflow, then collect all answers.

**Remove questions that:**
- Require write/destructive operations
- Cannot be answered with available tools
- Have ambiguous or changing answers
- Are too easy (single tool call)

---

## Example Evaluations

### Good Questions

**Example 1: Multi-hop with Deep Exploration**
```xml
<qa_pair>
  <question>Find discussions about AI model launches with animal codenames.
  One model needed a specific safety designation that uses the format ASL-X.
  What number X was being determined for the model named after a spotted
  wild cat?</question>
  <answer>3</answer>
</qa_pair>
```

**Why it's good:**
- Requires searching discussions about AI models
- Must identify animal codenames (leopard, cheetah, etc.)
- Find safety designation discussions
- Understand ASL-X format
- Connect model name to ASL level
- Answer is specific number
- Based on historical discussion that won't change

**Example 2: Aggregation with Time Filtering**
```xml
<qa_pair>
  <question>Between January 1 and March 31, 2024, how many different users
  contributed code to pull requests that modified files in the /src/api
  directory?</question>
  <answer>12</answer>
</qa_pair>
```

**Why it's good:**
- Requires listing PRs in time window
- Must filter by merged status
- Check file paths for /src/api
- Count unique contributors
- Specific time period (stable)
- Clear numerical answer

**Example 3: Superlative with Context**
```xml
<qa_pair>
  <question>Among projects that were marked as completed in Q4 2023, which
  one had the highest number of tasks marked as "blocked" at some point during
  its lifecycle? Provide the project name.</question>
  <answer>Infrastructure Migration</answer>
</qa_pair>
```

**Why it's good:**
- Requires finding completed projects in Q4 2023
- Must examine task history (not just final state)
- Count blocked tasks across project lifecycle
- Identify maximum
- Historical data (won't change)
- Clear project name answer

### Poor Questions

**Example 1: Unstable Answer**
```xml
<qa_pair>
  <question>How many open pull requests are there currently?</question>
  <answer>23</answer>
</qa_pair>
```

**Why it's poor:**
- Answer changes as PRs are opened/closed
- Relies on current dynamic state
- Not based on historical data

**Example 2: Too Simple**
```xml
<qa_pair>
  <question>What is the title of issue #42?</question>
  <answer>Fix login bug</answer>
</qa_pair>
```

**Why it's poor:**
- Single tool call (get_issue)
- No complexity or reasoning required
- Doesn't test agent capabilities

**Example 3: Ambiguous Answer Format**
```xml
<qa_pair>
  <question>List all repositories that use Python.</question>
  <answer>backend-api, ml-pipeline, data-processor, web-scraper</answer>
</qa_pair>
```

**Why it's poor:**
- Answer is a list that could be in any order
- Agent might format differently (JSON array, newlines, etc.)
- Can't verify with direct string comparison
- Better: Ask for count or superlative (most stars, most recent, etc.)

---

## Testing and Iteration

### Running Evaluations

After creating evaluations, test them with actual AI agents:

**Metrics to track:**
- Success rate (% of questions answered correctly)
- Average tool calls per question
- Average time per question
- Which questions fail most often
- Which tools are used most/least
- Where agents run out of context

### Interpreting Results

**Low success rate (<70%):**
- Tool descriptions may be unclear
- Missing key functionality
- Outputs don't include needed information
- Error messages aren't actionable
- Questions may be too difficult (good to know!)

**High tool call count:**
- Tools too granular (need composite operations)
- Missing direct paths to information
- Poor tool organization/discoverability

**Context overflow failures:**
- Tool outputs too verbose
- Need better pagination
- Missing concise response formats
- Character limits not implemented

### Iterating on Tool Design

Use evaluation results to improve tools:

**Failed questions reveal:**
1. **Missing tools** - Add new tools for common workflows
2. **Unclear descriptions** - Improve documentation with examples
3. **Missing output fields** - Include needed information in responses
4. **Verbose outputs** - Implement concise formats, better truncation
5. **Poor error messages** - Make errors more actionable

**Process:**
1. Identify failure patterns
2. Update tool designs
3. Re-run evaluations
4. Measure improvement
5. Repeat

---

## Summary Checklist

When creating evaluations:

- [ ] Created 10+ complex, realistic questions
- [ ] All questions are read-only and independent
- [ ] Each question requires multiple tool calls
- [ ] Answers are single, verifiable values
- [ ] Answers use human-readable formats
- [ ] Questions based on stable/historical data
- [ ] Diverse question types (multi-hop, aggregation, superlative, etc.)
- [ ] Diverse answer formats (names, dates, numbers, IDs, etc.)
- [ ] Verified answers by solving questions yourself
- [ ] Questions reflect real user needs
- [ ] XML file properly formatted
- [ ] No write/destructive operations required
- [ ] Tested with actual AI agents
- [ ] Used results to iterate on tool design
