# Handoff: StillGotIt — "Pixel Nature" redesign

## Overview
This is a full visual and UX revamp of the StillGotIt Vue frontend (`frontend/src/*.vue`, `style.css`). It replaces the current cyanotype/Georgia look with a pixel-art nature language on white. The type and pixel palette come from the WhaleLife repo (`App/Shared/Design/Theme.swift` and `PixelArt.swift`).

It covers every screen:
- Sign-in
- Home, with Tree and Tasks views
- Forest view, a course overview
- Memory, each skill's estimate curve and the day to review it by
- Learn (lesson and tutor chat)
- Materials, with an in-app file viewer
- Plan
- Settings and the tutor picker

## About the design files
The files in this bundle are **design references created in HTML**. They are clickable prototypes that show the intended look and behaviour, not production code to copy.

The task is to **recreate these designs in the existing StillGotIt Vue 3 + TypeScript frontend**, using its patterns:
- Keep `api.ts`, `host-api.ts`, and the concept and wire types.
- Keep the accessibility and focus work that already exists: `focus.ts`, the `.reason` tooltips, and the `aria-*` attributes.
- Keep every existing behaviour (refusals, retries, draft save queue, speech, attachments, regrade and correction). Only the presentation and information architecture change.

To view the prototype, open `StillGotIt A5 - Pixel Nature.dc.html` in a browser. It needs `support.js` beside it and `fonts/`.

It has a Tweaks panel with these props:
- `homeView`: tree or tasks
- `startScreen`
- `extraSkills`: 0–80 sample skills, to stress-test the grove
- `groveDesign`: seed

Sample data is MIT 18.06SC linear algebra.

## Fidelity
**High-fidelity.** Colours, type, spacing, pixel art and interactions are final. Recreate them pixel-perfect.

The file pages inside the viewer (PDF, slides, photos, markdown) are typeset mockups. Real rendering should use pdf.js (or similar) for PDFs, a slide-image rendition for PPTX, `<img>` for photos, and markdown-it for `.md`.

## Global design language
- **Ground:** pure white `#FFFFFF`. There is no tinted canvas. The app is a 14px inset white card with a 1px `#ECECE8` border and 24px radius, next to a transparent sidebar.
- **No CSS gradients anywhere.** Depth comes from solid fills, a 3px solid bottom "pixel edge" on primary buttons (`box-shadow: 0 3px 0 <edge>`), and pixel-art scenes.
- **Explanatory copy does not sit on the page.** Every "how this works" sentence lives behind a pixel ⓘ button (`ICONS.info`, 20px). Clicking it opens a dark bubble: `#1C1C1D` background, white 12px text, 260px wide, 12px radius, shadow `0 10px 24px rgba(0,0,0,.22)`, placed below the button. Only one bubble is open at a time.
- **Biomes:** each area has one accent family, used for its primary button, selected nav capsule and secondary chips.

| Area | Primary bg | Text | Edge | Hover | Secondary bg / text | Nav capsule |
|---|---|---|---|---|---|---|
| Home (meadow) | #8FD3A6 | #0E3A22 | #55AE77 | #A2DBB5 | #E7F6EC / #1C5A37 | #C6EAD1 |
| Plan (ocean) | #86CDE9 | #08344D | #43A2CB | #9AD6EE | #E2F3FA / #0D4F70 | #C3E6F4 |
| Materials (sand) | #F5C98E | #4A2A08 | #D5964B | #F8D6A8 | #FCEFD9 / #7A4A12 | #FADFB5 |
| Memory (dawn) | #B9B0F5 | #21185A | #8A7EE0 | #C7C0F7 | #EEEBFF / #3B2F8F | #D9D4FA |
| Learn (dawn) | #B9B0F5 | #21185A | #8A7EE0 | #C7C0F7 | #EEEBFF / #3B2F8F | — |

- **Semantic colours:**
  - Due / alert: coral `#D9663A`, wash `#FBE6DC`, text `#A8412F`
  - New: wash `#FBF0D6`, text `#8A5A12`
  - Strong / success: `#2F8A5F`, wash `#EEF7F1`
  - Review: wash `#E3EEF3`, text `#2A6B85`
