# Tool Design Patterns and Anti-Patterns

This document provides comprehensive patterns and anti-patterns for designing effective tools for AI agents.

---

## Table of Contents

1. [Tool Organization Patterns](#tool-organization-patterns)
2. [Input Schema Patterns](#input-schema-patterns)
3. [Output Design Patterns](#output-design-patterns)
4. [Error Handling Patterns](#error-handling-patterns)
5. [Common Anti-Patterns](#common-anti-patterns)
6. [Advanced Patterns](#advanced-patterns)

---

## Tool Organization Patterns

### Pattern: Service-Prefixed Naming

**Problem:** Multiple tool systems may expose similarly named tools, causing conflicts.

**Solution:** Prefix all tool names with the service/system name.

**Examples:**
```
✅ Good:
- slack_send_message
- slack_list_channels
- slack_search_messages

❌ Bad:
- send_message  (conflicts with email, SMS, etc.)
- list_channels
- search
```

**Implementation:**
- Format: `{service}_{action}_{resource}`
- Use snake_case consistently
- Keep service prefix short but recognizable

---

### Pattern: Verb-First Action Naming

**Problem:** Unclear what operation the tool performs.

**Solution:** Start tool names with action verbs that clearly indicate the operation.

**Common verbs:**
- `get` - Retrieve a single item by ID
- `list` - Retrieve multiple items with optional filtering
- `search` - Query-based retrieval with text search
- `create` - Make a new resource
- `update` - Modify existing resource
- `delete` - Remove a resource
- `send` - Transmit data/messages
- `upload` - Transfer files/data
- `download` - Retrieve files/data

**Examples:**
```
✅ Good:
- github_get_issue
- github_list_repositories
- github_search_code
- github_create_pull_request
- github_update_issue
- github_delete_branch

❌ Bad:
- github_issue (unclear action)
- github_repositories (unclear action)
- github_code_finder (awkward phrasing)
```

---

### Pattern: Grouped Tool Families

**Problem:** Tools become hard to discover when there are many of them.

**Solution:** Group related tools with consistent naming patterns.

**Example structure:**
```
Calendar Tools:
- calendar_list_events
- calendar_get_event
- calendar_create_event
- calendar_update_event
- calendar_delete_event
- calendar_search_events
- calendar_check_availability

User Tools:
- user_list_users
- user_get_user
- user_create_user
- user_update_user
- user_delete_user
- user_search_users
```

**Benefits:**
- Agents can infer related tools exist
- Consistent patterns aid tool selection
- Clear organization improves discoverability

---

## Input Schema Patterns

### Pattern: Required vs Optional with Defaults

**Problem:** Too many required parameters make tools hard to use; too few make behavior unpredictable.

**Solution:** Make commonly-used parameters required; provide sensible defaults for configuration.

**Example (user search tool):**
```ruby
# Good balance
def search_users(query:, limit: 20, offset: 0, status: "all", response_format: "markdown")
  # query: Required - core to search
  # limit: Optional with default (20)
  # offset: Optional with default (0)
  # status: Optional with default ("all"), accepts "active", "inactive", "all"
  # response_format: Optional with default ("markdown"), accepts "json" or "markdown"
end

# Too restrictive - requires too many parameters
def search_users(query:, limit:, offset:, status:, response_format:)
  # Shouldn't require agent to always specify all parameters
end

# Too loose - missing important required parameters
def search_users(query: nil, limit: nil, offset: nil)
  # Search without query doesn't make sense
  # No default limit could return thousands of results
end
```

---

### Pattern: Constraint-Rich Schemas

**Problem:** Agents provide invalid inputs that fail at runtime.

**Solution:** Define schemas with comprehensive constraints that catch errors early.

**Example (create event tool using JSON Schema):**
```json
{
  "title": {
    "type": "string",
    "minLength": 1,
    "maxLength": 200,
    "description": "Event title (1-200 characters)"
  },
  "date": {
    "type": "string",
    "pattern": "^\\d{4}-\\d{2}-\\d{2}$",
    "description": "Event date in YYYY-MM-DD format. Example: 2024-03-15"
  },
  "duration_minutes": {
    "type": "number",
    "minimum": 15,
    "maximum": 480,
    "description": "Duration in minutes (15-480, i.e., 15 min to 8 hours)"
  },
  "attendees": {
    "type": "array",
    "items": { "type": "string", "format": "email" },
    "minItems": 1,
    "maxItems": 50,
    "description": "List of attendee email addresses (1-50)"
  }
}
```

**Benefits:**
- Errors caught at validation time with clear messages
- Agents learn proper formats through validation feedback
- Prevents runtime failures and improves reliability

---

### Pattern: Example-Rich Descriptions

**Problem:** Agents don't understand expected parameter format or usage.

**Solution:** Include concrete examples in every parameter description.

**Example (JSON Schema):**
```json
{
  "date_range": {
    "type": "string",
    "description": "Filter by date range. Formats supported:\n- Relative: \"last 7 days\", \"last month\", \"last quarter\"\n- Absolute: \"2024-01-01 to 2024-01-31\"\n- Since/before: \"since 2024-01-01\", \"before 2024-03-01\"\n\nExamples:\n- \"last 30 days\" - Events from past 30 days\n- \"2024-01 to 2024-03\" - Q1 2024\n- \"since 2024-01-01\" - All events from Jan 1 onwards"
  }
}
```

---

## Output Design Patterns

### Pattern: Dual Format Support

**Problem:** Different use cases need different output formats.

**Solution:** Support both JSON (structured) and Markdown (human-readable) formats.

**Implementation:**
```ruby
def search_users(query:, response_format: "markdown")
  users = perform_search(query)

  if response_format == "json"
    {
      users: users.map do |user|
        {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          active: user.active
        }
      end,
      total: users.count,
      count: users.count
    }
  else  # markdown
    result = "## Search Results (#{users.count} users)\n\n"
    users.each do |user|
      status = user.active? ? "✓ Active" : "✗ Inactive"
      result += "- **#{user.name}** (#{user.email})\n"
      result += "  - Role: #{user.role}\n"
      result += "  - Status: #{status}\n\n"
    end
    result
  end
end
```

**When to use each:**
- JSON: Agent needs to process data further, needs precise IDs
- Markdown: Presenting results to user, final output

---

### Pattern: Pagination with Clear Metadata

**Problem:** Large result sets overwhelm context and aren't actionable.

**Solution:** Always paginate, include clear metadata, guide next steps.

**Example response:**
```json
{
  "items": [...],
  "pagination": {
    "total": 347,
    "count": 20,
    "offset": 0,
    "limit": 20,
    "has_more": true,
    "next_offset": 20
  },
  "message": "Showing results 1-20 of 347. Use offset=20 to see the next page, or add filters to narrow results."
}
```

**In Markdown:**
```markdown
## Results (20 of 347)

[... items ...]

---
*Showing 1-20 of 347 results. Use `offset=20` to see next page.*
*Tip: Add filters like `status='active'` or `role='developer'` to narrow results.*
```

---

### Pattern: Progressive Detail Levels

**Problem:** Returning all fields wastes context; returning too few requires multiple calls.

**Solution:** Offer detail levels that balance context usage with completeness.

**Example:**
```ruby
def get_user(user_id:, detail: "basic")
  user = fetch_user(user_id)

  case detail
  when "minimal"
    {
      id: user.id,
      name: user.name,
      email: user.email
    }
  when "basic"
    {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      active: user.active,
      last_login: user.last_login
    }
  when "full"
    # All fields including metadata, timestamps, preferences, etc.
    user.as_json
  end
end
```

**Guidelines:**
- Default to "basic" - most commonly needed fields
- "minimal" for bulk operations
- "full" only when explicitly requested

---

## Error Handling Patterns

### Pattern: Actionable Error Messages

**Problem:** Generic errors don't help agents recover or learn.

**Solution:** Provide specific guidance on how to fix the problem.

**Examples:**

**Bad:**
```
"Error: Invalid input"
"Error 400"
"Request failed"
```

**Good:**
```
"The 'limit' parameter must be between 1 and 100. You provided 500. Try using limit=50 with pagination (offset parameter) to retrieve more results."

"User not found with ID 'usr_123'. Use search_users(query='name') to find the user first, then try again with the correct ID."

"Rate limit exceeded. You can make 100 requests per hour. You've used 100. Your quota resets in 23 minutes. Consider using filters to reduce the number of requests needed."
```

**Structure for good errors:**
1. What went wrong (specific parameter/condition)
2. What value was provided
3. What was expected
4. How to fix it
5. Alternative approaches if applicable

---

### Pattern: Error Recovery Suggestions

**Problem:** Agents give up after errors instead of trying alternative approaches.

**Solution:** Suggest specific next steps and alternative tools.

**Example:**
```ruby
begin
  result = search_users(query: query, limit: limit)
rescue TooManyResultsError => e
  {
    error: true,
    message: "Search returned #{e.count} results, exceeding the limit of #{limit}. " \
             "Consider these options:\n" \
             "1. Add filters: status='active', role='developer', etc.\n" \
             "2. Use pagination: Set limit=50 and use offset for subsequent pages\n" \
             "3. Refine search query to be more specific\n" \
             "4. Use list_users_by_role if filtering by role"
  }
end
```

---

## Common Anti-Patterns

### Anti-Pattern: API Wrapper Without Workflow Thinking

**Problem:** Directly wrapping API endpoints without considering agent workflows.

**Example:**
```
❌ Bad - Direct API wrappers:
- api_post_users
- api_get_users_by_id
- api_patch_users_by_id
- api_delete_users_by_id

✅ Good - Workflow-oriented:
- create_user (includes validation, default setup)
- get_user (includes common joins/expansions)
- update_user (includes validation, conflict checking)
- deactivate_user (soft delete with cleanup)
```

---

### Anti-Pattern: Returning IDs Without Names

**Problem:** Agents must make additional calls to get human-readable information.

**Example:**
```json
❌ Bad:
{
  "project_id": "proj_abc123",
  "owner_id": "usr_xyz789",
  "assignee_ids": ["usr_111", "usr_222"]
}

✅ Good:
{
  "project": {
    "id": "proj_abc123",
    "name": "Website Redesign"
  },
  "owner": {
    "id": "usr_xyz789",
    "name": "Jane Smith",
    "email": "jane@example.com"
  },
  "assignees": [
    {"id": "usr_111", "name": "John Doe"},
    {"id": "usr_222", "name": "Alice Johnson"}
  ]
}
```

**Exception:** When IDs are sufficient for the use case (like update operations where the agent already has context).

---

### Anti-Pattern: Dumping All Fields

**Problem:** Returning every possible field wastes context and makes output hard to parse.

**Example:**
```json
❌ Bad - Kitchen sink approach:
{
  "id": "usr_123",
  "name": "John Doe",
  "first_name": "John",
  "last_name": "Doe",
  "full_name": "John Doe",
  "display_name": "John Doe",
  "email": "john@example.com",
  "email_verified": true,
  "email_notifications": true,
  "avatar_url": "https://...",
  "avatar_thumb_url": "https://...",
  "avatar_small_url": "https://...",
  "avatar_medium_url": "https://...",
  "avatar_large_url": "https://...",
  "created_at": 1234567890,
  "created_at_iso": "2024-01-01T00:00:00Z",
  "created_at_human": "January 1, 2024",
  "updated_at": 1234567890,
  "updated_at_iso": "2024-01-01T00:00:00Z",
  "internal_id": 12345,
  "legacy_id": "old_usr_123",
  // ... 30 more fields
}

✅ Good - Essential fields:
{
  "id": "usr_123",
  "name": "John Doe",
  "email": "john@example.com",
  "role": "developer",
  "active": true,
  "last_login": "2024-01-15 10:30 UTC"
}
```

---

### Anti-Pattern: Unclear Tool Purpose

**Problem:** Tool descriptions don't clearly explain when to use or not use the tool.

**Example:**
```
❌ Bad:
"Search for stuff in the database"
"Get information"
"Updates things"

✅ Good:
"Search for users by name, email, or role. Use this when you need to find users but don't have their ID. Returns up to 50 matching users. If you already have a user ID, use get_user instead for detailed information."
```

---

## Advanced Patterns

### Pattern: Composite Operations

**Problem:** Complex workflows require many sequential tool calls.

**Solution:** Create composite tools that handle common multi-step workflows.

**Example:**
```
Instead of requiring agents to:
1. check_meeting_availability(participants, date, duration)
2. find_meeting_room(date, duration, capacity)
3. create_calendar_event(...)
4. book_meeting_room(...)
5. send_meeting_invitations(...)

Provide:
- schedule_meeting(participants, date, duration, title)
  - Checks availability
  - Finds room
  - Creates event
  - Books room
  - Sends invites
  - Returns confirmation with all details
```

**When to use:**
- Workflow is common (>50% of use cases follow this pattern)
- Steps are always done together
- Intermediate results aren't needed separately
- Reduces agent calls from N to 1

**When NOT to use:**
- Workflow varies significantly
- Agents need control over intermediate steps
- Creates inflexible "black box" behavior

---

### Pattern: Smart Defaults from Context

**Problem:** Agents repeat same parameters across multiple calls.

**Solution:** Infer sensible defaults from previous calls or context.

**Example:**
```ruby
# Context-aware tool maintains state within a session
class ProjectTools
  def initialize
    @current_project_id = nil
  end

  def list_tasks(project_id: nil)
    # Use provided project_id, or fall back to current context
    pid = project_id || @current_project_id
    unless pid
      return {
        error: "No project_id provided and no project currently selected. " \
               "Use select_project first or provide project_id parameter."
      }
    end

    @current_project_id = pid  # Remember for next call
    fetch_tasks(pid)
  end
end
```

**Benefits:**
- Reduces repetitive parameter passing
- More natural conversation flow
- Still allows explicit overrides

---

### Pattern: Batch Operations

**Problem:** Agents need to perform same operation on multiple items.

**Solution:** Provide batch versions of common operations.

**Example:**
```
Single operations:
- get_user(user_id)
- delete_file(file_id)

Batch operations:
- get_users_batch(user_ids: List[str])
  - Returns: List of user objects
  - Handles: Missing IDs gracefully
  - Max: 100 IDs per call

- delete_files_batch(file_ids: List[str])
  - Returns: Success/failure for each ID
  - Handles: Partial failures
  - Max: 50 files per call
```

**Guidelines:**
- Set reasonable limits (50-100 items typical)
- Return partial success details
- Handle failures gracefully
- Make clear which items succeeded/failed

---

### Pattern: Filter Composition

**Problem:** Too many filter parameters make tools hard to use.

**Solution:** Group related filters into composable objects.

**Example:**
```
❌ Bad - Parameter explosion:
list_users(
    name_contains=None,
    email_contains=None,
    role=None,
    active=None,
    created_after=None,
    created_before=None,
    last_login_after=None,
    last_login_before=None
)

✅ Good - Structured filters:
list_users(
    filters={
        "name": {"contains": "john"},
        "role": {"in": ["developer", "designer"]},
        "active": true,
        "created": {"after": "2024-01-01", "before": "2024-12-31"}
    }
)
```

**Benefits:**
- Scales to many filter types
- Clear filter composition
- Easy to document with examples
- Flexible combinations

---

## Summary Checklist

When designing a tool, verify:

- [ ] Tool name is {service}_{action}_{resource} format
- [ ] Description includes when to use AND when NOT to use
- [ ] Required parameters are truly essential
- [ ] Optional parameters have sensible defaults
- [ ] Schema includes constraints and examples
- [ ] Supports multiple output formats (JSON + Markdown)
- [ ] Implements pagination for list operations
- [ ] Character limits prevent context overflow
- [ ] Error messages suggest specific fixes
- [ ] Returns human-readable names alongside IDs
- [ ] Composite operations handle common workflows
- [ ] Tested with actual AI agents on realistic tasks
