# Running Board: framework typography, X sizes and portrait — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All text on the Running Board uses TRMNL framework text elements with `lg:` sizes. Plan titles clamp to 1 line
on OG and 2 on X. The full layout stacks in portrait.

**Architecture:** Template-only change (`shared.liquid` and the four layout files). `transform.js` and its output don't
change. Custom CSS remains for layout, borders, the today row, the graph, the bar, the theme invert and spacing.

**Tech Stack:** TRMNL framework 3.4 (Liquid, CSS), liquidjs harness (`tests/trmnl/harness.js`), headless Chrome for
previews.

**Spec:** `docs/superpowers/specs/2026-11-02-trmnl-running-board-design.md`, section "Screens and typography (revised
2026-11-04)".

## Global Constraints

- Template files only: `integrations/trmnl-running-board/shared.liquid`, `full.liquid`, `half_horizontal.liquid`,
  `half_vertical.liquid`, `quadrant.liquid`. Do not change `src/` or `transform.js` (CI checks it matches the build).
- Every printed value stays escaped (`| escape`) except the allow-listed SVG numbers. No `<script>`, and no colour
  other than black and white (the existing template-rules tests apply to all four layouts).
- No custom `font-size`, `font-family` or `line-height` on text. Text sizes come from framework classes: `title`,
  `value`, `label` and `description` with their `--size` modifiers, and `lg:` / `portrait:` prefixed variants
  (`https://trmnl.com/framework/docs/3.4/element_sizes`). Custom CSS may still set layout, spacing, borders, colours
  for the today row and theme, and the SVG.
- OG targets (today's sizes, keep within about 3 px). Each one steps up at least once on `lg:`:

  | Text | OG today |
  |------|----------|
  | WEEK title | 26 px, bold |
  | day label | 26 px, bold |
  | day item | 19 px (done and unplanned items bold) |
  | "+N" | 19 px, bold |
  | week footer | 21 px, bold |
  | messages | 22 px, bold |
  | form heading | 24 px, bold |
  | form value | 56 px, bold |
  | graph labels, "today" | 16 px |
  | intensity heading | 17 px, bold |
  | intensity labels | 15 px |
  | run heading | 24 px, bold (compact: 20) |
  | run time | 36 px, bold (compact: 30) |
  | run lines | 22 px (compact: 18) |
  | footer | 13 px |

  The framework's px per class are in its stylesheet (`https://trmnl.com/css/3.4.0/plugins.css`; a copy is at
  `/tmp/claude-1001/-home-xander-webapps-run-window/8cbc5a18-fc1f-45ff-bc8c-3b60daa7972b/scratchpad/fw/plugins.css`,
  18 MB, so grep it).
- Screens: OG is `screen screen--og screen--1bit` (800x480, view 780x460). X is `screen screen--v2 screen--lg
  screen--4bit` (1040x780). X portrait adds `screen--portrait` (780x1040).
- Dark mode: every framework text class used gets pinned to `#000` inside `.rb`, extending today's
  `.screen .rb .title, .screen .rb .value { color: #000; }`, so the board's invert alone decides colour.
- Day items: `data-clamp="1" data-clamp-lg="2"` on each `.rb-item`. Remove `white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis` from `.rb-item`. The seven rows keep equal height; on X, when two two-line items don't fit,
  the clamp yields rather than the row overflowing.
- Run lines keep one line each (`white-space: nowrap` with overflow hidden may stay on `.rb-run__line`; it is layout,
  not typography).

## Review Focus

1. **OG regression.** The OG screen must look as it does today. Compare a before and after screenshot of `normal`
   and `long-run` at 800x480 with the framework stylesheet loaded (Task 3).
2. **Five-line run panel in every layout on X.** The bigger text must not clip the fifth line (`long-run` case)
   (Task 3).
3. **Dark mode on framework classes.** A label or description recoloured by the framework's dark mode, then inverted,
   would come out black on black (Task 1 test, Task 3 screenshot).
4. **Today row.** The inverted today row must keep white text on framework classes, which set their own colour
   (Task 1).
5. **Portrait full layout.** The week on top must still show seven rows and the footer totals; the run window must keep
   its lines (Task 2, Task 3).

---

### Task 1: Framework text elements and clamp, all layouts

**Files:**
- Modify: `integrations/trmnl-running-board/shared.liquid`, `full.liquid`, `half_horizontal.liquid`,
  `half_vertical.liquid`, `quadrant.liquid`