- **Neutrals:**
  - Ink `#151515`
  - Soft `#4A4A48`
  - Muted `#5F5F5C`
  - Faint `#6F6F6C`
  - Lines `rgba(20,20,20,.08)`
  - Inset fills `#F5F5F3` and `#F1F1EE`
- **Mastery cells:** never a smooth bar. Mastery is shown as N square cells, typically 10 cells, 6px tall, with a 2px gap. Filled cells are `#4A775A` (Home/Learn) or `#3FA7D1` (Plan load). Empty cells are `#E6E6E2` or `#DCEEF6`.

### Typography (fonts in `fonts/`)
- **Pixelify Sans** is for headings, section eyebrows and big dates. Use integer px sizes only.
  - Eyebrow: 11–12px, uppercase, letter-spacing 1px, faint colour.
  - Page or section title: 22px.
  - Card title: 22–26px.
- **Instrument Sans** is for all sentences, buttons and every number, with `font-variant-numeric: tabular-nums`.
  - Body: 13–15px.
  - Buttons: 14–15px, weight 700.
  - Big percentages: 700, 30–34px, letter-spacing −1px.
- **Spline Sans Mono** is for code and maths blocks.
- **Newsreader** is for the PDF page mock only.
- Disable ligatures globally: Pixelify turns "fi" into a glyph that reads as "A". Use `*{font-variant-ligatures:none!important;font-feature-settings:"liga" 0,"clig" 0!important}`.

### Pixel art (`pixel-art.js`)
- 12×12 icons and 7×7 sprites are letter grids. `PAL` maps letters to hex.
- Render with `shape-rendering:crispEdges` SVG `<rect>` runs (`iconRects`), or on a canvas with `imageSmoothingEnabled=false` and integer cell sizes (4–5px).
- **Icons:** home, calendar, school (materials), tree (forest), settings, sun, info, lighthouse, summit, leaf (brand mark), and `docIcon(kind)`. The doc icon's bottom band is coral for PDF, yellow for PPTX, green for IMG and blue for MD.
- **Mastery sprites** (`stageOf(m)`):
  - bud: no estimate
  - sprout: under 35
  - leaf: under 65
  - full: under 80
  - bloom: 80 and up
  - flag: due today
- **WhaleLife whale** (`WHALE` rects) appears in the Plan sea, mirrored to face right, drawn at 2px per unit.

## Screens

### Sidebar (all in-app screens)
- **Width:** 252px (216px under 1100px). Transparent, padding 20/12/14/14.
- **Brand:** leaf icon plus "StillGotIt" in Pixelify 20px.
- **Course switcher card:** white, radius 18, 1px ring `#E6E6E2`. Eyebrow "COURSE", course name 14/650 with ellipsis, chevron, and "Course confidence 62%" in muted 12px once a skill has an estimate. The dropdown lists courses, each with its confidence as 5 mastery cells and a number ("–" before any estimate), and "+ New course".
- **Nav items:** pill rows, 15px, with a 24px pixel icon. The rows are Home, Plan, Materials, Forest view and Memory.
  - The selected row is a solid capsule in its biome colour (table above) with ink text.
  - Badges are 20px pills: coral `#D9663A` with white text when unselected, and inverted when selected.
  - When a lesson is open, Home gets a sub-row: a lavender `#F1EEFF` chip with a `#8B7FE0` square and the skill name.
- **Bottom of the sidebar:**
  - A Today card (sun icon, "8 of 30 min", 15 sun-yellow cells `#E3A233` on `#F1EBDA`).
  - Settings (pixel sliders icon, then the username).

