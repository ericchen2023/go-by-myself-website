# Project guidance

## Design system

Read and follow `DESIGN.md` before changing UI. The visual direction is a calm
campus wayfinding system: warm paper, pine/route/coral palette, restrained
separators, one dominant job and action per screen, and the canonical route as
the primary project-owned visual.

Use the complete official NDHU emblem from `public/brand/ndhu-emblem.svg`; never
recolor, crop, distort, rotate, or rebuild it. Keep `學生專題，非 NDHU 官方服務`
on public surfaces. Do not introduce card mosaics, decorative blobs, gradients,
glass effects, fake phone frames, English decoration, or duplicated route
coordinates. Internal graph labels such as P, HSS, LIBRARY, and ADMIN must not
appear in the visible map.

Vehicle positions must come from canonical `segmentId + progress` geometry.
Honor reduced motion, 44×44px targets, WCAG 2.2 AA, the semantic station list,
and the breakpoint rules documented in `DESIGN.md`.
