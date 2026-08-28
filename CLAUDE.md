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

## Testing

Use Node 24 LTS and a committed npm lockfile. Before handing work off, run
`npm run check`, `npm run test:e2e`, and `npm run test:python-agent`. Database
changes must remain immutable Supabase migrations and pass the GitHub
`database` job from an empty database.

Every bug fix needs a regression test. New branches must cover success and
failure paths. See `docs/TESTING.md` for the Vitest, Playwright, Python, Deno,
pgTAP, build-boundary, and physical-acceptance layers.

## Vehicle handoff

Start documentation discovery at `docs/README.md`. For work on the computer
that can connect to the vehicle, read `docs/VEHICLE_PC_AI_HANDOFF.md` first.
Keep physical capability disabled until its mapping, identity, TLS, on-site
operator, physical e-stop, and no-cargo validation gates are all evidenced.