### Home
1. **Hero scene card.** This one component replaces the old header, the Next-up card and the "Midterm in N days" chip.
   - min-height 214px, radius 24, 1px `#DCEBE1` border.
   - Behind it is a full-bleed pixel canvas, 4px cells:
     - sky bands `#CFE6F0 → #F3F4E6`
     - drifting clouds
     - far hills `#BFDCC8` and near hills `#A3D6B4`
     - grass `#7CC497` / `#6DB892`
   - A dotted sand path `#E9D6A8` runs from "You · today" (a leaf sprite on a mound) past one wooden post per day to a hill carrying a coral flag whose cloth ripples on an eased loop.
   - A wooden plank sign sits over the flag: "Midterm / Thu · in 6 days". Its style is `#E9D6A8` with inset `0 -2px 0 #CDB884` and outline `0 0 0 2px #C08324`.
   - The sun's arc position follows today's minutes against the budget.
   - A white panel sits on the scene: 16px margin, max-width 52% (66% when the card is under 760px), radius 18. It contains:
     - Eyebrow: "FRIDAY, OCTOBER 23 · NEXT UP · 12 MIN" in `#3F7A55`.
     - Title in Pixelify 24.
     - Reason in 14px muted text.
     - Start review (meadow primary) and a "Skip today" underlined link.
   - Under the card are a Tree/Tasks segmented control (`#F2F2EF` track, white thumb) and a "Forest view" outline button (`#CFE6D7` ring, tree icon).
2. **Tree view.** Grid `minmax(0,1fr) minmax(290px,340px)`, stacked under 1180px.
   - **Grove** (canvas, 4px cells, height 112 cells):
     - one seeded pixel tree per topic (unit), each sized by its skill count and drawn in the topic's tree kind (see "Tree kinds" in [visual-design.md](../visual-design.md))
     - leaves at branch tips are the mastery sprites; spare tips are open buds
     - a wooden plank under each tree shows the topic name and "N skills · avg%"
     - a dashed "+ Plant a topic" plot at the end opens Materials
     - it scrolls horizontally when wider than its container
     - hovering a leaf shows a dark tag with the name and %, and clicking selects the leaf; the selected leaf gets pixel corner brackets
   - **Grove header:** summary eyebrow, ⓘ, sprite legend, and "Regrow · design N", which increments the seed.
   - **Skill card:**
     - A top band in `#F1F8F2`: a 52px sprite tile, the unit eyebrow, the title, then a 34px % with the last-check note and 10 cells.
     - A body with the outcome (15px), then Open lesson (primary) and Practice (secondary).
     - Do not repeat the gate text ("To master it") here, and don't add a second suggestions card. The Materials badge in the sidebar is the single entry point.
3. **Tasks view.** Grouped by topic: Pixelify 21 topic header plus "N skills · avg%".
   - Rows: grid `28px | 1fr | auto | 14px`. The sprite comes first, then the title (15/650, wraps, never truncated), a one-line outcome and a 5px cell bar (max 220px). The % (15/700) and a status pill sit on the right.
   - Pill states: Due today (coral), New (sun), Strong (green), "Review <day>" (sky).
   - A "Later today" side card.

### Forest view (full-screen overlay; opened from the nav or the Home button; Esc closes)
- A header with a pixel tree tile, an eyebrow showing the course, a "Course forest" title, Regrow, and "Back to desk".
- A "Course progress" summary in the aside (under the canvas on phones): the course average as a number with 20 mastery cells, four count tiles (sprite, number, label: mastered, growing, new, due today), and one row per topic with its average cells and skill count; selecting a row opens that topic.
- **Canvas** (5px cells, 4px when small):
  - sky, sun arc, clouds
  - two mountain layers `#AFC6D1` and `#97C2A6`
  - ambient pines, grass, a winding path, and foreground bushes
  - one big topic tree per unit, staggered front and back
  - flowers at a tree's base for each mastered skill
  - wooden signposts under each tree; clicking one toggles that topic, and the selected topic dims the others
- ⓘ in the top-left corner.
- **Aside** (340px, 280px under 1100px):
  - a selected-skill card with Open lesson and Practice
  - "Whole course" average %, with 20 cells
  - a topics accordion, with cells and %; it expands to skill rows (sprite, title, %/due)
  - "+ Plant a topic"

### Learn
- **Header:** white, bottom border `#ECEAF3`.
  - A 52px lavender sprite tile, a "← Your skill tree" link and the title (Pixelify 26/1.3).
  - On the right: a mastery chip (%, "mastery", 7px cells; it toggles the rail on narrow screens) and "Check my understanding" (dawn primary).
  - **Tabs:** underline tabs, 14px. The selected tab is weight 700 with an inset `0 -3px 0 #8A7EE0` underline. Each tab has an 8px square (sky for Lesson, sun for Practice), "Lesson 2", the date in faint text, and ✓ if assessed. "+ New conversation" is a text button.
