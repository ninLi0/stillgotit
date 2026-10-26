# Visual design study

The app's look is called Pixel Nature. It started with Terraria and Stardew Valley: I thought of their pixel-art interfaces and asked, "what if I make the UI pixelated like a game?" I worked the idea out with a design tool, and the result is recorded in the [design handoff](revamp/README.md), which sets the palette, the type, the pixel-art rules, and the layout of each screen.

The study has two slides, one for typography and one for color. Each slide is a collage of the app's own type or colors, set in the app's own font files, with my notes in the margin. The two games are named as inspiration only; no game artwork appears on the slides.

![Typography study: Pixelify Sans for headings, Instrument Sans for sentences, buttons and numbers, Spline Sans Mono for code and maths, and Newsreader for a course file's text page](visual-study/typography.svg)

![Color study: a white ground, ink neutrals, the meadow, ocean, sand and dawn biomes, coral for what needs attention, and mastery as cells and a number](visual-study/color.svg)

## Where each choice is used

The main colors and the font names are tokens at the top of [frontend/src/style.css](../frontend/src/style.css). [frontend/src/fonts.css](../frontend/src/fonts.css) declares the four typefaces, and the server sends their files from `/fonts`.

### Typography

- **Pixelify Sans carries the headings.** It is used for page and section titles, eyebrows (the small uppercase labels above a heading), the brand, and big dates. It is set only at whole-pixel sizes, so its square letters stay crisp:
  - 64 px for the sign-in headline, "A place for what you learn.", and 40 px for the next sign-in steps, such as "Choose your username."
  - 34 px for the lesson's welcome heading, 28 px for a file's title in Materials, and 26 px for the lesson title and the Settings title.
  - 24 px for the title on the Home scene card and the planner's trade-off headline.
  - 22 px for section titles, such as "Materials", "This week" on Plan, "Course forest", and the Manage skills heading.
  - 20 px for the brand in the sidebar and for each day's date on the Plan sea calendar.
  - 13 px for the plank signs under the grove's trees and over the exam flag on Home's scene card, and 11 px for eyebrows, such as "FRIDAY, OCTOBER 23 · NEXT UP · 12 MIN" on the scene card.
- **Instrument Sans carries everything a learner reads at length or presses.** Body text is 15 px, buttons are 14 or 15 px at weight 700, and the sidebar's navigation rows are 15 px. Big percentages are 30 to 34 px at weight 700 with −1 px letter spacing: the selected skill's estimate on Home, the course average in the Forest view, and "Your mastery" in the lesson's rail.
- **Numbers use tabular figures.** `font-variant-numeric: tabular-nums` is set on the whole page, so every digit has the same width. Percentages line up in the Tasks list, on the grove's plank signs ("5 skills · 58%"), in the Forest view's topic list, and in the evidence timeline.
- **Spline Sans Mono is for code and maths.** The tutor's code and maths blocks in the lesson are 13 px. In the Materials viewer, code files, notebook cells, spreadsheet sheets, and code in Markdown are 13 px, and the "Readable text" tab is 12 px.
- **Newsreader is used on one page only.** When the Materials viewer cannot draw a PDF page, it shows that page's readable text on a white page set in Newsreader at 15 px, so it still reads like a printed page.
- **Ligatures are off everywhere.** Pixelify Sans joins "fi" into one glyph that reads like an "A", so `style.css` turns ligatures off for every element.

### Color

- **A white ground and ink text.** The page, cards, and dialogs are white (`#FFFFFF`). Headings and main text are ink (`#151515`). Longer paragraphs, such as the sign-in introduction and rendered Markdown, are soft (`#4A4A48`). Hints and captions are muted (`#5F5F5C`), and eyebrows and form-field outlines are faint (`#6F6F6C`). Code blocks, the sign-in steps, and other fills use inset (`#F5F5F3`).
- **One biome per screen.** Each screen has one color family. Its primary buttons use the family's main color with its dark text and a 3 px edge below in the edge color. Its secondary buttons and chips use the soft color, and the selected row in the sidebar is a capsule in the family's light tint.

  | Biome | Screen | Primary | Text | Edge | Soft | Used for |
  | --- | --- | --- | --- | --- | --- | --- |
  | Meadow | Home, the Forest view, sign-in, Settings | `#8FD3A6` | `#0E3A22` | `#55AE77` | `#E7F6EC` | Start review on the scene card, Open lesson, Back to desk, Sign in with Commons, the chosen Home view tile in Settings |
  | Ocean | Plan | `#86CDE9` | `#08344D` | `#43A2CB` | `#E2F3FA` | Start review and Finish review, Confirm changes on a trade-off, Save exam, Update plan |
  | Sand | Materials | `#F5C98E` | `#4A2A08` | `#D5964B` | `#FCEFD9` | + Add material, Confirm · add a leaf, Find skills, Import graded work, the buttons in Manage skills |
  | Dawn | The lesson | `#B9B0F5` | `#21185A` | `#8A7EE0` | `#EEEBFF` | Check my understanding, Assess, Save adjustment, the learner's own messages |

- **Coral marks what needs attention now.** Coral (`#D9663A`) fills the sidebar's badge on Materials, which counts the suggested skills waiting for review, and the flag planted beside a leaf that is due today. Its wash and text (`#FBE6DC` and `#A8412F`) form the Due today pill in the Tasks list and every error message, and the wash marks exam preparation in the Plan calendar.
- **Three more colors mark states.** Green (`#2F8A5F`) marks success: saved notices, the Strong pill, and finished items. A sun-yellow wash marks the New pill and practice items in the plan, and a sky wash marks the Review pill and lessons in the plan.
- **Mastery is cells and a number, never a smooth bar.** `MasteryCells.vue` draws square cells with 2 px gaps, `#4A775A` when filled and `#E6E6E2` when empty, always beside a number. Home's skill card and the lesson's rail use 10 cells, each row of the Tasks list uses 10 short cells, and the Forest view uses 20 for the whole course. The Plan calendar uses 6 cells in its own blue (`#1E6F96` on `#CFE7F2`) for the minutes planned each day, and the sidebar's Today card uses 15 sun-yellow cells for the minutes studied today.

### Pixel art

- **Icons and sprites are letter grids.** [frontend/src/pixel-art.ts](../frontend/src/pixel-art.ts) holds 12×12 icons and 7×7 sprites, each letter naming one palette color. `PixelIcon.vue` draws them as SVG rectangles with crisp edges. The icons are the sidebar's navigation icons (home, calendar, school for Materials, and tree for the Forest view), the leaf brand mark, the sun on the Today card, the ⓘ button, the lighthouse on an exam day, and the file icons in Materials, whose bottom band is coral for a PDF, yellow for slides, green for an image, and blue for Markdown.
- **A skill's leaf shows its growth stage.** The sprites are a bud (no estimate yet), a sprout (under 35%), a leaf (35% to 64%), a full leaf (65% to 79%), and a bloom (80% and up). They appear on the grove, in the Tasks list, in the Forest view, in the grove's legend, and in the sample grove on the sign-in page.
- **Scenes are drawn in whole cells.** Each scene is a canvas of 4 px cells (5 px in the Forest view, and 2 px in the small grove on the sign-in page), scaled by the screen's pixel ratio with smoothing off:
  - Home's scene card has sky bands, hills, and a sand path with one post per day leading to the exam's flag. The sun's position follows today's study minutes.
  - The grove on Home has one seeded tree per topic, with a plank sign under each tree that names the topic and gives its skill count and average.
  - The Forest view has mountains, pines, a winding path, and one large tree per topic with a signpost, plus a flower at a tree's foot for each mastered skill.
  - The Plan screen's sea calendar is one picture of the week. Each day is a column of the water, with its date on a sand plank, its boat, buoy, or lighthouse at the horizon, and its activities floating on the water. A whale, taken from the handoff, swims from today toward the exam's lighthouse.
  - The sign-in page shows a sample grove with topic signs and a legend of the leaf stages.
- **There are no gradients.** Skies and seas are solid bands of color. Depth comes from the 3 px solid edge under primary buttons (`box-shadow: 0 3px 0` with the edge color), which shrinks to 1 px when the button is pressed.

### The lesson's conversation

- **Tabs name each conversation.** Above the thread, each tab shows the conversation's kind and number ("Lesson 2", "Practice 1"), the day it started, and how many turns it has, such as "Oct 25 · 4 turns", with ✓ once it is assessed.
- **The opening is a card.** The tutor's lesson, or the practice task, sits in a white card with a ring, below the learner's request. A rule labelled "Conversation", in the eyebrow style, separates it from the dialogue that follows.
- **The learner's messages are bubbles; the tutor's replies are not.** The learner's messages are compact dawn bubbles (`#EEEBFF`) on the right, at most 70% of the thread's width (85% on phones). The tutor's replies run the full width without a bubble: a first line with the leaf in a small dawn tile and "StillGotIt", then the reply at 15 px with a 1.8 line height, and code and maths in mono blocks.
- **Each reply ends with one meta line and small actions.** The meta line is 11 px in faint text: how long the answer took, how many sources it cites, and the model and thinking level when the page saw the answer arrive, such as "Answered in 7 s · 2 sources · Gemini 3.8 Flash · Medium thinking". Copy and Listen sit at the right of that line. They appear when the pointer is over the reply or focus is inside it, and they always show under the latest reply and on touch screens. When a lesson question has no reply, "Retry tutor reply" sits in the tutor's place.
- **A message's time is in its tooltip.** Hovering a message shows when it was saved, such as "Oct 25, 3:04 PM". Screen readers hear the same time after the speaker's name.
- **The thread stays where the learner is reading.** New messages scroll the thread to the latest one. When the learner has scrolled more than one screen up, a white "Jump to latest ↓" pill appears over the bottom of the thread instead.
- **The message box grows with its text.** It starts at two lines and grows to six; longer text scrolls inside it. Enter sends, and Shift+Enter starts a new line.
- **Assessment cards show the change in mastery.** Beside the result, "Mastery" heads the estimate before and after the attempt, such as "50% → 95%", with the change in points below. An attempt that did not count says "Did not change the estimate" and gives the reason.

### Motion

- A 450 ms tick moves the clouds and the exam flag on Home, the clouds in the Forest view, and the boat, buoys, whale, and lighthouse lamp on Plan.
- Cards and messages rise 8 px into place over 240 ms, file cards appear over 180 ms, and notices and errors fade in over 220 ms. While the tutor answers, three dots pulse in the tutor's place below the learner's message, next to the seconds waited ("12 s"). Copy and Listen fade in under a reply over 120 ms.
- When the device asks for reduced motion, every animation and transition is turned off, and the scenes are drawn once.

### Contrast

Text should reach 4.5:1 against its background, and outlines and cells that carry meaning should reach 3:1. These are the ratios for the main text and button pairs:

| Pair | Where | Ratio |
| --- | --- | --- |
| Ink `#151515` on white | Headings and main text | 18.26:1 |
| Soft `#4A4A48` on white | Paragraphs | 8.88:1 |
| Muted `#5F5F5C` on white | Hints and captions | 6.41:1 |
| Muted `#5F5F5C` on inset `#F5F5F3` | Text inside the sign-in steps | 5.87:1 |
| Faint `#6F6F6C` on white | Eyebrows | 5.04:1 |
| `#3F7A55` on white | The eyebrow on Home's scene card | 5.09:1 |
| Ink `#151515` on a plank `#E9D6A8` | Topic names on the grove | 12.74:1 |
| Soft `#4A4A48` on a plank `#E9D6A8` | "5 skills · 58%" on the grove | 6.20:1 |
| White on `#1C1C1D` | The ⓘ bubbles and disabled-button reasons | 17.03:1 |
| Meadow text `#0E3A22` on `#8FD3A6` | Meadow primary buttons | 7.31:1 |
| Ocean text `#08344D` on `#86CDE9` | Ocean primary buttons | 7.41:1 |
| Sand text `#4A2A08` on `#F5C98E` | Sand primary buttons | 8.38:1 |
| Dawn text `#21185A` on `#B9B0F5` | Dawn primary buttons | 7.89:1 |
| `#1C5A37` on `#E7F6EC` | Meadow secondary buttons | 7.32:1 |
| `#0D4F70` on `#E2F3FA` | Ocean secondary buttons | 7.78:1 |
| `#7A4A12` on `#FCEFD9` | Sand secondary buttons | 6.57:1 |
| `#3B2F8F` on `#EEEBFF` | Dawn secondary buttons | 9.03:1 |
| Ink on the sidebar capsules `#C6EAD1`, `#C3E6F4`, `#FADFB5` | The selected row in the sidebar | 13.99:1, 13.87:1, 14.16:1 |
| White on `#1E6F96` | The exam day's plank on Plan | 5.57:1 |
| `#A8412F` on `#FBE6DC` | Error messages and the Due today pill | 5.04:1 |
| `#8A5A12` on `#FBF0D6` | The New pill | 5.22:1 |
| `#2A6B85` on `#E3EEF3` | The Review pill | 5.03:1 |
| Green `#2F8A5F` on white | Saved notices, such as "Skill confirmed." | 4.27:1 |
| Green `#2F8A5F` on `#EEF7F1` | The Strong pill | 3.90:1 |
| Green `#2F8A5F` on `#E7F6EC` | The "App default" tag in Settings | 3.82:1 |
| White on coral `#D9663A`, and coral on white | The sidebar's Materials badge, on an unselected and a selected row | 3.55:1 |
| `#B5702A` on white | "N to review" in the Materials file list | 3.95:1 |
| `#7A7397` on white | Eyebrows in the lesson's rail | 4.44:1 |
| Filled cell `#4A775A` against empty `#E6E6E2` | Mastery cells (3:1 needed) | 4.12:1 |
| `#1E6F96` against `#CFE7F2` | Plan load cells (3:1 needed) | 4.34:1 |
| Faint `#6F6F6C` on white | Form-field outlines (3:1 needed) | 5.04:1 |

Every text pair passes except the six rows from the green on white to the eyebrows in the lesson's rail. All six are small text, from 11 to 14 px, so they need 4.5:1.

<details>
<summary>How the ratios were computed</summary>

Each ratio is (L1 + 0.05) / (L2 + 0.05), where L1 is the relative luminance of the lighter color and L2 that of the darker one (WCAG 2.2). For each of R, G, and B, take v = channel / 255, and use v / 12.92 when v ≤ 0.04045, or ((v + 0.055) / 1.055)^2.4 otherwise. Then L = 0.2126 R + 0.7152 G + 0.0722 B.

For example, ink `#151515` has v = 21 / 255 = 0.0824 in each channel, so each channel is ((0.0824 + 0.055) / 1.055)^2.4 = 0.0075, and L = 0.0075. Against white (L = 1), the ratio is 1.05 / 0.0575 = 18.26.

| Color | L | Color | L | Color | L |
| --- | --- | --- | --- | --- | --- |
| `#FFFFFF` | 1.0000 | `#86CDE9` | 0.5461 | `#FBE6DC` | 0.8227 |
| `#151515` | 0.0075 | `#08344D` | 0.0304 | `#A8412F` | 0.1231 |
| `#4A4A48` | 0.0682 | `#F5C98E` | 0.6314 | `#FBF0D6` | 0.8768 |
| `#5F5F5C` | 0.1139 | `#4A2A08` | 0.0313 | `#8A5A12` | 0.1276 |
| `#6F6F6C` | 0.1583 | `#B9B0F5` | 0.4796 | `#E3EEF3` | 0.8395 |
| `#F5F5F3` | 0.9119 | `#21185A` | 0.0171 | `#2A6B85` | 0.1270 |
| `#3F7A55` | 0.1563 | `#E7F6EC` | 0.8896 | `#2F8A5F` | 0.1961 |
| `#E9D6A8` | 0.6824 | `#1C5A37` | 0.0784 | `#EEF7F1` | 0.9105 |
| `#1C1C1D` | 0.0117 | `#E2F3FA` | 0.8717 | `#D9663A` | 0.2456 |
| `#8FD3A6` | 0.5518 | `#0D4F70` | 0.0685 | `#B5702A` | 0.2158 |
| `#0E3A22` | 0.0323 | `#FCEFD9` | 0.8744 | `#7A7397` | 0.1863 |
| `#C6EAD1` | 0.7545 | `#7A4A12` | 0.0908 | `#4A775A` | 0.1539 |
| `#C3E6F4` | 0.7473 | `#EEEBFF` | 0.8481 | `#E6E6E2` | 0.7891 |
| `#FADFB5` | 0.7644 | `#3B2F8F` | 0.0495 | `#1E6F96` | 0.1385 |
| | | | | `#CFE7F2` | 0.7683 |

</details>

## Sources

- **The design handoff.** [design/revamp/README.md](revamp/README.md) records the Pixel Nature look, with the clickable prototype `StillGotIt A5 - Pixel Nature.dc.html` and the pixel-art data in `pixel-art.js`. The handoff says its type and pixel palette come from the WhaleLife app's theme files, and the Plan sea's whale is WhaleLife's.
- **The fonts.** All four typefaces are Google Fonts families under the [SIL Open Font License 1.1](https://scripts.sil.org/OFL), which allows them to be bundled with the app and embedded in the slides. The files in `frontend/public/fonts` carry these notices:
  - Pixelify Sans: Copyright 2021 The Pixelify Sans Project Authors (https://github.com/eifetx/Pixelify-Sans).
  - Instrument Sans: Copyright 2022 The Instrument Sans Project Authors (https://github.com/Instrument/instrument-sans).
  - Spline Sans Mono: Copyright 2022 The Spline Sans Mono Project Authors (https://github.com/SorkinType/SplineSansMono).
  - Newsreader: Copyright 2020 The Newsreader Project Authors (http://github.com/productiontype/Newsreader).
- **The slides.** Pixelify Sans and Instrument Sans are embedded in each slide. The Spline Sans Mono and Newsreader samples are drawn as outlines taken from the app's own font files. The sprites, icons, and colors come from the app's code.
- **The starting point.** Terraria (Re-Logic) and Stardew Valley (ConcernedApe) are named as inspiration only. No artwork or screenshot from either game appears on the slides.
