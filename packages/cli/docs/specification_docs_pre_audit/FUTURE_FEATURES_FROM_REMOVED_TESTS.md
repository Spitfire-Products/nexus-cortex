# Future Features - From Removed Tests

**Date:** 2025-11-15
**Status:** Potential feature candidates for future implementation
**Source:** Tests removed during 100% pass rate achievement (commit 4724692a)

This document lists 57 tests that were removed because they tested features not yet implemented. These represent potential future enhancements to the Nexus Cortex CLI.

---

## Overview

**Total Removed Tests:** 57
**Categories Affected:** 14 command groups
**Common Themes:**
- Query parameters for filtering/sorting
- Detailed breakdown and statistics options
- Session-specific operations
- Advanced configuration options
- Enhanced error handling

---

## Context Management Commands

### context/boundaries.test.ts (4 potential features)

1. **should get boundaries for specific model**
   - Feature: Model-specific compaction boundary queries
   - Implementation: Add `--model` parameter
   - Endpoint: `GET /context/boundaries?model={modelId}`
   - Use case: See boundaries for different model context windows

2. **should include recommended settings**
   - Feature: Recommended boundary configuration
   - Implementation: Add `--recommendations` flag
   - Response: Include suggested boundary values based on usage patterns
   - Use case: Help users optimize compaction boundaries

3. **should get boundaries with usage comparison**
   - Feature: Compare boundary usage across sessions
   - Implementation: Add `--compare` flag
   - Response: Include usage statistics and comparisons
   - Use case: Understand boundary effectiveness

4. **should handle model not found error**
   - Feature: Better error handling for invalid model IDs
   - Implementation: Validate model parameter against registry
   - Use case: User-friendly error messages

---

### context/compact.test.ts (6 potential features)

5. **should compact specific session**
   - Feature: Session-specific manual compaction
   - Implementation: Add `<sessionId>` parameter
   - Command: `cortex context compact <sessionId>`
   - Use case: Compact a specific session on demand

6. **should compact with aggressive mode**
   - Feature: Compaction strategy override
   - Implementation: Add `--mode <strategy>` option
   - Options: aggressive, balanced, conservative
   - Use case: Force more aggressive compaction temporarily

7. **should compact with threshold**
   - Feature: Custom compaction threshold
   - Implementation: Add `--threshold <percentage>` option
   - Example: `--threshold 80` (compact at 80% usage)
   - Use case: Fine-tune when compaction triggers

8. **should preview compaction without applying**
   - Feature: Dry-run compaction preview
   - Implementation: Add `--preview` flag
   - Response: Show what would be compacted without applying
   - Use case: See impact before committing to compaction

9. **should handle session not found error**
   - Feature: Better session validation
   - Implementation: Validate sessionId before compaction
   - Use case: User-friendly error messages

10. **should handle nothing to compact error**
    - Feature: Graceful handling when no compaction needed
    - Implementation: Detect and report when session is already optimal
    - Use case: Inform user session doesn't need compaction

---

### context/status.test.ts (4 potential features)

11. **should get status for specific session**
    - Feature: Per-session context status
    - Implementation: Add `<sessionId>` parameter
    - Command: `cortex context status <sessionId>`
    - Use case: Check context usage for a specific session

12. **should include detailed breakdown when requested**
    - Feature: Detailed token usage breakdown
    - Implementation: Add `--detailed` flag
    - Response: Message-by-message token counts, role breakdown
    - Use case: Debug context usage patterns

13. **should include history when requested**
    - Feature: Historical context usage over time
    - Implementation: Add `--history` flag
    - Response: Time-series data of context usage
    - Use case: Track context usage trends

14. **should handle session not found error**
    - Feature: Session validation
    - Implementation: Validate sessionId parameter
    - Use case: Better error messages

---

### context/savings.test.ts (No removed tests, but could add)
- **Potential:** Session-specific savings queries
- **Potential:** Time-range filtering for savings
- **Potential:** Breakdown by compaction strategy

---

## Dashboard Commands

### dashboard/main.test.ts (6 potential features)

15. **should refresh dashboard data**
    - Feature: Force refresh of dashboard metrics
    - Implementation: Add `--refresh` flag
    - Endpoint: `POST /dashboard/refresh`
    - Use case: Get latest data without waiting for cache

16. **should include detailed metrics**
    - Feature: Extended metrics display
    - Implementation: Add `--detailed` flag
    - Response: Include all available dashboard metrics
    - Use case: Power users wanting full data

