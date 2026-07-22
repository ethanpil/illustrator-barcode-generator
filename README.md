# Barcode Generator for Adobe Illustrator

An ExtendScript (`.jsx`) that generates print-ready vector barcodes directly in
Illustrator. No plugins, no web services, no fonts required — everything is
drawn as native paths on a new layer.

## Features

- **Five symbologies** — UPC-A, EAN-13, Code 39, Code 128, and QR Code
  (versions 1–40, error correction level M, numeric / alphanumeric / byte
  modes chosen automatically for the smallest symbol).
- **Live preview on the artboard** — the actual vector art is drawn and
  updated as you change settings, so what you see is exactly what you get.
  Refreshes on any control change or via the Preview button.
- **Check digit handling** — enter 11 digits (UPC-A) or 12 (EAN-13) and the
  check digit is calculated for you; enter the full number and it is verified,
  with a Fix / Use as typed / Cancel prompt if it's wrong.
- **Clean vector output** — all bars/modules are a single compound path
  (one click to select or recolor), and human-readable text is converted to
  outlines, so files scan, print, and hand off without font dependencies.
- **Sliders for the common adjustments** — padding, bar height, text size,
  and the gap between bars and text.
- **GS1 magnification presets** — 80–200% sizes for UPC/EAN based on the
  spec's nominal 0.33 mm module and 22.85 mm bar height, for
  packaging-compliant output.
- **Correct quiet zones** — 10 modules for 1D codes, 4 modules on all sides
  for QR, with an optional white background rectangle that hugs the artwork.
- **OCR-B aware** — uses OCR-B for UPC/EAN digits when installed, warns and
  falls back gracefully when not.

## Install

**Option A — run once:** in Illustrator choose
`File > Scripts > Other Script...` and pick
`illustrator-barcode-generator.jsx`.

**Option B — install in the Scripts menu:** copy the `.jsx` file into
Illustrator's Scripts folder, then restart Illustrator. It appears under
`File > Scripts`.

- Windows:
  `C:\Program Files\Adobe\Adobe Illustrator <version>\Presets\en_US\Scripts\`
- macOS:
  `/Applications/Adobe Illustrator <version>/Presets/en_US/Scripts/`

(Adjust `en_US` to your locale. You may need administrator rights to copy
into these folders.)

### OCR-B font (recommended)

OCR-B is the standard typeface for the human-readable digits on UPC/EAN
barcodes. A free version is included in this repo as `OCR-B.zip` — unzip it
and install the font (right-click > Install on Windows, or add it via Font
Book on macOS) before running the script.

If OCR-B is not installed, the script warns you once and falls back through
Arial, Helvetica, then Myriad Pro (and finally the application default).
Barcodes still generate and scan fine either way — and because the text is
converted to outlines, the resulting artwork never depends on any font being
installed. The fallback only affects how closely the digits match the classic
retail-barcode look.

## Use

1. Run the script. Pick a barcode type and enter the value.
2. Tab out of the value field (or press Preview) to see the barcode on the
   artboard; adjust options until it looks right.
3. Click Generate. The barcode is placed on its own layer, centered on the
   active artboard and selected — drag it into position.

Note: preview refreshes add steps to the undo history while the dialog is
open. A document is created automatically if none is open.

## License

MIT — see [LICENSE](LICENSE).
