# Skill Tool - Complete Guide

**Status**: ✅ Complete and Tested (25/25 tests passing)
**Date**: 2025-11-03

---

## Overview

The `Skill` tool invokes specialized skills defined in SKILL.md files within `.claude/skills/` directories. Skills are model-invoked capabilities that extend Claude's functionality with reusable instructions, examples, and supporting resources.

### Key Features

- ✅ Load skills from SKILL.md files with YAML frontmatter
- ✅ Support both project (`.claude/skills/`) and personal (`~/.claude/skills/`) skills
- ✅ Optional tool restrictions via `allowed-tools` field
- ✅ Skill caching for performance
- ✅ Descriptive error messages
- ✅ Full metadata tracking

---

## Skill File Format

Skills are defined as directories containing a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: skill-name
description: Brief description of what this skill does and when to use it
allowed-tools: Read, Write, Grep  # Optional
---

# Skill Name

## Instructions
Provide clear, step-by-step guidance for Claude.

## Examples
Show concrete examples of using this skill.

## Notes
Any additional context or references.
```

### Required Fields

- **Frontmatter block**: Delimited by `---` (YAML format)
- **name**: Lowercase letters, numbers, and hyphens only (max 64 characters)
- **description**: Explains both what the skill does and when Claude should use it (max 1024 characters)
- **Body**: Skill instructions and examples (after frontmatter)

### Optional Fields

- **allowed-tools**: Comma-separated list of tools Claude can use when this skill is active (e.g., `Read, Grep, Bash`)

---

## Directory Structure

### Basic Skill

```
.claude/skills/pdf-analyzer/
└── SKILL.md          # Required: skill definition
```

### Skill with Supporting Files

```
.claude/skills/pdf-analyzer/
├── SKILL.md          # Required: skill definition
├── reference.md      # Optional: reference documentation
├── examples.md       # Optional: additional examples
├── scripts/
│   └── helper.py     # Optional: utility scripts
└── templates/
    └── template.txt  # Optional: templates
```

---

## Storage Locations

### Project Skills (Shared with Team)

- **Location**: `.claude/skills/skill-name/`
- **Purpose**: Skills specific to a project, shared with team members
- **Version Control**: Checked into git, automatically available to team

### Personal Skills (Your Workflows)

- **Location**: `~/.claude/skills/skill-name/`
- **Purpose**: Skills for individual workflows, available across all projects
- **Scope**: Personal, not shared with team

**Priority**: Project skills take precedence over personal skills with the same name.

---

## Usage

### Basic Example

**Skill Directory** (`.claude/skills/pdf-analyzer/SKILL.md`):
```markdown
---
name: pdf-analyzer
description: Analyze PDF documents and extract information
allowed-tools: Read, Grep, Bash
---

# PDF Analyzer

## Instructions

Use this skill to analyze PDF documents systematically.

Steps:
1. Locate the PDF file using Grep or Glob
2. Use Read tool to access PDF contents
3. Extract key information (citations, dates, amounts)
4. Summarize findings

## Examples

### Research Paper Analysis
- Extract citations and bibliography
- Identify methodology section
- Summarize key findings

### Invoice Processing
- Extract invoice number and date
- Identify line items and amounts
- Calculate totals
```

**Tool Call**:
```typescript
import { SkillToolExecutor } from '@omniclaude/executors';

const executor = new SkillToolExecutor({
  workingDirectory: '/path/to/project'
});

const result = await executor.execute(
  { command: 'pdf-analyzer' },
  new AbortController().signal
);

console.log(result.returnDisplay);
```

**Output**:
```markdown
# Skill: pdf-analyzer

**Description**: Analyze PDF documents and extract information
**Location**: project (~project/.claude/skills/pdf-analyzer/)
**Allowed Tools**: Read, Grep, Bash

---

# PDF Analyzer

## Instructions

Use this skill to analyze PDF documents systematically.

Steps:
1. Locate the PDF file using Grep or Glob
2. Use Read tool to access PDF contents
3. Extract key information (citations, dates, amounts)
4. Summarize findings

