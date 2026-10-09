# Why this tool

Research observed on **9 October 2026**. The original contribution is a focused reviewer handoff for DOM-known text over rendered backgrounds, with conservative status labels. This is a product hypothesis supported by documented limitations, not evidence of adoption or universal uniqueness.

## The specific gap

[Axe issue #4628](https://github.com/dequelabs/axe-core/issues/4628) requests contrast support for simple gradients. The current [color-contrast check configuration](https://github.com/dequelabs/axe-core/blob/develop/lib/checks/color/color-contrast.json) includes image, gradient and pseudo-content incomplete reasons. [Issue #5413](https://github.com/dequelabs/axe-core/issues/5413) concerns confusing incomplete reasons. These are reports and upstream implementation evidence; they are not defects independently reproduced in every axe version.

[W3C F83](https://www.w3.org/WAI/WCAG22/Techniques/failures/F83) describes a worst-background quickcheck for text over an image. If the quickcheck is insufficient, inspect the background behind individual letters before establishing a failure. [Understanding Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) explains foreground colors, large text, thresholds and why antialiased screenshot text is unsuitable for this calculation. This tool extends the same conservative rectangle check to captured stationary gradients.

## Alternatives considered

| Existing tool | Existing strength | This project's focus |
| --- | --- | --- |
| [axe with Playwright](https://playwright.dev/docs/accessibility-testing) | Broad automated accessibility checks | Evidence for a selected background contrast review; complements axe |
| [Kontrasto](https://github.com/thibaudcolas/kontrasto#usage-in-javascript) | Image analysis, text styling and DOM-aware image region selection | Retained original/background captures, responsive evidence and portable reviewer handoff |
| [EA Fonttik](https://github.com/electronicarts/fonttik) | Image/video text detection and readability analysis | DOM-known text with no OCR or model API |
| [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer) | Actions, DOM snapshots, screenshots and logs | Small contrast-specific report and foreground/background evidence |

A general reference directory, another screenshot-to-code tool, a universal aesthetic score and a general skill evaluator were rejected as the flagship. Established tools already cover those broad jobs. This repo keeps a concrete user decision: which text/background combination needs closer review, and what captured evidence supports it?

## Foundation selection

GitHub API observations at 2026-10-09 04:39 UTC: [Playwright](https://github.com/microsoft/playwright) **97,331 stars**, Apache-2.0; [axe-core](https://github.com/dequelabs/axe-core) **7,616 stars**, MPL-2.0. Both were unarchived and maintained. Stars describe repository popularity, not correctness of this tool. Contrast Evidence uses Playwright and pngjs; axe is only used for development checks. No upstream accessibility engine is copied.

## What would validate community value

An independent developer successfully using a capture to resolve a real review, understandable installation, reproducible reports and useful bug reports. Local tests establish mechanics and boundaries. They do not establish community demand, expert accessibility certification, reputation gains or revenue.
