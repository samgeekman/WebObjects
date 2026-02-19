# DayZ Web Box Editor (Prototype)

A lightweight browser editor for placing and editing 3D bounding-box representations of DayZ objects using `samsobjectfinder` catalog and dimension data.

## What this prototype does
- Loads object catalog with dimensions from `samsobjectfinder`
- Search + select objects with image tiles
- Drag object tile onto the plane to place a 3D bounding box
- Select placed objects and move/rotate/scale with gizmo
- Edit dimensions directly (X/Y/Z)
- Export/import DayZ editor JSON

## Setup
1. Build local object catalog:
```bash
./scripts/build-object-catalog.sh
```

Optional custom source path:
```bash
./scripts/build-object-catalog.sh /path/to/objects.full.json
```

2. Start local server from this repo:
```bash
python3 -m http.server 8080
```

3. Open:
- `http://localhost:8080`

## Notes on dimensions
- If `bboxStatus` is `matched`, the editor uses `bboxMinVisual`/`bboxMaxVisual` to preserve offset from model origin.
- If exact bbox is unavailable, it falls back to `dimensionsVisual` and centers the box at object origin.

## Architecture options
See `docs/options.md`.

## Deploy to GitHub Pages
This repo is set up for automatic Pages deploy via:
- `.github/workflows/deploy-pages.yml`
- `.nojekyll`

Steps:
1. Create a new GitHub repo and push this folder to `main`.
2. In GitHub repo settings, open `Pages`.
3. Under `Build and deployment`, choose `Source: GitHub Actions`.
4. Push to `main` (or run the workflow manually in `Actions`).
5. Open the published URL shown in the workflow output.