## Examples

### Research Paper Analysis
- Extract citations and bibliography
- Identify methodology section
- Summarize key findings

### Invoice Processing
- Extract invoice number and date
- Identify line items and amounts
- Calculate totals
```

---

## Tool Access Restriction

Use the `allowed-tools` frontmatter field to limit which tools Claude can use when a skill is active:

### Read-Only Skill

```yaml
---
name: safe-file-reader
description: Read and analyze files without making changes
allowed-tools: Read, Grep, Glob
---
```

This skill restricts Claude to read-only operations, preventing Write, Edit, or Bash commands.

### Security-Sensitive Skill

```yaml
---
name: code-security-audit
description: Audit code for security vulnerabilities
allowed-tools: Read, Grep
---
```

Limits to file reading and searching only, ensuring no modifications during security audits.

---

## Example Skills

### 1. PDF Analyzer

**File**: `.claude/skills/pdf-analyzer/SKILL.md`
```markdown
---
name: pdf-analyzer
description: Analyze PDF documents and extract information
allowed-tools: Read, Grep, Bash
---

# PDF Analyzer

## Instructions

Analyze PDF documents systematically:

1. **Locate File**: Use Grep to find PDF files
2. **Extract Text**: Use Bash with pdftotext if needed
3. **Analyze Structure**: Identify sections and key components
4. **Extract Data**: Pull out specific information based on type

## Document Types

### Research Papers
- Extract title, authors, abstract
- Identify citations and references
- Summarize methodology and findings

### Invoices
- Extract invoice number, date, vendor
- Identify line items and amounts
- Calculate totals and verify accuracy

### Contracts
- Identify parties and effective dates
- Extract key terms and obligations
- Highlight important clauses
```

### 2. Code Reviewer

**File**: `.claude/skills/code-reviewer/SKILL.md`
```markdown
---
name: code-reviewer
description: Review code for quality, security, and best practices
---

# Code Reviewer

## Instructions

Review code systematically across multiple dimensions:

### Security Review
- SQL injection vulnerabilities
- XSS (Cross-Site Scripting) risks
- Authentication/authorization issues
- Sensitive data exposure
- Input validation

### Code Quality
- Error handling completeness
- Edge case coverage
- Code organization and structure
- Naming conventions
- Documentation quality

### Performance
- N+1 query problems
- Inefficient algorithms
- Memory leaks
- Unnecessary computations

