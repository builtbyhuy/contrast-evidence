# Check a real page, change it, and capture it again

The included [photo-hero source](../examples/hero/index.html) demonstrates a common review problem: a desktop overlay treatment is strong enough, while the narrow layout uses a faint overlay over a different image crop. Run it locally using the steps below. This is an illustrative page, not a customer case or a complete accessibility audit.

## 1. Open the page

Complete the [repository setup](../README.md#check-your-own-page), then start the local server in one terminal:

```sh
npm run demo
```

Open `http://127.0.0.1:4173/examples/hero/`. Resize the page to compare the two compositions. The heading is ordinary white HTML text, selected by `.hero h1`; the photo and overlay are CSS backgrounds.

## 2. Capture both viewports

In another terminal, from the repository directory:

```sh
node src/cli.js --url http://127.0.0.1:4173/examples/hero/ --selector ".hero h1" --browser msedge --viewport 1440x900 --viewport 390x844 --out ./evidence-before
```

This command uses an existing Microsoft Edge browser. Use `--browser chrome` for an installed Chrome, or omit `--browser` for the compatible Chromium you explicitly installed during setup. The tool does not download or substitute a browser automatically.

Open `evidence-before/index.html`. Confirm the heading, crop and viewport, then compare the original and text-hidden background. The minimum may fall between letters: **`needs-review` asks for inspection; it does not establish a WCAG failure.** Inspect the photo directly behind the letters before recording a failure. [W3C F83 describes this two-step procedure](https://www.w3.org/WAI/WCAG22/Techniques/failures/F83).

## 3. Apply the page's actual fix

Open `http://127.0.0.1:4173/examples/hero/?fixed=1`, or use the link below the example. This replaces both overlay treatments with one uniform dark layer at 68% opacity. The photo, crop rules, heading, font sizes and geometry remain the same.

Capture the same selector and viewports again:

```sh
node src/cli.js --url "http://127.0.0.1:4173/examples/hero/?fixed=1" --selector ".hero h1" --browser msedge --viewport 1440x900 --viewport 390x844 --out ./evidence-after
```

Open `evidence-after/index.html` beside the first report. Retain both reports with the change so another reviewer can inspect the actual before/after states.

## Observed results

Checked on **9 October 2026**, using Windows, Node 24.19.0 and Chrome 154.0.8037.98. The heading is 64px/700 at 1440×900 and 40px/700 at 390×844; both use the large-text **3:1** threshold.

| State | Viewport | Minimum ratio, unrounded | Result |
| --- | --- | --- | --- |
| Before | 1440×900 | 7.15238257598946:1 | `quickcheck-clear` |
| Before | 390×844 | 1.4574209811667906:1 | `needs-review` |
| After | 1440×900 | 8.232778443506616:1 | `quickcheck-clear` |
| After | 390×844 | 7.596001647536648:1 | `quickcheck-clear` |

The real CLI returned exit **1** before and **0** after. The heading bounds and sampled pixel counts were unchanged by the fix: 89,640 pixels at desktop width and 31,408 at narrow width. Both page states were rendered and inspected at both sizes, with no page JavaScript errors or horizontal overflow.

These measurements describe the recorded captures. Browser rendering, different viewports or changes to the page can produce different values. A clear result covers this heading's supported captured state; other text and interaction states still need review. The example does not measure saved reviewer time, community adoption or overall WCAG conformance.

## Use the same process on your page

Replace the URL and selector with your running page and a single text element. Choose viewports relevant to its actual users. If the tool returns `unsupported`, read its reasons and inspect manually; changing the page just to obtain a green label is not a contrast review. For authenticated or prepared pages, use the [capture API with your existing Playwright page](../README.md#check-your-own-page).

Reports retain page text, URLs and images. Review them for private material before sharing. The [photo and font credits](../demo/assets/CREDITS.md) remain part of this example's source.
