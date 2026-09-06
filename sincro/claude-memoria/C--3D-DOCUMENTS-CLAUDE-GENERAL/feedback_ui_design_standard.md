---
name: feedback-ui-design-standard
description: User wants awwwards-level design craft (not generic AI-boxy UI) applied by default to all interface/UI design requests
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 912c08c2-bcd0-4fbb-8965-b55dd9bbc8b0
  modified: 2026-08-10T10:09:55.804Z
---

Whenever the user asks for anything involving interface/UI design (landing pages, artifacts, components, mockups), always apply full design craft by default: deliberate color palette (not generic grey/purple-gradient defaults), considered typography with real hierarchy and pairing, fluid/responsive layout (clamp()-based type and spacing, not just breakpoints), purposeful motion (scroll-triggered reveals, hover micro-interactions, transitions respecting prefers-reduced-motion), non-rectangular/organic visual elements where fitting (not just boxy cards), and both light/dark theme support unless a single-theme look is a deliberate creative choice.

**Why:** User's reference bar is Awwwards-quality sites — they were previously getting "boxy," aesthetically flat AI-generated UI and explicitly said it looks bad. They approved a demo (fictional "Vellum — Undertow" EP teaser artifact) built using the `artifact-design` skill's editorial-treatment process (goo-filter organic blobs, clamp() fluid type, magnetic button hover, IntersectionObserver scroll reveals, clip-path curved section dividers, named token-based light/dark palette) and confirmed "ahora esta mejor" (now it's better), then asked for this standard to apply always going forward.

**How to apply:** For any future request that is UI/interface design work (artifacts, mockups, landing pages, app screens, components), invoke the `artifact-design` skill and follow its full process (design plan with color/type/layout tokens before coding; editorial treatment principles — hero as thesis, deliberate type pairing, deliberate motion, organic/non-rectangular elements where the subject supports it — for landing-page/showcase-type asks; utilitarian-but-polished treatment for docs/tools/dashboards). Don't default to boxy rounded-card layouts, purple gradients, Inter font, or centered-everything — see the skill's "avoid AI-generated design" list. Apply this even if the user doesn't explicitly mention Awwwards or design quality again — it's now a standing expectation, not a one-off request.
