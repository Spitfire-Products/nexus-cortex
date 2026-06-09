/**
 * TaskClassifier — heuristic task-type detector for model routing.
 *
 * Classifies a user prompt into one of the benchmark task types (T1-T5)
 * so the ModelRouterMatrix can recommend the best model. Classification
 * is keyword-based and intentionally simple — a 90% heuristic that can
 * be replaced with an LLM classifier later without changing the surface.
 */

export type TaskType = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'GENERAL';

interface ClassificationResult {
  taskType: TaskType;
  confidence: number;
}

const PATTERNS: { taskType: TaskType; keywords: RegExp[]; weight: number }[] = [
  {
    taskType: 'T1',
    keywords: [
      /\b(grep|search|find|locate|where is|which file|defined in|look for)\b/i,
      /\b(read|show me|what does .+ look like|open|cat)\b/i,
      /\b(codebase|source code|implementation|function|class|method)\b/i,
    ],
    weight: 1.0,
  },
  {
    taskType: 'T3',
    keywords: [
      /\b(list|discover|available|what .+ exist|show .+ tools|capabilities)\b/i,
      /\b(session|history|previous|past conversation)\b/i,
      /\b(what can you|how many|enumerate)\b/i,
    ],
    weight: 1.0,
  },
  {
    taskType: 'T4',
    keywords: [
      /\b(audit|analyze|review|assess|evaluate|architecture)\b/i,
      /\b(security|middleware|pipeline|flow|dependency|coupling)\b/i,
      /\b(how does .+ work|explain .+ system|trace .+ through)\b/i,
    ],
    weight: 1.1,
  },
  {
    taskType: 'T5',
    keywords: [
      /\b(create|build|implement|write|generate|design|make)\b/i,
      /\b(new (tool|function|component|module|page|feature))\b/i,
      /\b(landing page|dashboard|CLI command|UI)\b/i,
    ],
    weight: 1.2,
  },
];

export function classifyTask(prompt: string): ClassificationResult {
  const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
  let bestType: TaskType = 'GENERAL';
  let bestScore = 0;

  for (const pattern of PATTERNS) {
    let hits = 0;
    for (const kw of pattern.keywords) {
      if (kw.test(text)) hits++;
    }
    const score = (hits / pattern.keywords.length) * pattern.weight;
    if (score > bestScore) {
      bestScore = score;
      bestType = pattern.taskType;
    }
  }

  // T2 (multi-turn) is detected by conversation length, not prompt content.
  // The orchestrator upgrades to T2 when messageHistory.length > 6.

  const confidence = Math.min(1.0, bestScore);
  if (confidence < 0.2) return { taskType: 'GENERAL', confidence: 0 };
  return { taskType: bestType, confidence };
}