- Test: `tests/trmnl/render.test.js`

- [ ] **Step 1: Write failing tests** in `render.test.js`:
  - `uses no custom font sizes, families or line heights`: for `shared.liquid`, no `font-size`, `font-family` or
    `line-height` declarations (the SVG `font-size` attribute is gone too, since the "today" label is HTML).
  - `draws every text with a framework element` (per layout): each text-bearing element (week title, day label, item,
    more, total, messages, form heading, value, graph labels, today label, intensity heading and labels, run heading,
    time, lines, footer parts) carries one of `title`, `value`, `label` or `description`.
  - `steps every text up on X` (per layout): every element that has a framework text class also has an `lg:` size
    class.
  - `clamps items to one line on OG and two on X`: every `rb-item` span has `data-clamp="1" data-clamp-lg="2"`, and the
    `.rb-item` rule has no `nowrap` or `ellipsis`.
  - `pins every framework text class to black in dark mode`: the pin rule lists exactly the framework text classes the
    templates use (derive the used set from the templates, as the existing test does).
  - `keeps the today row white`: a rule makes framework text inside `.rb-day--today` white.
  - Update existing tests that pin removed CSS (font sizes, the `.rb-run--compact` font rules) to the new structure.
- [ ] **Step 2: Run** `npx jest tests/trmnl/render.test.js` and confirm the new tests FAIL.
- [ ] **Step 3: Implement.** Pick classes against the OG target table. Keep the compact run panel smaller than the
  full one by using different classes, not CSS.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run format:check` and confirm they PASS.
- [ ] **Step 5: Commit** `feat(plugin): draw all text with framework elements and lg sizes`.

### Task 2: Portrait full layout

**Files:**
- Modify: `integrations/trmnl-running-board/shared.liquid` (and `full.liquid` if a wrapper is needed)
- Test: `tests/trmnl/render.test.js`

- [ ] **Step 1: Write failing tests:**
  - `stacks the full layout in portrait`: `shared.liquid` has a `.screen--portrait` rule that sets `.rb-main` to a
    column, makes the left column full width with a bottom border instead of the right border, and gives it a share of
    the height that holds seven rows plus the footer totals.
  - `leaves landscape as it is`: the landscape rules for `.rb-main`, `.rb-left` and `.rb-right` are unchanged.
- [ ] **Step 2: Run** the tests and confirm they FAIL.
- [ ] **Step 3: Implement.** Use CSS on `.screen--portrait`, or the framework's `portrait:` utilities if cleaner. In
  the lower half, form, bar and run window go side by side or stacked, whichever fits a five-line run panel (your call;
  say which in the report).
- [ ] **Step 4: Run** `npm test && npm run lint && npm run format:check` and confirm they PASS.
- [ ] **Step 5: Commit** `feat(plugin): stack the full layout in portrait`.

### Task 3: Previews on OG, X and X portrait, and docs

**Files:**
- Modify: `tests/trmnl/preview.js`, `integrations/trmnl-running-board/README.md` (a line on X and portrait support)

- [ ] **Step 1:** Extend `preview.js` with a `--screen og|x|x-portrait` option (default `og`) that sets the screen
  classes and view sizes from Global Constraints. Half and quadrant view sizes on X: half of 1020x760 the same way as
  OG (half horizontal 1020x370, half vertical 505x760, quadrant 505x370); in portrait, swap the screen to 780x1040 and
  size the views to match.
- [ ] **Step 2:** Screenshot `normal`, `long-run`, `nl` and `paused` in every layout on all three screens, plus `normal`
  with `theme: 'dark'` on OG, using `google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars
  --window-size=W,H --screenshot=… file://…` into
  `/tmp/claude-1001/-home-xander-webapps-run-window/8cbc5a18-fc1f-45ff-bc8c-3b60daa7972b/scratchpad/preview-typography/`.
  Confirm the framework stylesheet loaded: the WEEK title is in the bitmap face on OG. Look at each screenshot for:
  clipped run lines, overflowing rows, text in a serif fallback, dark-mode black on black. List the PNG paths and what
  you saw in the report. Also take a pre-change OG baseline by checking out `main`'s templates into a temp folder, so
  OG before and after can be compared (Review Focus 1).
- [ ] **Step 3:** Update the README.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run format:check` and confirm they PASS.
- [ ] **Step 5: Commit** `test(plugin): preview the board on OG, X and X portrait`.
