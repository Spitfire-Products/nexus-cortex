/**
 * Hugging Face Model Cards
 *
 * Models hosted on Hugging Face Inference API (serverless).
 * FREE but rate-limited. For production, use dedicated endpoints.
 *
 */

// Generic HF Inference Providers model (HF_MODEL_ID → router.huggingface.co)
export { hfRouter } from './hf-router.js';
export { hfSpace } from './hf-space.js';
// Ready-made per-model Space cards (HF_SPACE_ID_<SLUG> / HF_SPACE_CANDIDATES)
export { hfSpaceModelCards } from './hf-space-models.js';
