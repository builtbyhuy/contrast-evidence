# Validation of v0.1.0

Historical baseline. [The v0.1.1 hardening record](hardening.md) documents subsequent regression fixes, the current test results and the narrower Chromium/shadow-root boundary.

Observed **9 October 2026**. Tests ran against the actual source and rendered interface, not a design reference screenshot. This document records the checked scope; it does not establish adoption or whole-site WCAG conformance.

## Local execution

Windows, Node **24.19.0**, Playwright **1.62.1**, installed Microsoft Edge **154.0.4258.62**.

- **40 automated tests passed**: standard contrast references, unrounded thresholds, PNG evidence, below-fold/fractional crops, pseudo backgrounds, preserved layout/styles, error paths, invalid inputs, report integrity and actual CLI behavior.
- **17 browser workflow checks passed**: controls, known 1:1 and 21:1 cases, normal/large text thresholds, reset, invalid color handling, image upload/rejection, JSON and HTML exports, keyboard adjustment, responsive behavior and no page JavaScript errors.
- Four of those browser checks ran axe at **1440, 768, 390 and 320 CSS px**, with **zero interface violations**. The deliberately adjustable text specimen (`#stage`) was excluded; it is measured by the playground and can intentionally need contrast review. Automated findings do not replace manual review.
- Actual desktop/mobile screenshots and the downloaded standalone report were opened and inspected. The HTML report opened offline with its images/font/OFL text and no HTTP requests.

## Independent consumer and failure review

A separate temporary consumer installed **six locked packages** with `npm ci`, without `NODE_PATH` or bundled module fallbacks. The package's named API import, actual browser capture, report generation and child CLI worked from that consumer.

Independent review reproduced misleading results from CSS reacting to the temporary style attribute and from an uninspected shadow host. Those defects were repaired before source publication. Fresh checks confirmed seven cases return `unsupported` and restore the selected element's original inline style: target `[style]` background, ancestor `:has()` background, sibling background, pseudo background, changed image source, shadow-host opacity and SVG text paint. Root additionally reproduced a zero-size owner's covering pseudo overlay; that case now rejects the capture and is retained as a regression test.

Report construction decodes the retained PNGs and recomputes the background contrast. Forged ratios/statuses, malformed images and inconsistent sample sizes are rejected. This checks data consistency; it cannot authenticate where an image came from or prevent somebody fabricating all inputs.

## Existing photo-based consumer

The public worked-example source in Web Reference Design was checked through the real CLI at **1440×900** and **390×844**. Its monochrome photo-label leaf produced minimum ratios **13.530801304736086** and **10.144463049499127**, with a **58×43 / 2,494-pixel** crop at each viewport. The tight-line-height main caption returned `unsupported` because its text extends beyond the element rectangle. These are observations of those captures, not universal values for the photograph or comparative performance gains.

## Boundaries

Only supported stationary, opaque, normal monochrome HTML text can produce a clear quickcheck. Complex effects, shadow-root/SVG text, colored emoji, ambiguous overlaps and paint changes require another method or manual review. Background images must be stationary; the DOM cannot reliably identify every animated raster. A low rectangle minimum remains a review flag because it may occur between letters. Firefox/WebKit have not been validated.

The first published source commit, `04e338bc36c12ba62772a16ab395fd8c02457122`, also passed the [Linux/Chromium CI run](https://github.com/builtbyhuy/contrast-evidence/actions/runs/37888276110). Its install, browser setup, automated tests and browser workflow checks were independently read as completed/success. [The Pages deployment](https://github.com/builtbyhuy/contrast-evidence/actions/runs/37888326142) completed successfully. Hosted-page behavior is checked separately from deployment status. Later live status remains visible in GitHub.

The [public playground](https://builtbyhuy.github.io/contrast-evidence/demo/) was opened in Chrome after deployment. Its narrow 340×454 preview measured 1.72:1 with the 12% overlay and requested review; the same crop/text measured 4.58:1 after the suggested 48% overlay and cleared the 3:1 quickcheck. Reset restored the default wide preview and 4.03:1 result. These measurements describe that controlled preview only.
