# Playground design and evidence

## Direction

This is an operational tool: adjust the text and its background, see where the conservative minimum occurs, and retain an inspectable result. The first viewport demonstrates that job directly. A cool light workbench (`#f3f5f4`), ink (`#20282b`), cobalt controls (`#2146d0`) and yellow inspection marks (`#f1d96c`) frame one large photographic preview. Amber (`#765304`) and green (`#17614f`) distinguish review/clear results without calling either a full accessibility verdict. Result states are stated in words as well as color.

Self-hosted Instrument Sans gives the interface a consistent, compact hierarchy and tabular result numbers. Georgia is an optional text specimen. Only the preview is visually expressive; small controls support the work. The wide layout places the preview beside adjustments and shares the result beneath them. On smaller screens, the preview precedes the controls and result. Wide/narrow preview crops remain independently selectable, so a layout change visibly affects the actual check.

## References inspected

- The selected library's group 25 image was inspected for the relationship between a contrast check, a visible text sample and an explanation. https://webaim.org/resources/contrastchecker/ was read live for foreground/background controls and distinct normal/large text thresholds. No WebAIM interface, code, certification language or asset was copied.
- Library group 12 supplied the Pexels asset route. The actual Rehook Bike photograph was inspected locally; its varied brightness makes the crop/overlay decisions observable. https://www.pexels.com/license/ and the original photograph page were checked 2026-10-09. Asset source and license are retained in `demo/assets/CREDITS.md`.
- Group 08 supplied the typography route. Instrument Sans was obtained from the original Google Fonts directory with its OFL license. Runtime assets are local; there is no font/image CDN dependency.

## Measurement contract

The preview draws the photograph or diagonal gradient and its black overlay into one opaque sRGB canvas. The foreground is real DOM text, with no shadow, transparency or blend mode. Its actual bounding rectangle determines the canvas pixels passed to shared `analyzePixels`. Text size/weight determine the shared `textThreshold`; comparisons use unrounded ratios. At device scale, crop coordinates and the worst-pixel marker are mapped between canvas pixels and CSS pixels.

The bounding rectangle includes spaces and gaps between lines. A minimum below the threshold is always `needs-review`, not a WCAG failure. A minimum at/above the threshold is `quickcheck-clear` for this supported controlled preview only. Empty text, clipped text or unavailable pixel access is `unsupported`; those states cannot export a fabricated result. No OCR, glyph extraction or general screenshot contrast inference is used.

JSON exports retain the settings, source, geometry, unrounded result and embedded background/crop PNGs. HTML exports contain the same images and font, a scaled review illustration, result and caveats; the recorded measurements keep their original dimensions. User-controlled text/filenames are escaped before inclusion in HTML. The export needs no external connection.

Static PNG/JPEG/WebP uploads are bounded at 8 MB, 16 megapixels and 6,000 pixels per side; file signatures/dimensions are read before image decode. Animated PNG/WebP, SVG and unsupported formats are rejected. Errors preserve the current preview. File object URLs are revoked after decode; uploads never leave the browser. Reset restores the source, controls and marker.

## Verification

The working demo was rendered in local Microsoft Edge through Playwright at widths 1440, 768, 390 and 320 CSS pixels. Those four fresh-page runs had no page errors or horizontal overflow. Desktop/tablet default photo checks recorded 4.03:1 against the large-text threshold of 3:1; narrower fresh-page crops recorded about 1.9:1 and 2.0:1 and correctly requested review. Exact exports retain each capture's unrounded ratio and geometry; these observations are not a universal value for the photo.

The actual desktop/mobile screenshots and standalone HTML report were opened and inspected. A known white gradient produced `needs-review`; a stronger black overlay produced `quickcheck-clear`. The default mobile specimen initially clipped, so the mobile stage was increased to 420px and checked again. UI help text was darkened and made larger after the independent accessibility review identified insufficient contrast.

The downloaded HTML report was opened from a local file with zero HTTP requests. It retained images, the font, full OFL terms, source credit and the result; its review illustration matched the captured example. Ordinary Vietnamese text remained supported. Reduced-motion mode disabled smooth scrolling; keyboard Tab/Shift+Tab returned to Reset with a visible solid outline. Invalid hex colors, empty/clipped text and color emoji stop the check and disable exports; a rejected image preserves the prior valid preview.

Root integration tests independently cover controls, exports, upload rejection, accessibility findings and responsive behavior. Those tests supplement direct render inspection. A successful render or agent review is not evidence of community adoption, professional reputation or complete WCAG conformance.
