/**
 * Summary generation templates for conversation compaction
 * Based on research: 02-claude-cli-analysis/CONVERSATION_SUMMARIZATION_SYSTEM.md
 */

/**
 * Template for requesting summary generation from LLM
 * This prompts the model to create a 9-section summary
 */
export const SUMMARIZATION_REQUEST_TEMPLATE = `Your task is to create a detailed summary of the conversation that can be used to resume the conversation later.

Before providing your final summary, wrap your analysis in <analysis> tags to think through the conversation chronologically.

Your summary should include the following sections:
1. Primary Request and Intent
2. Key Technical Concepts
3. Files and Code Sections
4. Errors and Fixes
5. Problem Solving
6. All User Messages
7. Pending Tasks
8. Current Work
9. Optional Next Step

<example>
<analysis>
Let me chronologically analyze this extensive conversation...

**Initial Request:**
[What user originally asked]

**My Approach:**
[How I tackled it]

**Key Documents Created:**
[Files written during conversation]

**Critical Finding:**
[Important discoveries]

**User Feedback and Course Correction:**
[User interventions and pivots]

**Most Recent Work:**
[What was being worked on]

**Files Examined:**
[All files read with line numbers]

**Current State:**
[Where things stand now]
</analysis>

<summary>
## 1. Primary Request and Intent
[Initial user request]
[How intent evolved]
[Current request/task]

## 2. Key Technical Concepts
[Architectural patterns]
[Data structures]
[Technologies used]
[Critical insights]

## 3. Files and Code Sections
[All files read or modified]
[Line numbers for important code]
[Explanations of why each file matters]
[Key code snippets with context]

## 4. Errors and Fixes
[What went wrong]
[User feedback]
[How it was fixed]
[Lessons learned]

## 5. Problem Solving
[Problems encountered]
[Analysis approaches]
[Solutions implemented]
[Ongoing work]

## 6. All User Messages
[Verbatim quotes of every user message]
[Preserves exact wording for context]

## 7. Pending Tasks
[Incomplete work]
[Blockers]
[Next steps]

## 8. Current Work
[What was being worked on when compaction triggered]
[Status of in-progress tasks]
[Context for resumption]

## 9. Optional Next Step
[Recommended next action]
[Based on conversation flow]
</summary>
</example>

Please analyze the conversation above and create a summary following this exact format. Be thorough and preserve all critical details.`;

/**
 * Template for resuming a conversation with a summary
 * Injected as a system-reminder when session resumes
 */
export function createResumptionMessage(summary: string): string {
  return `This session is being continued from a previous conversation that ran out of context. The conversation is summarized below:

${summary}

Please continue the conversation from where we left it off without asking the user any further questions. Continue with the last task that you were asked to work on.`;
}

/**
 * Extract summary from LLM response
 * Looks for content between <summary> tags
 */
export function extractSummary(response: string): string | null {
  // Try to extract from <summary> tags
  const summaryMatch = response.match(/<summary>(.*?)<\/summary>/s);
  if (summaryMatch && summaryMatch[1]) {
    return summaryMatch[1].trim();
  }

  // Try to extract from <analysis> tags if no summary
  const analysisMatch = response.match(/<analysis>(.*?)<\/analysis>/s);
  if (analysisMatch) {
    // If we only have analysis, use the whole response as summary
    return response.trim();
  }

  // No structured tags found, return whole response
  return response.trim();
}

/**
 * Extract analysis from LLM response
 * Looks for content between <analysis> tags
 */
export function extractAnalysis(response: string): string | null {
  const match = response.match(/<analysis>(.*?)<\/analysis>/s);
  return (match && match[1]) ? match[1].trim() : null;
}

/**
 * Validate summary has all required sections
 * Returns true if summary appears complete
 */
export function validateSummary(summary: string): boolean {
  const requiredSections = [
    '1. Primary Request and Intent',
    '2. Key Technical Concepts',
    '3. Files and Code Sections',
    '4. Errors and Fixes',
    '5. Problem Solving',
    '6. All User Messages',
    '7. Pending Tasks',
    '8. Current Work',
    '9. Optional Next Step'
  ];

  // Check if all sections are present
  for (const section of requiredSections) {
    if (!summary.includes(section)) {
      console.warn(`Summary validation: Missing section "${section}"`);
      return false;
    }
  }

  return true;
}

/**
 * Calculate approximate token count (rough estimate)
 * Based on average of 4 characters per token
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}
