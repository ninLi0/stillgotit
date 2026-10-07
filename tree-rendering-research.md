# Drawing a skill tree from course data

Use SVG to draw a tree with curved branches and selectable leaves. Each leaf represents one skill. Use black, white, and gray. Highlight the selected leaf and show its details in a separate panel.

## Keep three parts separate

| Part | Data |
| --- | --- |
| Learning records | Courses, units, skills, sources, prerequisites, and mastery evidence. |
| Layout records | The course seed, drawing-rule version, branch assignments, and saved leaf positions. |
| Drawing rules | Branch curves, leaf shapes, labels, selection, and zoom. |

A new document can add a skill or attach to an existing skill. It should not require new artwork. A score change updates the label or appearance. It does not move or remove the leaf.

Branches show course units. Store prerequisites separately because a skill can depend on several skills across units.

## Preserve positions as the tree grows

Give each skill a stable identity and save its leaf position. A fixed random seed alone does not preserve positions when the input changes.

Use free positions for new skills. When a branch fills, use a labeled group that expands on selection, or expand that branch deliberately. An unlabeled group must not look like one skill. Test large and uneven courses before choosing a general layout rule.

The overview shows the tree and unit names. A focused branch shows skill labels. A selected leaf opens evidence and practice options. Keep a keyboard-accessible skill menu for small screens and users who prefer a list. Respect reduced-motion settings.

## Tools and references

| Tool or method | Use |
| --- | --- |
| [SVG paths](https://developer.mozilla.org/en-US/docs/Web/SVG/Tutorials/SVG_from_scratch/Paths) | Draw branches with cubic or quadratic curves. Use custom shapes for the tree outline. |
| [D3 hierarchy](https://d3js.org/d3-hierarchy/tree) and [zoom](https://d3js.org/d3-zoom) | Calculate positions and control the view. A standard hierarchy layout still needs custom branch drawing. |
| [Space colonization](https://www.algorithmicbotany.org/papers/colonization.egwnp2007.html) | Provides a method for natural branch growth. Consider it later if the simple layout is insufficient. |
| [ELK layout constraints](https://eclipse.dev/elk/blog/posts/2023/23-01-09-constraining-the-model.html) | May help with complex position constraints. The initial tree does not need this machinery. |

Start with SVG and ordinary HTML controls. Add D3 zoom if gesture handling needs it. Measure performance before moving to Canvas or WebGL.

## Prototype results and limits

The prototype uses a five-branch template and a custom view transition. It does not use D3 yet. In two sample courses, skill counts grew from 15 to 30 without moving existing leaves. Selection, unit focus, keyboard access, dark mode, and a 320-pixel view were checked. No browser errors or horizontal overflow were observed.

This prototype tests navigation and a limited growth rule. It does not implement course import, tutoring, assessment, or saved learning records. Arbitrary unit counts and crowded branches still need testing. The first app version supports one course per learner.
