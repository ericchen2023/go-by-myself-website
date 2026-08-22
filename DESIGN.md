# go by myself Design System

## Concept

**East Coast Dispatch / 東岸派送站**

The product should feel like a campus field guide crossed with a trustworthy
transport control desk. The route is the visual identity: thick inked paths,
clear stop plates, a signal-orange delivery pod, and operational copy that
never overclaims real-world state.

The interface is not an app mockup and not a dashboard mosaic. Every screen has
one dominant job, one dominant action, and one canonical route view.

## Brand hierarchy

1. The official NDHU emblem is used in its complete supplied form. Never crop,
   recolor, distort, rotate, or rebuild it.
2. `go by myself` is the student-project product name.
3. Every public surface retains `學生專題，非 NDHU 官方服務` so use of the
   university identity does not imply an official university service.
4. The route, `P` origin capsule, and orange vehicle pod are project-owned
   visual devices.

## Visual language

- **Shape:** mostly square and clipped surfaces; rounded geometry is reserved
  for the circular university emblem, route stops, status dots, and pill-like
  vehicle/origin forms.
- **Line:** 2px dark ink for structural borders; 5–8px route strokes; dashed
  micro-lines only for pending or simulated states.
- **Texture:** a very subtle engineering grid and registration marks. No soft
  decorative blobs and no gradient-heavy backgrounds.
- **Composition:** asymmetric editorial layouts, large type, deliberate open
  space, and a single clear focal action.

## Color tokens

| Token | Value | Use |
|---|---|---|
| `ink` | `#10231d` | Primary text, borders, route base |
| `forest` | `#006b4f` | NDHU-adjacent brand field, trusted states |
| `forest-dark` | `#083d31` | Header/footer and deep surfaces |
| `signal` | `#c7ef58` | Active route, focus, primary call to action |
| `vehicle` | `#f36b3f` | Vehicle marker and physical-action emphasis |
| `paper` | `#f2efe5` | Page background |
| `surface` | `#fffdf6` | Main work surfaces |
| `muted` | `#5d6d66` | Secondary text |
| `danger` | `#b63838` | Unsafe or terminal states |

Do not place white body text on `signal`; use `ink`. Status meaning must never
depend on color alone.

## Typography

- Chinese UI: `Noto Sans TC`, then native Traditional Chinese sans fallbacks.
- Latin display and operational labels: `Arial Narrow`, `Roboto Condensed`,
  then sans-serif. Use condensed uppercase sparingly for routing metadata.
- Technical data: `ui-monospace`, `SFMono-Regular`, `Consolas`, monospace.
- Display headlines may be very large, but body copy stays at least 16px with a
  line-height around 1.65.

## Spacing and layout

- 4px base grid; common gaps: 8, 12, 16, 24, 32, 48, 72px.
- Main content max width: 1240px.
- Home desktop: editorial hero (roughly 7/5) followed by a focused access dock.
- Delivery desktop: primary workspace (roughly 8/4) plus operational rail.
- Below 900px everything stacks; below 720px the semantic stop list appears
  before the overview map.
- Interactive targets are at least 44×44 CSS px; primary actions are at least
  48px high.

## Core components

### Official brand lockup

Complete NDHU emblem at 44–64px, followed by a two-line product lockup. It must
always have clear space and an undistorted 1:1 aspect ratio.

### Primary button

Signal-lime fill, 2px ink border, offset ink shadow. Hover lifts by 2px; active
returns to the baseline. The label describes the immediate intent.

### Work surface

Paper-white background, ink border, small or zero radius, and a top registration
bar. Avoid nesting multiple generic cards inside it.

### Stepper

Eight connected numbered stops. Completed steps use a check plus text; current
step uses signal fill and a strong focus ring. Compact view shows `步驟 n / 8`
and a real progress element.

### Route map

The route graph exactly follows the supplied schematic: main north–south trunk,
library at the northeast end, two west-facing HSS branches, `P` at the lower
origin, and Administration at the southeast end. Stop plates are visually
distinct from route nodes. The vehicle is a small orange pod with wheels and is
always projected from canonical route geometry.

### Status action block

The current operational truth and the immediate safe action are paired in one
high-contrast block. Pending, accepted, completed, and unknown are distinct.

## Motion

- Vehicle projection interpolates only between two verified samples, around
  160–220ms per demo frame.
- Active route uses a slow directional dash, not a glow.
- Buttons use 120–180ms translation/shadow feedback.
- `prefers-reduced-motion: reduce` disables route dash, interpolation, and
  decorative motion.
- Never animate stale or off-route raw positions.

## Accessibility

- WCAG 2.2 AA contrast; 44×44 target policy.
- Strong signal-colored `:focus-visible` outline with a dark offset.
- The map has a semantic radio-list alternative and roving SVG focus.
- Pickup/dropoff use text and symbols (`放` / `收`) in addition to color.
- Live regions announce state transitions, not every telemetry frame.
- At 200% zoom the primary action remains in normal document flow.

## Copy voice

Concise, concrete, calm, and operational. Prefer `正在要求開艙` over generic
`處理中`; prefer `尚未確認艙門已開啟` over optimistic claims. Demo-only facts
are always labelled as simulated.
