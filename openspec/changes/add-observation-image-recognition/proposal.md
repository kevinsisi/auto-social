# Observation Image Recognition

## Why

Threads observations already store image URLs and show thumbnails, but the AI analysis only reads text. Image-heavy posts can be misclassified, scored poorly, or produce generic replies because the model never receives the visual context.

The observation pipeline should describe attached images before classification and drafting, while failing safely when an image cannot be fetched or analyzed.

## What Changes

### New behavior

- For observed Threads candidates with images, run a Gemini vision step before text analysis.
- Store a structured image analysis result on the candidate, including status, summary, per-image descriptions, model, analyzed time, and any error.
- Include the visual summary in downstream classify, sponsored/scam detection, scoring, and draft prompts.
- Show the image recognition status and summary on observation post cards.
- If image recognition fails, continue the existing text-only pipeline and expose the image-analysis error separately.

### Safety and accuracy

- Only describe images that were actually downloaded and analyzed.
- Never infer hidden image content from URLs, filenames, or surrounding text.
- Bound image downloads by count, size, content type, and timeout so one bad image cannot block a whole pipeline run.

## Non-Goals

- No OCR-only product surface beyond the vision model's summary.
- No image storage or proxying of Threads media.
- No video frame extraction in this slice.
- No automatic Threads reply behavior change.

## Capabilities

### New Capabilities

- `observation-image-recognition`: Vision summaries for observed social candidates with attached images.

### Modified Capabilities

- `keyword-observation`: Observation post cards expose image recognition output.
- `social-ai-pipeline`: Existing analysis and draft steps receive visual context when available.

## Impact

- Backend:
  - Add `image_analysis_json` persistence on `trend_candidates`.
  - Add Gemini vision analyzer with bounded image fetches and graceful failure.
  - Feed visual context through `SourceCandidateInput` and prompt builder.
- Frontend:
  - Add image analysis fields to observed post types.
  - Render image recognition summary/status on post cards.
- Tests:
  - Cover successful visual context persistence, graceful failure, observe API exposure, and prompt inclusion.
