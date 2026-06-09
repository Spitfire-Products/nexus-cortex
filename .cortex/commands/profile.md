---
description: Profile a task for token usage, tool iterations, and efficiency
argument-hint: [task-description]
---

Execute this task and report detailed performance metrics: $1

After completing the task, provide a performance report:
- **Token usage**: input tokens (system overhead vs content), output tokens
- **Tool iterations**: how many tool round-trips were needed
- **Tools used**: which tools were called and how many times each
- **Efficiency**: could this have been done in fewer iterations? What would you do differently?
- **Cache effectiveness**: were cache hits leveraged?

Be explicit about the numbers — this data is used to benchmark and optimize the system.
