# Red-team review of Contrast Evidence

Historical review of v0.1.0. The confirmed defects below were subsequently repaired in **v0.1.1**; see [the hardening record](hardening.md) for failing-before/passing-after checks, current scope and improvements. Original observations remain below for traceability.

Observed 9 October 2026. Baseline: `070c6adb9f386280b60589e0e94b939bd4e3f890`, the published v0.1.0 source. Review dimensions: correctness, rendered usability/accessibility, onboarding and practical community value. Application source was left unchanged; this review and its reproduction/evidence files are local additions.

**The presentation is coherent, but the tool is not yet reliable enough to serve as strong flagship evidence.** Three independent paint-admission gaps produce misleading clear results. The next work should secure that boundary and demonstrate a useful real-page review, before expanding features or promotion. Passing the existing tests does not refute executions outside those fixtures.

## Supported defects, ordered by impact

### P1 — Rendered text colors can differ from the foreground being evaluated

**Trigger:** ordinary opaque, monochrome, one-line text uses `#target::first-line { color: #ddd }` while the element itself has `color: black; background: white`. With 32px text, the tool reports black foreground, **21:1 / quickcheck-clear**. The actual authored foreground is `#ddd`, whose contrast against white is **1.3582472461753565:1**, below the selected 3:1 threshold. The misleading status also survives HTML report construction.

**Agreement broken:** metadata uses the element's computed style (`src/capture.js:86–90`), but text paint may come from text pseudos. Admission and scene comparison inspect `::before`/`::after`, not `::first-line`/`::first-letter` (`43`, `162–171`). Analysis then trusts that foreground (`241–245`; `src/contrast.js:39–52`).

**Refutation checked:** this first-line fixture really is one actual color, opaque normal HTML text; the mixed-descendant limitation does not exclude it. Exact style restoration and original/restored equality pass because the scene is stationary.

Partial active selection and CSS custom highlights expose a related omission. Highlight only the first character with gray-on-white styling: the capture returns **15.461102578439387:1 / clear**, while a highlighted glyph remains in the supposed background. Full selection was correctly rejected, but the equality guard at `capture.js:243` only catches complete non-removal. `::first-letter` was also reproduced by the capture reviewer.

**Minimal remedy:** reject differing foreground/font paint from text pseudos and intersecting active selection/highlight ranges until supported. Check complete text suppression; any pixel difference is insufficient. Add these as independent admission regressions. Do not infer nominal foreground from antialiased screenshot text.

### P1 — Numeric z-index comparison is not a stacking-context proof

**Trigger:** `.card > .wrapper > #target`, where `.wrapper { isolation:isolate }`, target has `position:relative; z-index:1`, and `.card::after` has `z-index:0` plus an 80% white overlay. The pseudo actually covers the text, yet capture returns **21:1 / clear**. The black foreground composited through that overlay is `#ccc`; its contrast on white is **1.6059285649300714:1**.

**Agreement broken:** `capture.js:96–104` searches for explicit active z-indices but skips other stacking-context creation. The descendant's `1` is consequently compared outside its real context. Ancestor pseudo admission accepts that incorrect ordering (`169–171`), then analysis uses an unaltered black foreground (`241–245`).

**Refutation checked:** remove isolation and the text is truly black with 21:1 contrast. An explicit wrapper `position:relative; z-index:0` correctly produces unsupported. The reviewer also reproduced the gap with `contain:paint`, `will-change:transform`, and sticky/fixed positioning with auto z-index; ancestor opacity was correctly rejected.

**Minimal remedy:** model the actual stacking-context chain, or reject unmodelled contexts before using a layer comparison to approve painted overlays. Test both covered and genuinely behind cases so safer admission does not silently destroy useful coverage.

### P1 — Shadow-tree overlays are invisible to scene inspection

**Trigger:** a normal light-DOM target is covered by a fixed 80% white overlay inside an open shadow root on an otherwise unpainted host. The capture again returns **21:1 / clear** for foreground effectively `#ccc` on white.

**Agreement broken:** overlap inspection and paint-state validation use `document.querySelectorAll('*')` (`capture.js:33`, `175`), which does not enumerate shadow children. The host is not classified as painting (`93–95`), so the covering child never participates. Downstream analysis accepts the composited crop with nominal black foreground (`241–245`).

