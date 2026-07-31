# Tool Usage Examples

## Example 1: Search → Read → Edit Chain

**Task**: Find where the User class is defined and add a new method.

```
Step 1: Grep(pattern="class User", output_mode="content")
→ Result: "src/models/User.ts:10:export class User {"

Step 2: Read(file_path="src/models/User.ts")
→ Result: Full file content with exact indentation

Step 3: Edit(file_path="src/models/User.ts", old_string="<exact text from Read>", new_string="<modified text>")
→ Result: File updated
```

Key: Read before Edit. Copy exact text from Read output for old_string.

## Example 2: Parallel Tool Calls

**Task**: Read both package.json and tsconfig.json to compare settings.

Output both tool calls in one response for parallel execution:
```
Read(file_path="/workspace/package.json")  +  Read(file_path="/workspace/tsconfig.json")
```

Both results arrive together. Respond with analysis of both files.

## Example 3: Parallel Task Dispatch

**Task**: Analyze both the authentication system and database layer.

Output both Task calls in one response:
```
Task(description="Analyze auth", subagent_type="explore", prompt="Search for authentication...")
Task(description="Analyze database", subagent_type="explore", prompt="Search for database...")
```

Both agents run concurrently. Results return together for synthesis.

## Example 4: Task Tracking Lifecycle

**Task**: Find and fix a bug in the authentication module.

```
Step 1: Create tasks (one call per task)
TodoCreate({ content: "Search for auth module files", activeForm: "Searching for auth files" })
→ Created task #1

TodoCreate({ content: "Read and identify the bug", activeForm: "Reading auth code" })
→ Created task #2

TodoCreate({ content: "Fix the bug", activeForm: "Fixing auth bug" })
→ Created task #3

Step 2: Start first task
TodoUpdate({ taskId: "1", status: "in_progress" })

Step 3: Complete first, start second
TodoUpdate({ taskId: "1", status: "completed" })
TodoUpdate({ taskId: "2", status: "in_progress" })

Step 4: Complete second, start third
TodoUpdate({ taskId: "2", status: "completed" })
TodoUpdate({ taskId: "3", status: "in_progress" })

Step 5: Complete final task
TodoUpdate({ taskId: "3", status: "completed" })
```

Key: One task per TodoCreate call. TodoUpdate sends only changed fields (no full list resend).
