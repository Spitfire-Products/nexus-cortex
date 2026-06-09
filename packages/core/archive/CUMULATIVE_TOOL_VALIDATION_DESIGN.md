# Cumulative Tool Validation Test Design

## Concept

Create a multi-turn integration test where grok-code-fast-1 systematically validates each tool within a sandboxed workspace, with cumulative state building across turns.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Cumulative Tool Validation Test                 │
└─────────────────────────────────────────────────────────────┘
                           │
                           ├─> Create Session (grok-code-fast-1)
                           │
                    ┌──────┴──────────────────────┐
                    │   Tool Validation Phases    │
                    └──────┬──────────────────────┘
                           │
        ┌──────────────────┼──────────────────┬──────────────────┐
        │                  │                  │                  │
        v                  v                  v                  v
   ┌────────┐         ┌────────┐        ┌────────┐        ┌────────┐
   │ Phase1 │         │ Phase2 │        │ Phase3 │        │ Phase4 │
   │  File  │────────>│  Bash  │───────>│ Search │───────>│Validate│
   │  Ops   │         │  Exec  │        │  Ops   │        │ State  │
   └────────┘         └────────┘        └────────┘        └────────┘
        │                  │                  │                  │
        └──────────────────┴──────────────────┴──────────────────┘
                                   │
                         Cumulative Workspace
                         State Preservation
