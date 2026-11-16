# PDF Marker

Fill out any PDF, including scans and forms without fields, by putting circles, X's, checks,
dots and text boxes on top of it, then export a new PDF with the marks built in.
Everything runs locally; the file never leaves your machine.

## Run

Requires Node 20.19+.

```sh
npm install          # also copies pdf.js fonts/cmaps/decoders into public/pdfjs
npm run dev          # web app at http://localhost:5199
npm run electron     # build + open as a desktop app
```

### Build the Windows app

```sh
npm run package      # -> release/<version>/PDF-Marker-<version>-portable.exe
```

This builds a single portable `.exe` that runs without installing. It isn't code-signed, so Windows SmartScreen
warns the first time it runs ("More info" → "Run anyway"). The version number comes from `package.json`.
Bump it before packaging so a new build doesn't overwrite one you're running.

## Use

1. Drop a PDF on the window (or Ctrl+O).
2. Pick a tool: **C** circle, **X** x-mark, **K** check, **D** dot, **S** cross-out, **T** text, **V** select.
3. Click to stamp. The tool stays active, so you can work through a bubble sheet one click per question.
   Clicking an existing mark selects it so you can drag it; Alt+click stamps on top of it anyway.
4. To size a stamp to the form's bubbles, resize one (corner handle, `[` / `]`, or the side panel).
   New stamps of that kind then use the same size.
5. **Text**: click to drop a one-line box (for a name or date), or drag to draw a paragraph box.
   Text wraps to the box width. Set **Line spacing** to the gap between the form's ruled lines and
   put the top of the box at the top of the first writing line; each line then sits on a rule.
   Hold **Space** and drag to pan around the page.
   **Alt + mouse wheel** resizes the selected mark. With nothing selected, it sets the size of the next
   stamp, and the preview under the cursor resizes as you scroll.
   Drag a corner handle while holding **Ctrl/Alt/Shift** to stretch a mark out of proportion.
   **Cross-out** (S): drag across words to strike them out. Styles are line, double, squiggle and scribble.
6. **Hand-drawn** (H, or the checkbox in the side panel): stamps come out as slightly irregular pen
   marks, each one a bit different. **Wobble** sets how messy they are. Select a stamp and press
   **R** to redraw just that one.
7. **Select several marks** to move or change them together:
   - **Shift+click** or **Ctrl+click** a mark to add it to (or remove it from) the selection, with any tool.
   - With the Select tool (**V**), drag a box over empty space: every mark it touches is selected on that page.
     Hold Shift/Ctrl while dragging to add to the current selection. **Ctrl+A** selects every mark on every page.
   - Drag any selected mark to move the whole group (each mark stays on its own page); arrow keys nudge them all.
     Clicking a mark in a group without dragging selects just that mark. Esc clears the selection.
   - `[` / `]`, **Alt + wheel**, **Del**, **Ctrl+D**, **H** and **R** act on every selected mark.
   - The side panel then shows only what applies to the whole set: colour always; for all-text selections the
     font, size, line spacing and box width; for all-stamp selections line width, hand-drawn and wobble, plus
     width/height if they are the same shape. Fields where the marks differ show "mixed"; type a value to set
     it on all of them. For example, select all your text boxes and type a new font size.
   - Each of these is one undo step.
8. **Copy, cut and paste** marks with **Ctrl+C**, **Ctrl+X** and **Ctrl+V** (Cmd on a Mac). Paste goes onto the
   page under your mouse (or, if the mouse isn't over a page, the page you're looking at most), at the same
   spot on the page as the original, so a mark at the top right of page 2 lands at the top right of page 1.
   Pasting back onto the page you copied from offsets the copy a little; each further paste cascades so copies
   don't hide each other. Several marks keep their layout. The clipboard survives opening another PDF, so you
   can copy your name and details from one form to the next. In a text box or side-panel field, Ctrl+C/V still
   copy and paste text. Each paste is one undo step. **Ctrl+D** still duplicates in place.
9. **Save project** (Ctrl+S) saves a `.pdfmark` file. **Export PDF** (Ctrl+E) saves `<name>-filled.pdf`.

### Coming back later

**Project files (`.pdfmark`)**: Save project writes a single file with your marks (readable JSON)
and a copy of the PDF, so it can't get separated from its PDF. Open it with **Open…** or by dropping
it on the window. Later Ctrl+S saves go back to the same file. A dot on the button means unsaved changes.

**Re-editable exports**: with **Re-editable** ticked (the default), the exported PDF is also your project file. It shows the
filled form in any PDF viewer, but it also carries the original blank PDF and your marks. Open it in
PDF Marker again and you get the original pages back with every mark editable, not baked in. Change
what you need and export again; the name stays `<name>-filled.pdf`.

- This makes the export about 2× the size of the original, since the original is stored inside.
- Anyone you send the file to can extract the blank original and your marks as data.
  Untick **Re-editable** for a plain, flat PDF when sending a final copy.
- If you "print to PDF" or re-save the file in another program, the hidden project data is usually
  dropped, and that copy opens as an ordinary flat PDF.

Separately, marks autosave in the browser for each PDF, so reopening the same original file brings them back.

## How it works

- Pages are drawn with **pdf.js**. Marks are an SVG layer measured in PDF points, so they stay put at any zoom.
- Export uses **pdf-lib** to draw the marks as vector graphics and text onto the original pages.
  Page rotation and offset crop boxes are handled. Text wrapping uses the same font measurements
  on screen and in the export, so lines break in the same places.
- If pdf-lib can't parse a damaged PDF, export falls back to rendering each page as a 200 dpi image
  and drawing the marks on that.
- Fonts: 8 handwriting fonts (Caveat, Patrick Hand, Kalam, Shadows Into Light, Indie Flower,
  Nothing You Could Do, Homemade Apple, Dancing Script) plus the standard PDF fonts (Helvetica, Times, Courier).
  The font picker previews each one with your own text. Handwriting fonts are embedded in the export,
  with only the characters you used included. They come from Google Fonts via `@fontsource`, licensed under the
  SIL Open Font License, except Homemade Apple, which is Apache 2.0. Both licenses allow bundling the fonts in an
  app and embedding them in documents. Characters a font can't show (emoji, most non-Latin scripts) export as `?`.

## Project layout

| Path | What's there |
| --- | --- |
| `src/App.tsx` | App state, toolbar, keyboard shortcuts, open/save/export, clipboard |
| `src/PageView.tsx` | One page: pdf.js canvas plus the SVG layer for marks and mouse handling |
| `src/Inspector.tsx` | Side panel: properties, font picker, shortcuts list |
| `src/geometry.ts` | Stamp shapes (incl. hand-drawn and cross-out variants), page→PDF coordinates |
| `src/fonts.ts` | Font registry, metrics, text wrapping and layout |
| `src/exporter.ts` | Writes the marks into the PDF (vector, or raster fallback) |
| `src/project.ts` | `.pdfmark` files and projects embedded in exported PDFs |
| `src/clipboard.ts` | Copy/paste payload and paste placement |
| `src/useSpacePan.ts`, `src/useWheelResize.ts` | Space-drag panning, Alt+wheel resizing |
| `electron/main.cjs` | Desktop app shell |
| `electron/smoke.cjs` | End-to-end test that drives the built app |
| `scripts/` | Unit tests, sample-form generator, pdf.js asset copier |

## Tests

```sh
npm test          # unit tests: coordinate math vs pdf.js on rotated/offset pages, export, fonts, resize, cross-outs, clipboard
npm run test:e2e  # builds the app and drives it in Electron (stamping, text, multi-select, copy/paste, save, export)
```
