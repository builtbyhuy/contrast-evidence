---
name: contrast-evidence
description: Capture reproducible evidence for reviewing stationary text over photos or gradients when automated contrast checks need human review.
---

# Contrast Evidence

Use the capture API or CLI from this repository for a selected text element on a running page. This complements general accessibility checks; it does not certify the site or judge visual quality.

## Capture a real element

From the installed project:

```sh
npm install
npx playwright install chromium
node src/cli.js --url http://localhost:3000 --selector '.hero h1' --viewport 1440x900 --viewport 390x844 --out ./evidence
```

Reuse an existing compatible browser when available (`--browser msedge` or `--browser chrome`); browser installation is explicit. For an authenticated or already prepared page, import `captureContrast` and supply the existing Playwright page. Follow the user's page and viewport scope.

Read `report.json` and inspect `index.html`, including the original and background-only crops. Check that the text, crop and viewport match the intended element. The background capture suppresses text paint while preserving geometry; uncertain effects produce `unsupported`.

## Interpret results correctly

- `quickcheck-clear`: every captured background pixel in the sampled rectangle meets the supplied contrast threshold for the opaque CSS foreground under the supported method.
- `needs-review`: the conservative rectangle minimum is below the threshold. Inspect behind individual letters before establishing a WCAG failure. Bright space between letters can cause this status.
- `unsupported`: capture or rendering uncertainty prevents a reliable conclusion. Read the reasons; do not treat missing evidence as clear.

Do not round a ratio before comparing it with a threshold. Do not sample antialiased text pixels as the foreground color. Stationary, opaque, single-color text is the supported scope. Blends, filters, shadows, transformed or occluded text and dynamic backgrounds require another method or manual review.

After changing text/background styling, capture the same selector and viewports again. Report what the actual new evidence shows. A slider value, successful screenshot or passing general accessibility scan alone does not prove this contrast check.

Method: [W3C F83](https://www.w3.org/WAI/WCAG22/Techniques/failures/F83). Installation and API: [repository README](https://github.com/builtbyhuy/contrast-evidence#readme).