**Refutation checked:** the existing shadow-root *target* refusal (`137`) does not apply to this light-DOM target. The stationary overlay passes restored-pixel equality; some text is removed, so the complete-occlusion guard does not reject it.

**Minimal remedy:** inspect accessible composed paint and fail closed where covering paint cannot be established. Closed shadow content remains an unresolved boundary; traversing open roots alone cannot justify a general guarantee for arbitrary pages.

### P2 — Overlapping captures on one Page contaminate the background

**Trigger:** capture the same target concurrently. Let both original screenshots finish; delay B's background screenshot until A has restored the text. Solo returns clear21; A returns clear21; B returns **needs-review1**, with original text in B's background image.

**Agreement broken:** B's masked-state check (`220–231`) precedes A's restoration (`234–239`). B's later screenshot no longer represents that validated state. Original/restored equality passes, and the no-removal guard (`243`) applies only to clear analyses.

**Refutation checked:** the probe controls screenshot completion order without author page mutations. The final style is still restored to `null`. README/API do not require exclusive Page ownership. This is a false review signal rather than the false-clear consequence above.

**Minimal remedy:** serialize captures per Page or reject overlapping operations explicitly. Document ownership, and test a controlled overlap rather than relying on usual timing.

### P2 — Startup can replace a completed user upload

**Trigger:** delay the bundled JPEG, upload a valid local PNG, then let the JPEG finish. The preview and JSON use `repair-workshop.jpg`; the status still says the user's PNG loaded. Reproduced locally, independently by root, and on the live site with delayed requests.

**Agreement broken:** upload commits image/source at `demo/app.js:315–320`; startup later overwrites those values unconditionally at `391–396`. The upload generation protects upload-vs-upload/reset, but not initialization-vs-upload.

**Minimal remedy:** guard the bundled-image commit against newer user state. Preserve loaded example assets for Reset without applying them over a completed upload. Verify preview, attribution, status and export identify the same image.

### P2 — One transient font request failure prevents export retries

**Trigger:** abort the first report-font fetch, restore access and retry HTML export. Both attempts show `Failed to fetch`; only one font request occurs. Reproduced locally, independently by root, and on the live site.

**Agreement broken:** `demo/app.js:349–354` caches a rejected `fontDataPromise`; the retry handler (`374–385`) reuses it forever. Network recovery cannot repair that state. A full reload works but does not provide a functioning retry.

**Minimal remedy:** discard a rejected font promise and offer a contextual retry/JSON alternative. Test failure followed by recovery.

### P3 — Rerender permits duplicate HTML exports during preparation

**Trigger:** hold report-font response, start export, change the text, and click the re-enabled button. Two files download, one containing old text and one containing new text, while the UI had said it was preparing one report. Browser reviewer and root verified both file contents.

**Agreement broken:** `demo/app.js:177–178` unconditionally enables export during rerender, overriding the pending handler's disabled state at `379`. Each handler owns a different snapshot but shares the same busy/message state.

**Minimal remedy:** keep operation state separate from evidence validity, and maintain one active HTML export until it settles. Retain the explicit snapshot semantics.

### P3 — Report rechecks ratio but trusts inconsistent worst-pixel metadata

**Trigger:** change only a valid capture's worst pixel to `{x:999999, y:-42, color:[255,0,0]}`. Report construction/rendering accept and display it beside a white PNG and a recomputed 21:1 ratio.

**Agreement broken:** `src/report.js:64–67` recomputes the analysis but does not reconcile its worst pixel. Rendering trusts the supplied coordinates/color (`106`, `112–118`). The lack of provenance authentication does not explain inconsistency derivable from the retained PNG itself.

**Minimal remedy:** derive worst-pixel metadata from the already-recomputed analysis, or validate that its location/color realizes the minimum, allowing legitimate tied minima. This defect primarily affects supplied/deserialized API records, not an unmodified capture result.

## Practical improvements beyond bug fixes

