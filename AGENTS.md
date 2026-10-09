# Contrast Evidence

Build a narrow, honest contrast evidence tool. A bounding-box minimum below the threshold is `needs-review`, never an automatic WCAG failure. A supported capture above the threshold is `quickcheck-clear`; uncertain rendering is `unsupported`. Preserve these distinctions in API, CLI and UI.

Use Node ES modules. Shared pure math lives in `src/contrast.js`; browser imports it directly. Capture API: `captureContrast(page, { selector, threshold? })` returns one serializable result with embedded PNG data URLs. CLI orchestrates URL + viewport captures and writes JSON/HTML. No external accounts or model APIs required. Do not silently install a browser.

Temporary checks belong in the OS task temp folder. Keep original code, necessary assets with source/license, meaningful tests and compact validation evidence here. Do not store dependency folders or private/local machine paths in published evidence.