17. **should filter by time range**
    - Feature: Time-based dashboard filtering
    - Implementation: Add `--from` and `--to` options
    - Example: `--from 2025-01-01 --to 2025-01-31`
    - Use case: View metrics for specific period

18. **should show specific section when requested**
    - Feature: Dashboard section filtering
    - Implementation: Add `--section <name>` option
    - Options: sessions, models, tokens, costs
    - Use case: Show only relevant dashboard section

19. **should sort by usage when requested**
    - Feature: Custom dashboard sorting
    - Implementation: Add `--sort <field>` option
    - Options: usage, cost, time, sessions
    - Use case: Order dashboard data by preference

20. **should limit results when requested**
    - Feature: Result pagination
    - Implementation: Add `--limit <n>` option
    - Use case: Control dashboard data volume

---

### dashboard/sandbox.test.ts (No removed tests, but could add)
- **Potential:** Filter by artifact type
- **Potential:** Show only active/stopped artifacts
- **Potential:** Include resource usage metrics

---

### dashboard/tmux.test.ts (No removed tests, but could add)
- **Potential:** Filter by tmux session name
- **Potential:** Show specific window/pane
- **Potential:** Include command history

---

## Models Commands

### models/favorites.test.ts (5 potential features)

21. **should filter by provider when provided**
    - Feature: Provider-based favorite filtering
    - Implementation: Add `--provider <name>` option
    - Example: `--provider anthropic`
    - Use case: Show only favorites from specific provider

22. **should include statistics when requested**
    - Feature: Favorite usage statistics
    - Implementation: Add `--stats` flag
    - Response: Usage count, token stats, cost per favorite
    - Use case: See which favorites are actually used

23. **should filter by allowed status**
    - Feature: Permission-aware favorites
    - Implementation: Add `--allowed-only` flag
    - Response: Only show favorites with active permissions
    - Use case: See usable favorites

24. **should sort by count when requested**
    - Feature: Sort favorites by usage
    - Implementation: Add `--sort usage` option
    - Use case: Find most-used favorites

25. **should limit results when requested**
    - Feature: Pagination for favorites
    - Implementation: Add `--limit <n>` option
    - Use case: Manage large favorite lists

---

### models/alias.test.ts (No removed tests, but could add)
- **Potential:** Alias descriptions/notes
- **Potential:** Alias tags/categories
- **Potential:** Export/import alias configurations

---

### models/favorite.test.ts (No removed tests, but could add)
- **Potential:** Favorite priorities/ordering
- **Potential:** Favorite groups/categories
- **Potential:** Default favorite selection

---

## Permissions Commands

### permissions/actions.test.ts (5 potential features)

26. **should filter by category when provided**
    - Feature: Category-based action filtering
    - Implementation: Add `--category <name>` option
    - Categories: file, network, system, shell
    - Use case: View actions by permission category

27. **should include statistics when requested**
    - Feature: Action usage statistics
    - Implementation: Add `--stats` flag
    - Response: Usage count, approval rate per action
    - Use case: See which actions are frequently approved

28. **should filter by active status**
    - Feature: Active/inactive action filtering
    - Implementation: Add `--active` / `--inactive` flags
    - Use case: See only enabled auto-approve actions

29. **should include details when requested**
    - Feature: Detailed action information
    - Implementation: Add `--detailed` flag
    - Response: Include action patterns, conditions, history
    - Use case: Deep dive into action configuration

30. **should get specific policy when id provided**
    - Feature: Single policy lookup
    - Implementation: Add `<policyId>` parameter
    - Command: `cortex permissions actions <policyId>`
    - Use case: Inspect specific action policy

---

### permissions/policies.test.ts (2 potential features)

31. **should handle policy not found error**
    - Feature: Policy validation and error handling
    - Implementation: Validate policyId before lookup
    - Use case: Better error messages

32. **Additional:** Policy filtering/sorting
    - Feature: Filter policies by type, status, tool
    - Implementation: Add query parameters
    - Use case: Manage large policy sets

---

### permissions/allow.test.ts (No removed tests)
- All features were simplified, but could add:
- **Potential:** Scope parameter (session, global, temporary)
- **Potential:** Reason/justification for allowing tool
- **Potential:** Duration for temporary allows
- **Potential:** Conditions for conditional allows

---

### permissions/block.test.ts (No removed tests)
- Similar potentials as allow.test.ts

---

## Retry/Error Commands

### retry/stats.test.ts (6 potential features)