```

## Test Flow

### Phase 1: File Operations Validation (Turns 1-5)

**Turn 1: Create test file**
- **Prompt:** "Create a file called 'test_workspace.txt' with content 'Initial test data' in the workspace"
- **Expected Tools:** Write
- **Validation:**
  - File exists
  - Content matches
  - File path stored in workspace state

**Turn 2: Read and verify**
- **Prompt:** "Read the test_workspace.txt file you just created"
- **Expected Tools:** Read
- **Validation:**
  - Content returned correctly
  - Model confirms content matches

**Turn 3: Edit file**
- **Prompt:** "Edit test_workspace.txt to replace 'Initial' with 'Modified'"
- **Expected Tools:** Edit
- **Validation:**
  - Edit successful
  - Content updated correctly

**Turn 4: Verify edit**
- **Prompt:** "Read test_workspace.txt again to confirm the edit worked"
- **Expected Tools:** Read
- **Validation:**
  - Content shows 'Modified test data'

**Turn 5: File search**
- **Prompt:** "Use Glob to find all .txt files in the workspace"
- **Expected Tools:** Glob
- **Validation:**
  - test_workspace.txt found
  - File count correct

### Phase 2: Bash Execution Validation (Turns 6-10)

**Turn 6: Simple command**
- **Prompt:** "Use Bash to run 'echo "Hello from sandbox" > bash_test.txt'"
- **Expected Tools:** Bash
- **Validation:**
  - Command executes
  - Exit code 0
  - bash_test.txt created

**Turn 7: Verify bash output**
- **Prompt:** "Read bash_test.txt to verify the bash command worked"
- **Expected Tools:** Read
- **Validation:**
  - Content is "Hello from sandbox"

**Turn 8: Multi-command execution**
- **Prompt:** "Use Bash to create a directory 'test_dir' and create a file 'test_dir/nested.txt' with content 'nested data'"
- **Expected Tools:** Bash
- **Validation:**
  - Directory created
  - File created in directory
  - Nested structure works

**Turn 9: List directory**
- **Prompt:** "Use Bash to list files in test_dir"
- **Expected Tools:** Bash
- **Validation:**
  - nested.txt appears in listing
  - Output format correct

**Turn 10: Background process**
- **Prompt:** "Start a background bash process that sleeps for 5 seconds and echoes 'done'"
- **Expected Tools:** Bash (run_in_background=true)
- **Validation:**
  - Process starts
  - Returns process ID
  - Process running in background

### Phase 3: Search Operations Validation (Turns 11-14)

**Turn 11: Content search**
- **Prompt:** "Use Grep to search for the word 'Modified' in all txt files"
- **Expected Tools:** Grep
- **Validation:**
  - test_workspace.txt found
  - Match location correct
  - No false positives

**Turn 12: Pattern search**
- **Prompt:** "Use Grep to find all lines containing 'test' (case insensitive) in the workspace"
- **Expected Tools:** Grep (with -i flag)
- **Validation:**
  - Multiple matches found
  - Case insensitivity works

**Turn 13: File pattern search**
- **Prompt:** "Use Glob to find all files in test_dir"
- **Expected Tools:** Glob
- **Validation:**
  - nested.txt found
  - Path includes test_dir/

**Turn 14: Check background process**
- **Prompt:** "Check if the background process from Turn 10 has completed using BashOutput"
- **Expected Tools:** BashOutput
- **Validation:**
  - Can retrieve output
  - Process completed
  - Output contains 'done'

### Phase 4: State Validation & Cleanup (Turns 15-18)

**Turn 15: Workspace inventory**
- **Prompt:** "List all files created during this test using Glob for **/*"
- **Expected Tools:** Glob
- **Validation:**
  - All created files found:
    - test_workspace.txt
    - bash_test.txt
    - test_dir/nested.txt
  - No unexpected files

**Turn 16: Content verification**
- **Prompt:** "Read each file created and summarize their contents"
- **Expected Tools:** Read (multiple calls)
- **Validation:**
  - Model reads all files
  - Content matches expected
  - Model provides accurate summary

**Turn 17: Cleanup test**
- **Prompt:** "Use Bash to remove test_dir and all created .txt files"
- **Expected Tools:** Bash
- **Validation:**
  - Command executes
  - Files removed

**Turn 18: Verify cleanup**
- **Prompt:** "Use Glob to verify all test files were removed"
- **Expected Tools:** Glob
- **Validation:**
  - No test files remain
  - Workspace clean

## Implementation Structure

```typescript
describe('Cumulative Tool Validation in Sandbox', () => {
  let orchestrator: OmniClaudeOrchestrator;
  let testWorkspaceDir: string;
  const workspaceState = {
    filesCreated: new Set<string>(),
    backgroundProcesses: new Map<string, string>(),
    testResults: []
  };

  it('should validate all tools through cumulative multi-turn session', async () => {
    // Create session
    const session = await orchestrator.createSession(testWorkspaceDir, 'grok-code-fast-1');

    // Phase 1: File Operations (5 turns)
    await validatePhase1_FileOperations(orchestrator, workspaceState);

    // Phase 2: Bash Execution (5 turns)
    await validatePhase2_BashExecution(orchestrator, workspaceState);

    // Phase 3: Search Operations (4 turns)
    await validatePhase3_SearchOperations(orchestrator, workspaceState);

    // Phase 4: State Validation (4 turns)
    await validatePhase4_StateValidation(orchestrator, workspaceState);

    // Final assertions
    expect(workspaceState.testResults.every(r => r.passed)).toBe(true);
  });
});
```

## Key Validation Points

### 1. Tool Use Accuracy
- Model selects correct tool for task
- Tool parameters are valid
- Tool execution succeeds

### 2. Result Visibility
- Model can see tool results
- Model understands tool output
- Model uses results in subsequent turns

### 3. State Persistence
- Files persist across turns
- Directory structure maintained
- Process state tracked correctly

### 4. Multi-Turn Coherence
- Model remembers previous actions
- Model builds on previous results
- Model can reference earlier tool uses

### 5. Workspace Integrity
- Sandbox isolation works
- File operations don't escape workspace
- Cleanup successful

## Expected Metrics

```typescript
interface CumulativeTestMetrics {
  totalTurns: number;              // 18
  toolCallsExecuted: number;       // ~25-30
  uniqueToolsUsed: Set<string>;    // Read, Write, Edit, Glob, Grep, Bash, BashOutput
  filesCreated: number;            // 3 files + 1 directory
  commandsExecuted: number;        // ~8-10 bash commands
  searchesPerformed: number;       // 3-4 searches
  stateValidations: number;        // 5 validations
  passedPhases: number;            // 4/4
}
```

## Benefits

1. **Comprehensive Coverage:** Tests all major tool categories
2. **Real-World Scenarios:** Multi-turn conversation mimics actual usage
3. **State Verification:** Validates workspace persistence
4. **Cumulative Validation:** Each phase builds on previous, catching integration issues
5. **Model Behavior:** Tests if model can effectively use tools over multiple turns
6. **Sandbox Testing:** Validates execution environment works correctly

## Implementation Priority

1. ✅ Multi-turn tool call foundation (already created)
2. **Next:** Implement Phase 1 (File Operations)
3. **Then:** Implement Phase 2 (Bash Execution)
4. **Then:** Implement Phase 3 (Search Operations)
5. **Then:** Implement Phase 4 (State Validation)
6. **Finally:** Add metrics collection and reporting

## Success Criteria

- All 18 turns complete successfully
- All tool calls execute without errors
- Workspace state matches expectations at each checkpoint
- Model demonstrates understanding of tool results
- Session storage contains complete conversation history
- Timeline events properly tracked for each tool use
- No tool execution failures or sandbox escapes

## Future Enhancements

- Add MCP tool validation phase
- Add historical retrieval tool phase
- Add concurrent tool execution tests
- Add error recovery scenarios
- Add performance benchmarking per tool
