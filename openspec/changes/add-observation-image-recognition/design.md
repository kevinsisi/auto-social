# Design: Observation Image Recognition

## Flow

1. A Threads scan stores candidate text and `images_json` as it does today.
2. Before running the existing social AI pipeline, `pipeline-runner` parses up to the configured maximum image URLs.
3. If a reusable successful image analysis exists, the runner uses it.
4. Otherwise, the runner allocates one Gemini key-pool step named `image-recognition` and calls a vision analyzer.
5. The analyzer downloads allowed image URLs with timeout, size, and MIME guards, then calls Gemini with inline image data and a JSON-only prompt.
6. The runner stores `image_analysis_json` whether the result succeeds, partially succeeds, or fails.
7. Downstream prompts receive `visualSummary` through `candidateBlock`.
8. Observation API and UI expose the stored image analysis.

## Data Shape

`trend_candidates.image_analysis_json` stores:

```json
{
  "status": "none|success|partial|failed",
  "summary": "圖片重點摘要",
  "images": [
    { "url": "https://...", "description": "...", "textDetected": "...", "notableObjects": ["..."] }
  ],
  "error": null,
  "model": "gemini-2.5-flash",
  "analyzedAt": "2026-05-17T00:00:00.000Z"
}
```

Rules:

- `none` means the candidate had no image URLs.
- `success` means at least one image was analyzed and no requested image failed.
- `partial` means at least one image was analyzed but another image was skipped or failed.
- `failed` means no image could be analyzed.

## Prompt Integration

`candidateBlock` adds a `visualSummary` line only when `imageAnalysis.status` is `success` or `partial` and `summary` is non-empty.

The visual context is labeled as image recognition output so downstream steps know it is derived from attached media, not original post text.

## Failure Handling

- Image fetch failures, non-image MIME types, oversize images, malformed Gemini JSON, and Gemini errors are captured in `image_analysis_json.error`.
- These errors do not set `pipeline_status = pipeline_blocked` unless the text pipeline itself fails.
- The UI distinguishes image recognition failure from full AI判讀 failure.

## Limits

- Analyze at most the first 3 image URLs per candidate.
- Reject images larger than 6 MB.
- Use per-image fetch timeout and Gemini request timeout.