1. **Complete the real review handoff.** The real-page HTML says “Inspect the marked backgrounds” (`src/report.js:132`) but shows unmarked crops and coordinates (`93–118`). Add a correctly scaled marker, synchronized original/background views and useful zoom. Retain original text paint for comparison. [W3C F83](https://www.w3.org/WAI/WCAG22/Techniques/failures/F83) requires letter-level inspection when its conservative quickcheck is insufficient; a rectangle flag is only the start of that work.
2. **Bridge the playground to checking a real page.** Add a direct “Check your page” path and one reproducible example: two widths → capture → inspect → CSS adjustment → recapture → before/after evidence. The current export is accurately labelled a preview snapshot, but the demo does not demonstrate that complete developer workflow.
3. **Measure useful coverage before advertising broadly.** Nested spans, tight line-height, transforms and any running document animation cause refusal. These can be reasonable guardrails, but their cost is unmeasured. The existing validation's main photo caption was unsupported; its successful leaf was only 58×43 pixels. Test ten preselected real components without modifying their CSS to accommodate the tool. If fewer than half yield useful evidence, narrow the advertised niche or address the most frequent refusal. This is a proposed decision rule, not an observed rate.
4. **Position around evidence rather than DOM awareness.** [Kontrasto already accepts a DOM text element and analyzes the image region at its final position](https://github.com/thibaudcolas/kontrasto#usage-in-javascript). Retained original/background captures and a useful portable review are the stronger distinction. Correct the research citation: axe's image/gradient/pseudo incomplete reasons live in [the check configuration](https://github.com/dequelabs/axe-core/blob/develop/lib/checks/color/color-contrast.json), not the linked rule metadata.
5. **Prove the extra step is worth taking.** Compare normal reviewer workflow and this tool on six predetermined cases with two independent reviewers, counterbalancing order. Record correctness, unresolved cases, time and handoff clarity. Include weak pixels between letters. If no useful advantage appears at equal correctness, focus the project on evidence attachments rather than expanding general utility claims. Three developers attempting their own-page report from public entry points within 20 minutes would also reveal onboarding problems; do not present those proposed trials as completed user research.

## Evidence, reproduction and what held up

Root reproduced the three P1 families through a fresh external consumer installed with `npm install github:builtbyhuy/contrast-evidence`; installation and named imports worked. Root then ran the portable script below against the baseline, reproducing partial selection, concurrency, upload replacement, export retry, duplicate export and inconsistent pixel metadata. Additional variants were executed by the scoped browser/capture reviewers. Reviewers used the inherited root model; this was division of coverage, not a cross-model evaluation.

Environment: Windows, Node24.19.0, Playwright1.62.1, installed Edge154.0.4258.62. Synthetic fixtures are deliberate reproductions, not customer pages or observed adoption. Live UI code was checked against local source and the two UI failures repeated live.

The [portable reproduction](red-team/reproduce.mjs) targets the historical baseline. To repeat the original failures, copy it into `docs/red-team/` in a separate checkout of `070c6adb9f386280b60589e0e94b939bd4e3f890`, then run from that checkout with an already installed browser. Current regression tests verify the repaired behavior.

```sh
CONTRAST_BROWSER=msedge node docs/red-team/reproduce.mjs --out /path/to/temporary-evidence
```

On PowerShell set `$env:CONTRAST_BROWSER = 'msedge'` before the Node invocation. Default browser is Playwright Chromium; nothing is downloaded. The script prints observed findings and exits normally when it completes; completion is not a quality pass. [Retained results](red-team/results.json) and [the rendered misleading report](red-team/misleading-clear-report.png) record this review. Its foreground contrast uses known authored colors/compositing, not antialias-based color inference.

What held up in the examined cases: exact inline-style restoration, masking-dependent CSS checks, full-precision math, ordinary below-fold/horizontal crops, basic installation, keyboard upload/focus, invalid-color recovery, Reset cancellation of pending uploads, and fitting localized text/portable exports. Full selection/highlights were rejected. Existing safeguards remain worth preserving.

No blanket security, accessibility, performance or browser-conformance conclusion was made. Firefox/WebKit, closed shadow paint, real-user efficiency, adoption and reputation gains were unverified in this review. Native browser zoom was not directly exercised; CSS zoom was excluded as equivalent evidence. This is a historical baseline; the subsequent repairs are recorded separately in [v0.1.1 hardening](hardening.md).