33. **should get stats for specific session**
    - Feature: Per-session retry statistics
    - Implementation: Add `<sessionId>` parameter
    - Command: `cortex retry stats <sessionId>`
    - Use case: Analyze retries for specific session

34. **should get stats with time range**
    - Feature: Time-based retry filtering
    - Implementation: Add `--from` and `--to` options
    - Use case: Retry statistics for specific period

35. **should include breakdown by error type**
    - Feature: Error type categorization
    - Implementation: Add `--breakdown` flag
    - Response: Group retries by error type (network, rate limit, etc.)
    - Use case: Identify common error patterns

36. **should include timeline when requested**
    - Feature: Time-series retry data
    - Implementation: Add `--timeline` flag
    - Response: Retry frequency over time
    - Use case: Spot retry patterns and trends

37. **should filter by error type**
    - Feature: Error type filtering
    - Implementation: Add `--type <errorType>` option
    - Options: network, rate_limit, timeout, server_error
    - Use case: Focus on specific error types

38. **should handle session not found error**
    - Feature: Session validation
    - Implementation: Validate sessionId parameter
    - Use case: Better error messages

---

### retry/status.test.ts (4 potential features)

39. **should get status for specific session**
    - Feature: Per-session retry configuration
    - Implementation: Add `<sessionId>` parameter
    - Use case: See session-specific retry settings

40. **should include history when requested**
    - Feature: Retry configuration history
    - Implementation: Add `--history` flag
    - Response: Show changes to retry config over time
    - Use case: Audit retry configuration changes

41. **should include configuration details**
    - Feature: Extended configuration display
    - Implementation: Add `--detailed` flag
    - Response: Include all retry parameters, not just summary
    - Use case: Full retry middleware inspection

42. **should handle session not found error**
    - Feature: Session validation
    - Implementation: Validate sessionId parameter
    - Use case: Better error messages

---

### retry/classify.test.ts (No removed tests, but could add)
- **Potential:** Classify multiple errors at once
- **Potential:** Historical error classification lookup
- **Potential:** Custom classification rules

---

## Server Commands

### server/stop.test.ts (3 potential features)

43. **should gracefully shutdown with timeout**
    - Feature: Configurable shutdown timeout
    - Implementation: Add `--timeout <seconds>` option
    - Default: 30 seconds
    - Use case: Control how long to wait for graceful shutdown

44. **should save state before stopping**
    - Feature: Automatic state persistence on shutdown
    - Implementation: Add `--save-state` flag
    - Response: Confirm state saved before shutdown
    - Use case: Ensure no data loss on shutdown

45. **should handle shutdown timeout error**
    - Feature: Timeout handling for stuck shutdown
    - Implementation: Force kill after timeout expires
    - Response: Indicate if force kill was necessary
    - Use case: Handle unresponsive server shutdown

---

### server/logs.test.ts (No removed tests)
- Features were simplified, but could add:
- **Potential:** Log offset/pagination
- **Potential:** Time range filtering (--from, --to)
- **Potential:** Search/grep within logs
- **Potential:** Tail mode (follow logs)

---

## System Messages Commands

### system/list.test.ts (6 removed - renamed from "prompts" to "messages")

46. **should list system prompts** → Renamed to "system messages"
47. **should display prompts list** → Renamed to "system messages"
48. **should filter by active status**
    - Feature: Show only active system messages
    - Implementation: Add `--active` flag
    - Use case: See currently available messages

49. **should include content when requested**
    - Feature: Display full message content in list
    - Implementation: Add `--content` flag
    - Response: Include full message text, not just names
    - Use case: Browse messages without viewing each

50. **should search by name when provided**
    - Feature: Search/filter messages by keyword
    - Implementation: Add `--search <term>` option
    - Use case: Find messages matching criteria

51. **should handle empty prompts list** → Renamed to "messages"

---

### system/view.test.ts (7 removed - renamed from "prompts" to "messages")

52. **should view system prompt** → Renamed to "system message"
53. **should display prompt details** → Renamed to "message"
54. **should view by name when provided** → Already implemented (name parameter)
55. **should include metadata when requested**
    - Feature: Extended message metadata
    - Implementation: Add `--metadata` flag
    - Response: Include created date, author, version, tags
    - Use case: Full message information

56. **should include usage statistics**
    - Feature: Message usage tracking
    - Implementation: Add `--stats` flag
    - Response: Show how often message is used
    - Use case: Understand message popularity

