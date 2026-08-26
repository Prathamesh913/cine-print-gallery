# CinePrint UI Refinement — Design System Plan

Branch: `redesign/discovery-and-ui-polish` · Baseline: origin/main @ 1bd2af3
Scope rule: presentation-only consolidation. No backend/API/Firebase/saved-sync changes.

## Findings (audits, verified against source)

- Tokens exist (`src/styles.css` @theme: radius tiers off `--radius`, oklch palette,
  `--font-display/heading/sans`) but are bypassed: 42 inline `fontFamily` styles,
  hardcoded `#FF6B6B`/surface hexes, 5 different card recipes, 3 segmented controls
  (TabToggle / submit role selector / Radix Tabs unused), `ui/button.tsx` imported by nothing.
- `--radius: 0.375rem` makes the tiers (lg=6px, xl=10px) too small to be useful, so
  everything real uses `rounded-2xl`/`rounded-full`, and `rounded-xl` vs `rounded-2xl`
  surfaces drift apart.
- Page shell `mx-auto max-w-[1600px] px-4 sm:px-6` copy-pasted; profile.tsx missing gutters;
  narrow pages arbitrary (`max-w-xl/2xl`, py-16/py-20).
- TabToggle cramped on desktop (`sm:min-h-0` collapses 44px → ~30px), inline-style states, no tab roles.
- Homepage: full-catalog SSR loader; client-side Fisher–Yates shuffle reorders after hydration
  (flash); artists reachable only via context menu; `/constellation` orphaned (zero inbound links);
  no curated/featured/date fields exist — grouping by artist/genre/decade/style/palette only.
- Artist page: name + grid only. Supported data: poster list, palette JSON
  (`poster-palettes.json`: 5-color palette + primary per poster id, build-time), optional portfolio URL.
  No bio field anywhere — none will be fabricated.
- About: single narrow column, no imagery, all-inline fonts, flat hierarchy; ticket/curator-pass card is the strongest asset.

## Canonical language (decided centrally)

**Radius tiers** — implemented by one token change (`--radius: 0.375rem → 0.75rem`),
not by sweeping classes:

| Tier | Value | Used for |
|---|---|---|
| `rounded-sm/md` | 8 / 10px | compact inner chips, tiny controls |
| `rounded-lg` | 12px | inputs, menus, list rows, thumbnails |
| `rounded-xl` (= old `rounded-2xl`) | 16px | buttons, cards, modals, major surfaces |
| `rounded-full` | pill | pills, tags, badges, avatars, CTAs |

`rounded-xl` now equals the de-facto card standard (16px), collapsing the biggest drift.

**Surfaces**
- L0 page: black bg (`background`)
- L1 card/modal/rail: `border-white/12 bg-white/[0.06] rounded-2xl` (CollectionCard recipe)
- L2 inset strip/stat: `border-white/5 bg-white/5 rounded-xl`
- Backdrop-blur reserved for: floating chrome (Header/menus/modals over media).

**Typography**: `font-display` (Bebas) display headings/eyebrows · `font-heading`
(Poppins) titles & UI headings · Inter body. No inline `fontFamily`. Eyebrow recipe:
mono micro-label, `tracking-[0.2em]+ uppercase white/55 or accent`. Mono count lines only
where no tab-count badge duplicates them (kept: index/artist; dropped: profile/saved).

**Buttons** (`ui/button.tsx`, canonicalized once):
- `default`: pill, `bg-[#FF6B6B]` dark-text, h-11 px-5, active:scale-95
- `outline`: `border-white/15 bg-white/5 hover:bg-white/10`
- `destructive`: ghost-red outline family (profile/c/$id precedent)
- focus ring: `focus-visible:ring-2 ring-[#FF6B6B]` everywhere; inputs keep `focus:border-accent`.

**Segmented control** = TabToggle only. Uniform h-11, px-4, container
`rounded-xl border-white/12 bg-white/[0.06] p-1 gap-1`, class-based states, `role="tablist"/tab`,
`aria-selected`, focus-visible ring. API unchanged.

**Spacing/shell**: `.page-shell` = `mx-auto max-w-[1600px] px-4 sm:px-6`;
narrow editorial pages max-w-2xl/3xl px-6 py-12–16. Section rhythm mb-8 within pages.

**Empty/loading**: shared `<EmptyState icon title body>{actions}</EmptyState>`
(`src/components/states.tsx`) + collection-grid skeletons from same module.
Reduced-motion handled globally (styles.css override already exists).

**Motion**: reuse existing convention — `transition … duration-150/200 ease-[var(--ease-out)]`,
`active:scale-95`, hover effects behind `hoverable:` variant. No new entrance animations.

## Rejected proposals (recorded)

- Global hex→token color sweep: oklch tokens don't byte-match `#FF6B6B`; would shift brand
  pixels. Out of scope for this branch.
- Blanket `<Button>` migration of ~40 inline buttons: churn without payoff; adopt in touched
  code only.
- Linkifying artist caption inside PosterCard: root is a `<button>` — nested anchor invalid.
  Artist pathways come from rails/directories instead (homepage rail, Lightbox, ContextMenu).
- Collage-mosaic artist hero: eager extra image loads for many 1-poster artists; palette-CSS
  hero chosen instead (no added requests).

## Sequence

B shared primitives (this doc's commits) → C homepage discovery (daily-seeded spotlight +
artist rail + deterministic server shuffle; fix hydration flash) → D artist palette hero →
E profile polish → F saved toggle/page consistency → G about editorial layout →
H cross-page responsive QA.
