# UI conventions

## Primitives are hand-rolled, not shadcn

`Button`, `ButtonLink`, `Card` and `Spinner` live in `src/components/ui.tsx`.
Extend that file rather than installing component libraries. Do not run
`shadcn add` — it writes into `src/components/ui/`, a directory that would
shadow the existing `ui.tsx` and break every `#/components/ui` import.

Links that look like buttons use `ButtonLink`, which is built with `createLink`
from TanStack Router. Wrapping `Link` by hand loses the typed `to` inference.

## Styling

Tailwind v4 through `@tailwindcss/vite`, with the design tokens defined in
`src/styles.css`: `ink` / `ink-soft` / `ink-faint` for text, `surface` /
`surface-sunk` / `page` for backgrounds, `brand-*` for accent, `hairline` /
`hairline-strong` for borders. Use the tokens, not raw palette colours, so dark
mode keeps working.

Base element styles belong in `@layer base`. An unlayered rule beats a utility
class regardless of source order, which once made every primary link invisible.

Icons come from `lucide-react`.

## Artwork

Two committed image sets, each rebuilt from a source in the repo rather than at
deploy time:

- App icons and launch screens come from `public/icon.svg` via `pnpm icons`.
  `AppMark` in `src/components/app-mark.tsx` is the same glyph inline, for
  screens that show the brand.
- The link-preview card is `scripts/og-card.html`, rasterised to `public/og.png`
  by `pnpm og` (needs a local Chrome). The `og:` and `twitter:` tags that point
  at it live in the root route's `head`.

## Mobile first

The app is used on a phone, usually installed to the home screen. Favour
compact vertical rhythm, tap targets of at least 44px, and layouts that survive
a 390px viewport. `NativeShell` supplies the standalone-mode behaviours
(edge-swipe back, revalidate on resume); route transitions are configured in
`src/router.tsx`.

Let the document scroll. A screen that pins itself to the viewport and scrolls
a box inside it never lets a browser fold its address bar and toolbar away, so
in a tab it pays two strips of screen for the whole visit. The Explore feed is
the worked example: `html[data-feed]` in `src/styles.css` holds the snapping
and the card height, sized in `svh` because WebKit does not re-snap a track
that changed size under it. Note also that `overflow-x: hidden` on `body` would
quietly undo all of this — one axis hidden makes the other a scroll container —
which is why it is `clip`.