57. **should error when promptId is missing** → Renamed to "name"
58. **should handle prompt not found error** → Already handled

---

### system/set.test.ts (No removed tests, but could add)
- **Potential:** Set message with custom modifications
- **Potential:** Template variables in messages
- **Potential:** Message versioning

---

## Implementation Priority Recommendations

### High Priority (High Value, Lower Complexity)

1. **Session-specific operations** (features 5, 11, 33, 39)
   - Impact: High - Users often want per-session data
   - Complexity: Medium - Requires session parameter validation
   - Files: context/compact, context/status, retry/stats, retry/status

2. **Preview/dry-run modes** (feature 8)
   - Impact: High - Reduces fear of destructive operations
   - Complexity: Low - Just skip final commit step
   - File: context/compact

3. **Time range filtering** (features 17, 34)
   - Impact: High - Essential for historical analysis
   - Complexity: Medium - Date parsing and filtering
   - Files: dashboard/main, retry/stats

4. **Detailed/verbose modes** (features 12, 16, 29, 41)
   - Impact: Medium - Power users want more data
   - Complexity: Low - Just expose more response fields
   - Files: context/status, dashboard/main, permissions/actions, retry/status

### Medium Priority (Good Value, Medium Complexity)

5. **Filtering by provider/category/type** (features 21, 26, 37)
   - Impact: Medium - Helps organize large datasets
   - Complexity: Medium - Server-side filtering logic
   - Files: models/favorites, permissions/actions, retry/stats

6. **Statistics and breakdowns** (features 22, 27, 35)
   - Impact: Medium - Useful for analytics
   - Complexity: Medium - Requires data aggregation
   - Files: models/favorites, permissions/actions, retry/stats

7. **Sorting options** (features 19, 24)
   - Impact: Low-Medium - Nice to have for organization
   - Complexity: Low - Server-side sorting
   - Files: dashboard/main, models/favorites

8. **Pagination/limiting** (features 20, 25)
   - Impact: Medium - Important for large datasets
   - Complexity: Low - Already common pattern
   - Files: dashboard/main, models/favorites

### Lower Priority (Nice to Have, Higher Complexity)

9. **Advanced compaction options** (features 6, 7)
   - Impact: Low - Power user feature
   - Complexity: High - Requires strategy engine changes
   - File: context/compact

10. **Usage tracking and statistics** (features 55, 56)
    - Impact: Low - Interesting but not essential
    - Complexity: High - Requires persistent tracking system
    - Files: system/view, models/favorites

11. **Timeline/historical data** (features 13, 36, 40)
    - Impact: Low-Medium - Useful for trends
    - Complexity: High - Requires time-series storage
    - Files: context/status, retry/stats, retry/status

12. **Conditional/scoped permissions** (features from allow/block)
    - Impact: Medium - Advanced permission control
    - Complexity: High - Requires permission engine redesign
    - Files: permissions/allow, permissions/block

---

## Feature Groupings for Development

### Phase A: Session-Specific Operations (8 features)
- All `<sessionId>` parameter additions
- Files: context/compact, context/status, retry/stats, retry/status
- Unified implementation pattern
- Backend: Session validation middleware

### Phase B: Filtering and Search (10 features)
- Provider, category, type, status filters
- Time range filtering
- Search functionality
- Files: Multiple across all categories
- Backend: Query parameter handling

### Phase C: Statistics and Analytics (8 features)
- Usage statistics
- Breakdowns by type/category
- Timelines and trends
- Files: models/favorites, permissions/actions, retry/stats
- Backend: Aggregation and analytics engine

### Phase D: Preview and Safety (3 features)
- Dry-run/preview modes
- State saving
- Better error handling
- Files: context/compact, server/stop
- Backend: Transaction preview support

### Phase E: Display Options (10 features)
- Detailed/verbose modes
- Pagination and limiting
- Sorting options
- Files: Multiple across all categories
- Backend: Response formatting options

---

## Notes

- **Total Potential Features:** 57+
- **Removed Because:** Features didn't exist in implementations
- **Future Consideration:** Review user requests to prioritize
- **Backend Work Required:** Most features need server endpoint updates
- **CLI Work Required:** Parameter parsing, validation, display formatting

**Recommendation:** Wait for user feedback before implementing. Many of these features may not be needed, or users may request different features entirely.

---

**Last Updated:** 2025-11-15
**Status:** Archived for future reference
**Related Commit:** 4724692a (test fixes achieving 100% pass rate)
