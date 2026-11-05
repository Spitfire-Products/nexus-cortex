/**
 * MCP tool input schemas made acceptable to every provider (2026-11-03). Draft-07 tuple validation — `items: [schemaA, schemaB]`, which
 * zod tuples emit (nexus-browser computer_use: coordinate / start_coordinate / region) — is rejected outright by DeepSeek ("… is not of
 * types boolean, object", HTTP 400) and by OpenAI strict mode, which failed EVERY request that carried the tool. A tuple becomes a
 * single `items` schema (the shared one when all positions are identical, else unconstrained) plus minItems/maxItems = its length, so
 * the shape stays described and the call stays valid. Applied where MCP tools enter the tool list; everything else passes through.
 */
export function normalizeMcpSchema<T>(schema: T): T {
  if (Array.isArray(schema)) return schema.map((s) => normalizeMcpSchema(s)) as unknown as T;
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) out[k] = k === 'items' ? v : normalizeMcpSchema(v);
  const items = (schema as Record<string, unknown>).items;
  if (Array.isArray(items)) {
    const norm = items.map((s) => normalizeMcpSchema(s));
    const same = norm.length > 0 && norm.every((s) => JSON.stringify(s) === JSON.stringify(norm[0]));
    out.items = same ? norm[0] : {};
    if (out.minItems === undefined) out.minItems = norm.length;
    if (out.maxItems === undefined && (schema as Record<string, unknown>).additionalItems !== true) out.maxItems = norm.length;
    delete out.additionalItems;
  } else if (items && typeof items === 'object') {
    out.items = normalizeMcpSchema(items);
  }
  return out as T;
}