- **Thread** (max 760px):
  - Your bubbles: `#EEEBFF`, radius 18/18/4/18.
  - Tutor turns: leaf icon and "StillGotIt", with Hint and Practice-task tags. Code and maths blocks use the mono font on `#F5F5F3`.
  - The "From <source> ↗" chip opens that file at the cited page in Materials.
- **Assessment review:** "Ready for assessment?" with ⓘ and three custom checkboxes. Assess is disabled until "I reviewed…" is checked.
- **Result card:** result (green or ink), new %, delta, rationale, "Try a fresh check", and a regrade link.
- **Composer:** radius 22, with "＋ Photo of work", "Speak" (coral square), the tutor model ("Gemini 3.8 Flash · Medium", a quiet pill that opens Settings at the Tutor section) and "Ask for a hint" (practice only). ⓘ sits next to send; the note text lives there. Send is a 38px square with radius 12.
- **Rail** (312px, `#FAF9FE`; on screens under 1240px it slides over and the chip opens it). Stacked white cards with radius 18 and ring `#ECE9F5`:
  1. Your mastery: sprite, 30px %, 10 cells, ⓘ.
  2. Goal: the outcome. A divider follows, then "To master it" with the gate. This is the only place the gate appears.
  3. Evidence: a timeline with a `#E3DEF7` rail and `#A79CEE` square nodes.
  4. Taught from: source buttons with a FILE tag and ↗, which open Materials at that page.

### Materials
- **No big headline.** Use one row: school icon, "Materials" (Pixelify 22), "N files", ⓘ for the privacy note. On the right are Import graded work (secondary) and + Add material (sand primary).
- **Draft banner:** solid `#FFF6E6`, 1px `#F3D7A8`. It shows a sand count tile, "2 suggested skills to review found in Lecture 4 notes" and "Review ›".
- **Review card** (one suggestion at a time): an editable name, topic, outcome and gate; ⓘ; progress dots; Discard and "Confirm · add a leaf". Confirming makes the new leaf sparkle on the grove.
- **Layout:** grid `minmax(170px,200px) | 1fr` under 1240px, and `minmax(220px,260px) | 1fr` above.
  - The left column is a compact vertical file list: a "FILES" eyebrow, then rows with a 34px pixel doc icon tile, the title (13/650, wraps) and "PDF · 3 skills" or "2 to review" in `#B5702A`.
- **Detail pane:**
  - Title (Pixelify 28, wraps), meta, download chips, Find skills.
  - Tabs: **Preview** (default), Skills (N), Text your tutor reads.
  - **Viewer:**
    - Toolbar: ‹ "Page 2 of 4" ›, zoom − 100% +, and "Ask about this page", which opens a new lesson with the question pre-filled.
    - A 104px thumbnail rail, hidden when the pane is under about 520px.
    - The page canvas fits the pane width, never below 0.6 scale. It scrolls horizontally instead of shrinking text.
    - Footer chips: "Skills from this page", which open the lesson. Drafts open review.
  - Per-type rendering: PDF page (Newsreader), 16:9 slide with a 12px `#2F7D9B` top rule, photo with grade stamp and grader's note, rendered markdown.

### Plan
- **Header row:** calendar icon, "This week" (nowrap), ⓘ, and on the right "Daily time" with a 15/30/45/60 min segmented control.
- **Sea scene** (canvas, 200px tall, radius 24, 4px cells):
  - sky bands, sun, clouds
  - sea bands `#9BD7EC → #2D88B6`, with moving wave glints
  - the 7 day columns align with the grid below
  - day 0 is a sailboat labelled "You · today"
  - days 1–5 are bobbing red and white buoys
  - the exam day is a rock island with a striped lighthouse, a lamp that breathes from deep to pale yellow, and a beam that fades in as it brightens
  - the whale swims from today toward the lighthouse, dives a little every 7 seconds and spouts as it surfaces
  - a plank sign reads "Midterm / Thu, Oct 29"
- **Proposal card:** `#EEF8FC`, 1px `#C7E5F2`.
  - Eyebrow "YOUR PLAN NEEDS A DECISION" in `#1F6E92`.
  - Headline in Pixelify 24 and a sentence.
  - Dashed "Defer · …" chips (nowrap).
  - Confirm changes (ocean primary) and Keep current plan.
