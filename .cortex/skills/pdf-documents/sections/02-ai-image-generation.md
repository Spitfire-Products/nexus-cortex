# AI-Generated Images for Documents

When real photographs aren't available, or you need custom illustrations, diagrams, hero images, or stylised graphics — generate them via AI image APIs.

Use cases:
- Cover art / hero images for reports
- Conceptual illustrations (historical scenes, architectural visualisations)
- Custom icons, diagrams, or infographics
- Placeholder images for draft documents
- Stylised section dividers

## Provider Quick Reference

| Provider | Model | Cost | Quality | Speed | Best For |
|----------|-------|------|---------|-------|----------|
| **Cloudflare Workers AI** | FLUX.1 [schnell] | **Free tier** (~10K/day) | Good | Fast (~2s) | Quick illustrations, drafts |
| **Cloudflare Workers AI** | FLUX.2 [dev] | Free tier | Very good | Medium (~8s) | Production images, multi-ref |
| **xAI Imagine** | grok-imagine-image-quality | ~$0.07/image | Excellent | Medium | Hero images, photorealistic |
| **OpenAI** | gpt-image-2 | $0.02-0.19/image | Excellent | Medium | Text-in-image, precise control |
| **HuggingFace Inference** | FLUX.1 [schnell] / SDXL | Free (rate-limited) | Good | Variable | Open-source, customisable |

## Cloudflare Workers AI (FREE — Recommended Default)

No API key purchase needed — uses your existing Cloudflare account (free tier: ~10,000 neurons/day).

```bash
# ── FLUX.1 [schnell] — fastest, good quality ──────────────
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Underwater photograph of ancient Chinese porcelain jars on the ocean floor, covered in coral and marine growth, dramatic blue lighting, photorealistic"}' \
  --output generated-image.png

# ── FLUX.2 [dev] — higher quality, multi-reference ────────
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-2-dev" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: multipart/form-data" \
  -F "prompt=Maritime museum interior with ancient artifacts, display cases with Chinese pottery, dramatic museum lighting" \
  -F "steps=25" \
  -F "width=1024" \
  -F "height=768" \
  --output generated-image.png

# Available models (image generation):
# @cf/black-forest-labs/flux-1-schnell    — fast, 1-4 steps
# @cf/black-forest-labs/flux-2-dev        — quality, multi-reference
# @cf/black-forest-labs/flux-2-klein-9b   — balanced
# @cf/bytedance/stable-diffusion-xl-lightning  — fast SDXL
# @cf/stabilityai/stable-diffusion-xl-base-1.0 — classic SDXL
# @cf/lykon/dreamshaper-8-lcm             — stylised/artistic

# Response: raw PNG binary (pipe to file or base64)
curl -s -X POST ... | base64 -w0 > generated-image.b64
```

**FLUX parameters:**
- `prompt` — description of the image
- `steps` — inference steps (1-50; schnell: 4 optimal, dev: 20-30)
- `width` / `height` — pixel dimensions (256-1920, default 1024x768)
- `guidance` — guidance scale (dev only, default 7.5; higher = more prompt adherence)
- `seed` — reproducible generation (positive integer)

## xAI Imagine (Highest Quality — Uses Existing XAI_API_KEY)

```bash
curl -s -X POST "https://api.x.ai/v1/images/generations" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${XAI_API_KEY}" \
  -d '{
    "model": "grok-imagine-image-quality",
    "prompt": "A weathered Australian diver standing in front of a maritime museum entrance, golden hour lighting, Subic Bay Philippines",
    "n": 1,
    "aspect_ratio": "16:9",
    "resolution": "2k",
    "response_format": "b64_json"
  }' | jq -r '.data[0].b64_json' > hero-image.b64
```

**Parameters:**
- `model` — `grok-imagine-image-quality` (recommended)
- `n` — batch count (1-4; same prompt, different generations)
- `aspect_ratio` — `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `3:2`, `2:3`, `2:1`, `1:2`, `auto`
- `resolution` — `1k` or `2k`
- `response_format` — `url` (temporary, download promptly) or `b64_json` (inline)

## OpenAI GPT Image (Text-in-Image — Uses Existing OPENAI_API_KEY)

```bash
curl -s -X POST "https://api.openai.com/v1/images/generations" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "A detailed architectural cross-section diagram of a Spanish galleon ship, labelled parts, technical illustration style, white background",
    "n": 1,
    "size": "1024x1024",
    "response_format": "b64_json"
  }' | jq -r '.data[0].b64_json' > diagram.b64

# Sizes: 1024x1024, 1024x1792, 1792x1024
```

## HuggingFace Inference API (Free Tier — Open Source Models)

```bash
curl -s -X POST \
  "https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell" \
  -H "Authorization: Bearer ${HUGGINGFACE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"inputs": "Underwater shipwreck scene, coral-covered hull, tropical fish, sunlight rays through water, photorealistic"}' \
  --output generated-image.png

# Free tier: ~1000 requests/day with rate limiting
# May return 503 if model is loading — retry after 20s
```

## Provider Selection Decision Tree

```
Need it FREE and fast?
  → Cloudflare FLUX.1 [schnell] (no cost, ~2s, good quality)

Need photorealistic quality?
  → xAI grok-imagine-image-quality (best realism, ~$0.07/image)

Need accurate text rendered IN the image?
  → OpenAI gpt-image-2 (best at text-in-image rendering)

Need artistic / stylised?
  → Cloudflare DreamShaper or SDXL Lightning

Need reproducible results (seed control)?
  → Cloudflare FLUX (explicit seed parameter)

