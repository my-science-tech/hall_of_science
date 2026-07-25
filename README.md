# Periyar Science & Technology Centre — Exhibit Hall

A 5-page bilingual (English / Tamil) interactive exhibit hall, gesture-controlled
via webcam pinch-tracking with automatic fallback to click/tap.

## Pages
- `index.html` — Exhibit Hall (entry point, links to all 4 exhibits, visitor counter)
- `energy.html` — Clean Energy Challenge (5 zones, match renewable source to ecosystem)
- `machines.html` — Simple Machines Challenge (5 puzzles, match tool to problem)
- `science.html` — Everyday Science Kiosk (5 grab-the-right-object mini demos)
- `air.html` — Science in the Air (freeform pinch-to-draw canvas)

## Shared files
- `css/style.css` — full design system (colors, type, components) used by every page
- `js/gesture.js` — the gesture engine, shared by every page:
  - Tries to start the webcam and load **MediaPipe Hands** from a CDN
  - Detects a pinch as the distance between thumb tip and index fingertip
  - If the camera or MediaPipe fails to load within ~6s (no camera, permission
    denied, offline, unsupported browser), it **automatically falls back** to
    plain click / tap — every interactive element already has both a
    `data-gesture-target` attribute and a normal click handler, so nothing
    else needs to change per page
  - Injects the shared UI: the status LED pill (top bar), the floating
    camera preview thumbnail, the gesture cursor dot, and the bottom
    **Home / Play again** nav bar on every exhibit page

## Controls
- **Pinch to select** (camera mode): bring thumb and index fingertip together
  over a card/button, then release — like a mouse click.
- **Pinch and move to draw** (air.html only): hold the pinch while moving to
  draw a stroke; release to lift the pen.
- **Click / tap** (fallback mode, or on desktop without a camera): works
  identically to pinch, since both modes fire the same events.

## Fixing "can't get past the first exhibit"
The original site had two issues that made it feel stuck:
1. No visible "Home" or "Play again" control if the hand-tracking/pinch
   nav link lost webcam tracking.
2. No fallback path when the camera wasn't available or permission was denied.

This version fixes both — there's always a clickable Home / Play again pair
at the bottom of every exhibit, and the whole site works with a mouse/finger
even if the camera never turns on.

## Deploying
This is a static site — copy all files (keeping the `css/` and `js/` folders)
into your GitHub Pages repo (e.g. `my-science-tech/hands_on_science`) and
push. No build step required.

## Notes
- No video is recorded or stored anywhere — the camera feed is only used
  live, in-browser, for hand tracking.
- MediaPipe Hands/Camera Utils are loaded from `cdn.jsdelivr.net` at runtime,
  so the exhibit pages need an internet connection for camera mode (fallback
  click/tap mode works fully offline).