- **Week grid:** `repeat(7, minmax(112px,1fr))`, gap 8, scrolls horizontally.
  - Day card: dow eyebrow, Pixelify 22 date, 6 load cells and "N of 30 min".
  - Today: `#F0F9FD` background with a 2px `#62BCE0` border.
  - Exam day: solid `#1E6F96`, white text, lighthouse icon, "Midterm", "Covers 5 skills".
  - Items have a type colour: Lesson sky `#E3EEF3`/`#2F7D9B`, Review neutral/green, Practice and Fresh-check sun `#FBF0D6`/`#E3A233`, Exam prep coral `#FBE6DC`/`#D9663A`.
  - Each item card has a 7px square and the title (wraps), then the meta on its own wrapping line. The next item has a 2px `#E3A233` border, done items are struck through, and to-be-deferred items have a dashed border.
- **Below the grid:** Exams (skill chips, + Add an exam) and "Doesn't fit this week".

### Settings (modal, radius 22, 660px)
- **Home view picker:** two tiles, Skill tree or Task list, with a pixel preview. This is the user-requested switch; tree is the default.
- **Tutor:** model radio cards (Gemini 3.8 Flash, the app default, and Gemini 3.8 Pro) and thinking-level pills (Low, Medium default, High).
- **Account:** "Signed in as …" and Sign out.

### Sign-in
- Left side: brand, "Your study space", the Pixelify 64 headline "A place for what you learn.", a sentence, "Sign in with Commons" (primary) and "Use your 6.1040 class account."
- Below that, a 3-step strip.
- Right side: a sky card `#D7E8F1` with a large pixel tree and the caption "Understanding takes root".

## Interactions and state
- **Animation:** each scene draws what stays still once, and its moving sprites (clouds, wave glints, the boat, the buoys, the whale, the flag and the lighthouse) move on eased Bézier loops, with each offset rounded to a whole device pixel so the edges stay crisp. This replaced an earlier 450ms tick that moved them in steps. The curves and durations are in `design/visual-design.md`, "Motion".
  - Respect `prefers-reduced-motion`: draw once and leave every sprite at rest.
  - Messages and cards rise in over 240ms (`translateY(8px)` → 0) on the entrance curve.
  - Toasts appear at bottom centre for about 2.6s, using `#1F3A2B` or dark.
- **Canvas sizing:** canvases measure their wrapper with ResizeObserver and redraw at integer cells × devicePixelRatio.
- **Hit-testing:** grove and forest hits are tested in cell space (nearest leaf within about 5 cells).
- **Tree generation:** trees are deterministic from the unit id plus a design seed. Persist the seed per course so the grove looks the same across devices.
- **Tasks rows** and nav items open the lesson for that skill.
- **Source links** (lesson citations, Taught from) open Materials, switch to the Preview tab and jump to the cited page or slide.
- **"Ask about this page"** opens the lesson with a draft question.
- **New state:**
  - `homeView` (tree or tasks; this is a user preference, so persist it with the tutor settings)
  - `groveDesign`
  - `forestOpen` and `forestTopic`
  - `matTab` (preview, skills or text), `matPage`, `matZoom`
  - `info` (the one open ⓘ)
- **Backend:** no new data is needed. Everything maps to the existing reads (`courses.read`, `learning.progress`, `learning.read`, `planning.read`) except per-page skill tags for "Skills from this page". Those can come from the existing citations and source references.

## Files
- `StillGotIt A5 - Pixel Nature.dc.html` is the full prototype. It is the source of truth for exact inline values.
- `pixel-art.js` holds the extracted palette, icons, sprites, whale, doc icon, `iconRects`, `stageOf`, `cellsOf`, `rng`, `hash` and `genTree`. You can port it directly to TypeScript.
- `fonts/` contains Pixelify Sans, Instrument Sans, Spline Sans Mono and Newsreader (all OFL; from WhaleLife `App/Resources/Fonts`).
- `reference/Current Home.dc.html` is a faithful recreation of today's Home, for before/after comparison.
- `support.js` is the runtime needed to open the `.dc.html` prototypes locally. It is not part of the implementation.