### Best Practices
- SOLID principles adherence
- DRY (Don't Repeat Yourself)
- Appropriate design patterns
- Test coverage

## Review Process

1. Read the code file(s)
2. Identify potential issues in each category
3. Prioritize findings by severity
4. Provide specific recommendations
5. Suggest code improvements
```

### 3. XLSX Processor

**File**: `.claude/skills/xlsx-processor/SKILL.md`
```markdown
---
name: xlsx-processor
description: Process and analyze Excel spreadsheets
allowed-tools: Read, Bash
---

# XLSX Processor

## Instructions

Process Excel files systematically:

1. **Read File Structure**
   - Identify sheets and columns
   - Determine data types
   - Check for headers

2. **Data Analysis**
   - Calculate statistics (sum, average, etc.)
   - Identify patterns and trends
   - Detect anomalies

3. **Data Validation**
   - Check for missing values
   - Verify data types
   - Validate relationships

4. **Generate Insights**
   - Summarize key findings
   - Create recommendations
   - Highlight actionable items

## Common Use Cases

- Financial report analysis
- Data cleanup and validation
- Trend identification
- Report generation
```

---

## Integration Example

### Complete Setup

```typescript
import { SkillToolExecutor } from '@omniclaude/executors';

// Create executor
const skillTool = new SkillToolExecutor({
  workingDirectory: process.cwd()
});

// Execute skill
const result = await skillTool.execute(
  { command: 'pdf-analyzer' },
  new AbortController().signal
);

// Check result
if (result.success) {
  console.log('Skill invoked successfully:');
  console.log(result.returnDisplay);

  // Access metadata
  console.log('Metadata:', {
    skillName: result.metadata.skillName,
    location: result.metadata.location,
    description: result.metadata.description,
    allowedTools: result.metadata.allowedTools,
    executionTime: result.metadata.executionTime
  });
} else {
  console.error('Skill invocation failed:', result.returnDisplay);
}
```

### With Tool Registry

```typescript
import { ToolRegistry, SkillToolExecutor } from '@omniclaude/executors';

const toolRegistry = new ToolRegistry({
  workingDirectory: process.cwd()
});

// Register Skill tool
toolRegistry.registerTool(
  new SkillToolExecutor({
    workingDirectory: process.cwd()
  })
);

// Execute via registry
const result = await toolRegistry.executeTool(
  'Skill',
  { command: 'pdf-analyzer' },
  new AbortController().signal
);
```

---

## Error Handling

### Skill Not Found

```typescript
const result = await executor.execute(
  { command: 'nonexistent' },
  signal
);

// result.success = false
// result.returnDisplay = "Skill 'nonexistent' not found in .claude/skills/ or ~/.claude/skills/
//
// Available skills: pdf-analyzer (project), code-reviewer (project), xlsx-processor (project)"
```

### Invalid Skill Name

```typescript
// Skill name with invalid characters
const result = await executor.execute(
  { command: 'invalid/skill' },
  signal
);

// result.success = false
// result.returnDisplay = "skill name must contain only letters, numbers, and hyphens"
```

### Missing Skills Directory

If `.claude/skills/` doesn't exist, skills simply won't be found:

```typescript
const result = await executor.execute(
  { command: 'any-skill' },
  signal
);

// result.success = false
// result.returnDisplay = "Skill 'any-skill' not found..."
```

---

## Metadata

Each successful execution includes rich metadata:

```typescript
result.metadata = {
  executionTime: 12,              // Milliseconds
  skillName: 'pdf-analyzer',      // Skill name
  location: 'project',            // 'project' or 'personal'
  description: 'Analyze PDF documents and extract information',
  allowedTools: ['Read', 'Grep', 'Bash']  // Optional
}
```

---

## Performance

### Skill Caching

Skills are cached after first load for performance:

- **First execution**: Loads from disk (~5-10ms)
- **Subsequent executions**: Uses cache (~<1ms)

### Cache Management

```typescript
// Clear cache to reload skills from disk
executor.clearCache();

// Next execution will reload
const result = await executor.execute({ command: 'pdf-analyzer' }, signal);
```

Use cache clearing when:
- Skills are modified on disk
- New skills are added
- Testing skill reloading

---

## Testing

### Test Coverage

✅ **25/25 tests passing (100%)**

Test categories:
- Skill Loading (4 tests)
- Frontmatter Parsing (4 tests)
- Parameter Validation (4 tests)
- Abort Signal (1 test)
- Cache Management (2 tests)
- Output Formatting (4 tests)
- Edge Cases (4 tests)
- Skill Content (2 tests)

### Running Tests

```bash
npm run test:run -- skill
```

---

## Advanced Usage

### Personal vs Project Skills

Skills with the same name in both locations:

```
~/.claude/skills/pdf-analyzer/    # Personal skill
.claude/skills/pdf-analyzer/      # Project skill (takes precedence)
```

**Priority**: Project skills override personal skills.

### Multiple Projects

Each executor is scoped to a working directory:

```typescript
// Project A
const executorA = new SkillToolExecutor({
  workingDirectory: '/path/to/projectA'
});

// Project B
const executorB = new SkillToolExecutor({
  workingDirectory: '/path/to/projectB'
});
```

### Dynamic Skill Creation

Create skills programmatically:

```typescript
import { promises as fs } from 'fs';
import { join } from 'path';

const skillsDir = join(process.cwd(), '.claude', 'skills', 'my-skill');

// Create directory
await fs.mkdir(skillsDir, { recursive: true });

// Write SKILL.md
await fs.writeFile(
  join(skillsDir, 'SKILL.md'),
  `---
name: my-skill
description: My custom skill
---

# My Skill

## Instructions
Custom instructions here...
`
);

// Clear cache and use
executor.clearCache();
const result = await executor.execute(
  { command: 'my-skill' },
  signal
);
```

---

## Best Practices

### 1. Clear, Descriptive Names

✅ Good: `pdf-analyzer`, `code-reviewer`, `data-validator`
❌ Bad: `pa`, `cr`, `dv`

### 2. Comprehensive Descriptions

```yaml
---
name: pdf-analyzer
description: Analyze PDF documents and extract information including citations, dates, and key terms. Use when processing research papers, invoices, or contracts.
---
```

### 3. Structured Instructions

Use markdown formatting for clarity:

```markdown
## Instructions

### Step 1: Preparation
- Check file exists
- Verify file type

### Step 2: Analysis
- Extract text
- Identify structure

### Step 3: Output
- Summarize findings
- Provide recommendations
```

### 4. Tool Restrictions

Restrict tools for security-sensitive operations:

```yaml
---
allowed-tools: Read, Grep
---
```

### 5. Include Examples

Provide concrete examples:

```markdown
## Examples

### Example 1: Research Paper
Input: research-paper.pdf
Output:
- Title: "Machine Learning Advances"
- Authors: Smith et al.
- Citations: 42 references
```

---

## Limitations

### Current Limitations

1. **Simple Name Matching**: Skill names must match exactly (case-sensitive after normalization)
2. **No Nested Skills**: Skills cannot invoke other skills directly
3. **Static Content**: Skill content is loaded as-is, no dynamic templating

### Future Enhancements

Potential improvements:
- Skill parameters/arguments
- Skill composition and chaining
- Dynamic content generation
- Skill version management
- Skill dependencies

---

## Troubleshooting

### Skills Not Loading

**Issue**: Skills not found even though files exist

**Solutions**:
1. Check directory structure: `.claude/skills/skill-name/SKILL.md`
2. Verify SKILL.md format: Must have `---` frontmatter delimiters
3. Check skill name: Must contain only letters, numbers, and hyphens
4. Clear cache: `executor.clearCache()`

### Frontmatter Not Parsing

**Issue**: Frontmatter not parsing correctly

**Solutions**:
1. Check YAML format: `key: value` (space after colon)
2. Verify frontmatter delimiters: `---` on separate lines
3. Ensure no extra spaces before/after `---`
4. Validate name and description fields are present

### Tool Restrictions Not Working

**Issue**: allowed-tools field not restricting tools

**Solutions**:
1. Verify format: `allowed-tools: Tool1, Tool2, Tool3`
2. Check tool names are correct and comma-separated
3. Note: Tool restriction is metadata only; enforcement happens at orchestrator level

---

## Comparison: Skills vs SlashCommands

| Feature | Skills | SlashCommands |
|---------|--------|---------------|
| **Invocation** | Model-invoked (Claude decides) | User-invoked (explicit /) |
| **File Format** | SKILL.md | .md with any name |
| **Arguments** | None (fixed instructions) | Yes ($1, $2, etc.) |
| **Tool Restriction** | Yes (allowed-tools) | No |
| **Use Case** | Reusable capabilities | Custom workflows with parameters |

---

## Summary

The `Skill` tool provides a powerful way to define reusable, model-invoked capabilities as SKILL.md files.

### Key Benefits

- ✅ Model-invoked (Claude decides when to use)
- ✅ SKILL.md file format with YAML frontmatter
- ✅ Optional tool restrictions for security
- ✅ Project and personal skill locations
- ✅ Fast skill caching
- ✅ Comprehensive testing (25/25 tests)
- ✅ Production ready

### Files

- **Implementation**: `packages/executors/src/implementations/extensions/SkillTool.ts` (355 lines)
- **Tests**: `packages/executors/src/tests/integration/skill.test.ts` (392 lines, 25 tests)
- **Documentation**: `packages/executors/SKILL_TOOL.md` (this file)

---

**Status**: ✅ Complete and Production Ready
**Version**: 1.0.0
**Test Coverage**: 100% (25/25 tests passing)
