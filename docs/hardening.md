# v0.1.1: fixes and a complete review workflow

Checked on 9 October 2026 against the v0.1.0 baseline `070c6adb9f386280b60589e0e94b939bd4e3f890`. The [red-team review](red-team.md) records the original failures. This release repairs those defects and adds a runnable page-to-report workflow.

## Test-first repairs

Each behavioral repair started with a real failing regression before the corresponding production change. Existing source was preserved. Network responses and capture scheduling were controlled only to make the real browser failure repeatable; actual rendering, pixels, exports and persisted files were exercised.

| Flow | Confirmed problem | New behavior |
| --- | --- | --- |
| Foreground paint | Text pseudos and partial selections/highlights could falsely clear | Differing text-pseudo paint and intersecting live/static highlights return unsupported |
| Overlay order | Implicit stacking contexts allowed the wrong behind-text proof | Context boundaries constrain descendant z-index comparisons |
| Shadow paint | Open/closed shadow overlays were invisible to ordinary DOM enumeration | Chromium CDP inspects author roots; any author shadow root makes capture unsupported |
| Capture ownership | Concurrent calls could retain text in a background PNG | A second call on the same Page is rejected before mutation |
| Capture freshness | Initial foreground metadata could differ from settled captured paint | Metadata is reconciled at the first paint observation; changed state is rejected |
| Captured text | BR boundaries concatenated words | Visible line breaks remain newlines in JSON and HTML |
| Image initialization | A slow example photo replaced a completed upload | Completed user image/source state is preserved |
| Export recovery | A rejected font request remained cached forever | Retry can request the font again and produce the report |
| Export ownership | Control edits could enable another pending export | One active HTML export keeps its requested snapshot and busy state |
| Evidence consistency | Wrong worst-pixel metadata and mutable summaries could disagree with PNG/HTML | Metadata is PNG-derived; saved JSON and HTML use the same normalized record |

## Useful additions

- Original/background report crops mark the same weakest pixel, with a keyboard-accessible shared 2× enlargement control. No scripts or remote assets are needed to inspect the saved report.
- The playground has a direct **Check your page** guide, runnable CLI instructions and an API example for prepared pages.
- [The photo hero](../examples/hero/index.html) and [walkthrough](walkthrough.md) demonstrate capture → inspect → change the overlay → recapture at two widths. Its narrow rectangle changes from 1.4574209811667906:1/review to 7.596001647536648:1/clear at the selected 3:1 threshold. Heading geometry stays identical. These are example observations, not a letter-level failure determination or a measured productivity gain.
- Research links now identify axe's actual incomplete-reason configuration and acknowledge Kontrasto's existing DOM-aware image analysis.

## Checked evidence

Windows, Node24.19.0, Playwright1.62.1. Earlier checks used Edge154.0.4258.62. Edge became unavailable during final verification; final integration used the already installed Chrome154.0.8037.98, without downloading or repairing a browser.

- **67/67 repository tests passed**, including 27 new checks. Twenty-four new behavioral cases were observed failing before their fixes; three new controls protect ordinary supported captures.
- **17/17 browser workflow checks passed**, including 1440/768/390/320 layouts and zero axe interface findings with the intentionally adjustable specimen excluded.
- An independent integrated pass checked demo → guide → example at 1440/390/320, executed the displayed API example, generated real before/after CLI reports, and checked numeric/status agreement, marker positions, shared zoom, offline operation and visible line breaks.
- Original/adjusted example pages and the resulting reports were rendered and inspected. No page errors or horizontal overflow appeared in the checked flows.

The implementation commit [`09a21ee`](https://github.com/builtbyhuy/contrast-evidence/commit/09a21eed461387e1cf3d0625bb6b3ef37b7cf16a) passed [Linux/Chromium CI](https://github.com/builtbyhuy/contrast-evidence/actions/runs/37899465342), including `npm test` and `npm run test:demo`. [Pages deployment](https://github.com/builtbyhuy/contrast-evidence/actions/runs/37899463859) succeeded. Fresh Chrome readback verified the hosted guide, HTML download and navigation from the example to its adjusted state, with no page errors.

Run the repository test command with an installed browser:

```sh
CONTRAST_BROWSER=chrome npm test
CONTRAST_BROWSER=chrome npm run test:demo
```

PowerShell: set `$env:CONTRAST_BROWSER = 'chrome'` before those commands. Default uses explicitly installed Playwright Chromium. [The compact receipt](hardening.json) preserves observed counts and example results. CI additionally runs the project commands on Linux/Chromium.

## Current boundary

Capture requires a Chromium Page with CDP support and rejects pages containing any author-created shadow root, including unrelated web components. Browser-owned control roots elsewhere are allowed. Effects outside the supported stationary, opaque monochrome method remain unsupported; await each capture before reusing its Page. A rectangle minimum below threshold remains a review flag, never an automatic WCAG failure.

These checks demonstrate the repaired cases and inspected example workflow. They do not establish exhaustive correctness, full accessibility conformance, reviewer time savings, adoption or reputation gains.
