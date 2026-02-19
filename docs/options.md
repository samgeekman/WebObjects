# DayZ Web Editor Options

## Data confirmed from `samsobjectfinder`
- Source file: `../samsdayzobjectfinder/static/api/v1/objects.full.json`
- Objects: 11,967
- Fields available for box editor:
  - `dimensionsVisual`
  - `bboxMinVisual`
  - `bboxMaxVisual`
  - `bboxStatus` (`matched`, `not_raw_p3d`, `extract_failed`, etc)
  - `dimensionsSource` (`bbox_visual`, `estimated_tags`)

## Option 1: Static Three.js Editor (implemented here)
- Stack: plain HTML/CSS/JS + Three.js modules from CDN
- Pros:
  - fastest to start
  - no build tooling required
  - good for early UX and workflow validation
- Cons:
  - no multi-user collaboration
  - no persistence backend by default
  - less scalable structure for complex features

## Option 2: React + React Three Fiber
- Stack: Vite + React + R3F + Zustand
- Pros:
  - cleaner state management at scale
  - easier to build rich side panels, inspectors, undo/redo
  - good long-term maintainability
- Cons:
  - more setup and architectural overhead
  - slightly slower to prototype than Option 1

## Option 3: Full Editor Platform
- Stack: Option 2 frontend + backend API (Node/Postgres) + auth + project storage
- Pros:
  - team workflows, saved projects, versioning, approvals
  - easy integration with export pipelines and validation services
- Cons:
  - highest complexity and cost
  - needs deployment/security planning upfront

## Recommendation
- Start with Option 1 for rapid editor iteration and object-placement workflow validation.
- Move to Option 2 once interaction model stabilizes (undo/redo, snapping, filters, map integration).
- Add Option 3 only when you need shared projects and production operations.