Need to stay fully open-source?
  → HuggingFace FLUX.1 or SDXL
```

## Integration into HTML Document Pipeline

```bash
#!/bin/bash
# Full pipeline: generate AI images → base64 → embed in HTML → PDF

# 1. Generate hero image
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -d '{"prompt": "Maritime museum at sunset, warm golden lighting"}' \
  --output hero.png

# 2. Generate section illustration
curl -s -X POST "https://api.x.ai/v1/images/generations" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${XAI_API_KEY}" \
  -d '{"model":"grok-imagine-image-quality","prompt":"Ming Dynasty blue and white porcelain collection","n":1,"response_format":"b64_json"}' \
  | jq -r '.data[0].b64_json' > porcelain.b64

# 3. Base64-encode the PNG (Cloudflare returns raw binary)
HERO_B64=$(base64 -w0 hero.png)

# 4. Inject into HTML (sed or template substitution)
sed -i "s|HERO_IMAGE_PLACEHOLDER|data:image/png;base64,${HERO_B64}|" document.html
sed -i "s|PORCELAIN_IMAGE_PLACEHOLDER|data:image/png;base64,$(cat porcelain.b64)|" document.html

# 5. Convert to PDF
chromium --headless --no-sandbox --disable-gpu \
  --print-to-pdf=output.pdf --print-to-pdf-no-header \
  document.html
```

## Reference-Grounded Image Generation (img2img)

For generative works — historical reconstructions, architectural visualisations, artistic interpretations — **don't generate from text alone.** Use reference images scraped during research as grounding inputs to img2img models.

**The workflow:**
```
1. Research: browse/scrape reference images (photos, paintings, maps, etc.)
2. Describe: use a vision model to describe the reference in structured detail
3. Generate: feed reference image + structured prompt to img2img model
4. Series: reuse the same reference(s) across multiple generations for visual consistency
```

**Step 1 — Collect Reference Images**
```bash
# While browsing with nexus-browser:
browse({ url: "https://example.com/museum-gallery" })
scan({ filter: { tagName: "img" } })
screenshot({ selector: ".gallery-image:nth-child(3)" })

# Or download directly:
curl -L -o reference-01.jpg "https://direct-image-url.com/photo.jpg"
```

**Step 2 — Describe via Vision Model**
```bash
curl -s -X POST "https://api.x.ai/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${XAI_API_KEY}" \
  -d '{
    "model": "grok-4.3",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "Describe this image in structured detail for use as an image generation reference. Include: subject, setting, lighting, color palette, style, composition, notable details."},
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,'"$(base64 -w0 reference-01.jpg)"'"}}
      ]
    }]
  }' | jq -r '.choices[0].message.content'
```

**Step 3 — Generate with Reference Grounding**
```bash
# Cloudflare FLUX.2 [dev] — multi-reference grounding
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-2-dev" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: multipart/form-data" \
  -F "prompt=A maritime museum entrance at golden hour, in the style of image 1, photorealistic" \
  -F "input_image_0=@reference-01.jpg" \
  -F "steps=30" \
  -F "guidance=8.0" \
  --output generated-grounded.png

# OpenAI gpt-image-2 — image editing with reference
curl -s -X POST "https://api.openai.com/v1/images/edits" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -F "model=gpt-image-2" \
  -F "image=@reference-01.jpg" \
  -F "prompt=Transform into artistic watercolor illustration, maintain architectural details" \
  -F "size=1024x1024" \
  --output generated-edit.png
```

**Step 4 — Generate a Consistent Series**
```bash
# Use the SAME reference for all generations → visually cohesive document
REFERENCE="reference-museum-exterior.jpg"
STYLE="in the photographic style of the reference, warm golden hour lighting"

curl ... -F "prompt=Wide establishing shot, ${STYLE}" -F "input_image_0=@${REFERENCE}" --output cover.png
curl ... -F "prompt=Museum interior with glass display cases, ${STYLE}" -F "input_image_0=@${REFERENCE}" --output interior.png
curl ... -F "prompt=Closeup of Ming Dynasty porcelain, ${STYLE}" -F "input_image_0=@${REFERENCE}" --output artifact.png
# All images share visual DNA from the reference → cohesive document
```

**When to use grounded vs. text-only:**

| Scenario | Method | Why |
|----------|--------|-----|
| Historical reconstruction | Grounded (ref photos of real location) | Accuracy matters |
| Architectural visualisation | Grounded (ref photos + plans) | Spatial accuracy |
| Portrait / biographical | Grounded (real photos of the person) | Likeness |
| Abstract concept / metaphor | Text-only | No real-world reference exists |
| Decorative section divider | Text-only | Style matters, not accuracy |
| Scientific diagram | SVG (hand-authored) | Precision over aesthetics |

## Prompt Engineering for Document Images

| Document Context | Prompt Suffix | Why |
|-----------------|---------------|-----|
| Cover/hero image | `dramatic lighting, professional photography, 16:9` | Eye-catching, full-width |
| Historical scene | `historical illustration style, muted earth tones, period-accurate` | Documentary tone |
| Technical diagram | `technical illustration, white background, labelled parts, clean lines` | Clarity |
| Portrait/bio | `portrait photograph, natural lighting, shallow depth of field` | Professional feel |
| Map/geography | `illustrated map style, vintage cartography, muted colors` | Readable, decorative |
| Section divider | `minimal decorative border, watercolor style, transparent background` | Subtle |

**Size guidelines for print:**
- Cover/hero: 2048x1024 minimum (fills page width at 300 DPI)
- Inline photo: 1024x768 sufficient (half-page width)
- Thumbnail/icon: 512x512 sufficient
