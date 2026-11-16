// End-to-end smoke test, driving the built app in Electron:
//   npm run build && npx electron electron/smoke.cjs
// Loads test-output/sample-form.pdf, stamps bubbles, types into a name field
// and a ruled paragraph box, exports, re-opens the export and takes screenshots
// of each step into test-output/.
const { app, BrowserWindow, Menu, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = (f) => path.join(root, 'test-output', f);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

setTimeout(() => {
  console.error('smoke test timed out');
  app.exit(2);
}, 120_000);

app.whenReady().then(run).catch((err) => {
  console.error('smoke test failed:', err);
  app.exit(1);
});

async function run() {
  // The same Edit menu as electron/main.cjs (keep in sync): its cut/copy/paste roles own Ctrl+X/C/V.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: 'File', submenu: [{ role: 'quit' }] },
      { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }] },
    ]),
  );
  const win = new BrowserWindow({ width: 1300, height: 1000, webPreferences: { contextIsolation: true } });
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code, true);
  const errors = [];
  wc.on('console-message', (e) => {
    if (e.level === 'error') errors.push(e.message);
  });

  await win.loadFile(path.join(root, 'dist', 'index.html'));
  await js(`localStorage.clear(); localStorage.setItem('pdf-marker:defaults', JSON.stringify({
    text: { font: 'Helvetica', size: 11, lineHeight: 18, w: 220 } })); location.reload();`).catch(() => {});
  await sleep(800);

  const open = async (file) => {
    const b64 = fs.readFileSync(file).toString('base64');
    await js(`(async () => {
      const bytes = Uint8Array.from(atob('${b64}'), c => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], '${path.basename(file)}', { type: 'application/pdf' }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    })()`);
    await sleep(1800);
  };
  // Screenshots are best-effort (capture fails when the display is locked/asleep).
  const shot = async (name) => {
    try {
      fs.writeFileSync(out(name), (await win.capturePage()).toPNG());
    } catch (err) {
      console.warn(`screenshot ${name} skipped: ${err.message}`);
    }
  };
  // Page-point -> window coordinates on page `i`.
  const at = async (i, x, y) =>
    js(`(() => { const s = document.querySelectorAll('.overlay')[${i}], sc = document.querySelector('.scroller');
      let r = s.getBoundingClientRect(); const z = r.width / s.viewBox.baseVal.width;
      // Scroll so the target point (not just the page) is on screen.
      const vr = sc.getBoundingClientRect(), py = r.top + ${y} * z, px = r.left + ${x} * z;
      if (py < vr.top + 40 || py > vr.bottom - 40) sc.scrollTop += py - (vr.top + vr.height / 2);
      if (px < vr.left + 40 || px > vr.right - 40) sc.scrollLeft += px - (vr.left + vr.width / 2);
      r = s.getBoundingClientRect();
      return [Math.round(r.left + ${x} * z), Math.round(r.top + ${y} * z)]; })()`);
  const mouse = (type, [x, y]) => wc.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
  const click = async (p) => {
    mouse('mouseMove', p);
    mouse('mouseDown', p);
    mouse('mouseUp', p);
    await sleep(60);
  };
  const dragFrom = async (a, b) => {
    mouse('mouseMove', a);
    mouse('mouseDown', a);
    for (let t = 1; t <= 6; t++) mouse('mouseMove', [a[0] + ((b[0] - a[0]) * t) / 6, a[1] + ((b[1] - a[1]) * t) / 6]);
    mouse('mouseUp', b);
    await sleep(100);
  };
  const key = (keyCode) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    wc.sendInputEvent({ type: 'char', keyCode });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
  };
  // Type into the inline text editor once it has mounted and taken focus.
  // (Typing too early loses the text, and the empty box is discarded.)
  const typeText = async (text) => {
    for (let i = 0; i < 40; i++) {
      if (await js(`document.activeElement?.classList.contains('text-editor') ?? false`)) break;
      await sleep(50);
    }
    wc.insertText(text);
    await sleep(80);
  };

  await open(out('sample-form.pdf'));
  // Fixed zoom for predictable screenshots.
  await js(`document.querySelector('.zoom').textContent`);

  // Circle the answer bubbles for questions 1-14 (answer = q mod 5).
  // Questions 1-7 clean, 8-14 (and the X / check below) hand-drawn.
  for (let q = 0; q < 14; q++) {
    if (q === 7) {
      key('Escape'); // deselect, so H only changes the default
      key('h');
    }
    await click(await at(0, 380 + 34 * (q % 5), 792 - (660 - 28 * q + 3.5)));
  }
  key('x');
  await click(await at(0, 380 + 34 * 4, 792 - (660 + 3.5)));
  key('k');
  await click(await at(0, 380 + 34 * 3, 792 - (660 - 28 + 3.5)));

  // Name field: click on it with the text tool and type.
  key('t');
  await click(await at(0, 104, 80));
  await typeText('Jane Q. Example');
  await sleep(100);
  key('Escape');

  // Paragraph box over the ruled lines (first rule at y=572, 18pt apart).
  await dragFrom(await at(0, 60, 554), await at(0, 552, 662));
  await sleep(100);
  await typeText(
    'This is a paragraph answer that should wrap automatically across the ruled lines without me ' +
      'having to place each line by hand. It keeps going for a while so that it needs several lines, ' +
      'and each line should sit right on top of a printed rule.',
  );
  await sleep(150);
  await shot('smoke-1-editing.png');
  key('Escape');

  // Rotated page 2: a circle and some text.
  key('c');
  await click(await at(1, 100, 100));
  key('t');
  await click(await at(1, 140, 100));
  await typeText('upright?');
  key('Escape');
  await sleep(200);
  key('Escape');
  await js(`document.querySelector('.scroller').scrollTo(0, 0)`);
  await sleep(300);
  await shot('smoke-2-marked.png');
  await js(`document.querySelectorAll('.overlay')[1].scrollIntoView()`);
  await sleep(500);
  await shot('smoke-3-rotated-page.png');

  const count = await js(`document.querySelector('.file').textContent`);
  const handCount = await js(`[...document.querySelectorAll('.overlay')[0].querySelectorAll('.annot polyline, .annot polygon')]
    .filter(p => (p.getAttribute('points') || '').split(' ').length > 20).length`);

  // Save a .pdfmark project with Ctrl+S (intercepting the save dialog).
  await js(`window.__saved = null; window.showSaveFilePicker = async (o) => ({ name: o.suggestedName, createWritable: async () => ({
      write: async (blob) => { window.__saved = { name: o.suggestedName, bytes: new Uint8Array(await blob.arrayBuffer()) }; },
      close: async () => {} }) }); 0`);
  wc.sendInputEvent({ type: 'keyDown', keyCode: 's', modifiers: ['control'] });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 's', modifiers: ['control'] });
  for (let i = 0; i < 50 && !(await js(`!!window.__saved`)); i++) await sleep(200);
  const projName = await js(`window.__saved && window.__saved.name`);
  const projB64 = await js(`(() => { let s = ''; const a = window.__saved.bytes; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); })()`);
  fs.writeFileSync(out('smoke.pdfmark'), Buffer.from(projB64, 'base64'));
  const saveBtn = await js(`[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Save project')).textContent`);
  if (projName !== 'sample-form.pdfmark') errors.push('project name: ' + projName);
  if (saveBtn.includes('•')) errors.push('still marked unsaved after saving');
  try {
    win.webContents.setZoomFactor(1);
    const r = await js(`(() => { const r = document.querySelectorAll('.overlay')[0].getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top) }; })()`);
    const z = await js(`document.querySelectorAll('.overlay')[0].getBoundingClientRect().width / 612`);
    const img = await win.capturePage({ x: r.x + Math.round(560 * z), y: r.y + Math.round(110 * z), width: Math.round(200 * z), height: Math.round(400 * z) });
    fs.writeFileSync(out('smoke-hand-drawn-closeup.png'), img.toPNG());
  } catch (err) {
    console.warn('closeup skipped', err.message);
  }

  // Export, intercepting the save dialog.
  await js(`window.showSaveFilePicker = async () => ({ createWritable: async () => ({
      write: async (blob) => { window.__exported = new Uint8Array(await blob.arrayBuffer()); }, close: async () => {} }) }); 0`);
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Export PDF').click()`);
  let ready = false;
  for (let i = 0; i < 50 && !ready; i++) {
    await sleep(200);
    ready = await js(`!!window.__exported`);
  }
  if (!ready) throw new Error('export never completed: ' + (await js(`document.querySelector('.status')?.textContent`)));
  const b64 = await js(`(() => { let s = ''; const a = window.__exported; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); })()`);
  fs.writeFileSync(out('smoke-filled.pdf'), Buffer.from(b64, 'base64'));

  // Re-open the exported PDF: it should come back as the clean original with
  // all 20 marks editable (not baked in twice).
  await open(out('smoke-filled.pdf'));
  await shot('smoke-4-reopened-project.png');
  const reopened = await js(`document.querySelector('.file').textContent`);
  const reopenStatus = await js(`document.querySelector('.status')?.textContent ?? ''`);
  if (reopened !== count) errors.push(`project reopen: "${reopened}" vs before export "${count}"`);

  // Edit after reopening: move the first circle, export again, and check the
  // exported name doesn't become "-filled-filled".
  const c0 = await at(0, 380, 792 - (660 + 3.5));
  key('v');
  await dragFrom(c0, [c0[0] + 40, c0[1]]);
  await js(`window.__exported = null; window.__savedName = null;
    window.showSaveFilePicker = async (o) => { window.__savedName = o.suggestedName; return { createWritable: async () => ({
      write: async (blob) => { window.__exported = new Uint8Array(await blob.arrayBuffer()); }, close: async () => {} }) }; }; 0`);
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Export PDF').click()`);
  for (let i = 0; i < 50 && !(await js(`!!window.__exported`)); i++) await sleep(200);
  const savedName = await js(`window.__savedName`);
  if (savedName !== 'sample-form-filled.pdf') errors.push('second export name: ' + savedName);

  // Turn "Re-editable" off: the export must then open as a plain, flat PDF.
  await js(`document.querySelector('.toggle input').click(); window.__exported = null;
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Export PDF').click(); 0`);
  for (let i = 0; i < 50 && !(await js(`!!window.__exported`)); i++) await sleep(200);
  const flat = await js(`(() => { let s = ''; const a = window.__exported; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); })()`);
  fs.writeFileSync(out('smoke-flat.pdf'), Buffer.from(flat, 'base64'));
  await js(`document.querySelector('.toggle input').click(); 0`); // restore the default
  await open(out('smoke-flat.pdf'));
  await shot('smoke-5-flat-export.png');
  const flatInfo = await js(`document.querySelector('.file').textContent`);
  // Close-up of the bubbles as rendered from the exported PDF (doesn't need a visible screen).
  for (let i = 0; i < 4; i++) {
    wc.sendInputEvent({ type: 'keyDown', keyCode: '=', modifiers: ['control'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: '=', modifiers: ['control'] });
    await sleep(150);
  }
  await js(`document.querySelector('.scroller').scrollTo(0, 0)`);
  await sleep(1500);
  const crop = await js(`(() => { const c = document.querySelector('.page canvas'); const s = c.width / 612;
    const o = document.createElement('canvas'); o.width = 180 * s; o.height = 390 * s;
    o.getContext('2d').drawImage(c, 362 * s, 118 * s, 180 * s, 390 * s, 0, 0, o.width, o.height);
    return o.toDataURL('image/png').split(',')[1]; })()`);
  fs.writeFileSync(out('smoke-export-closeup.png'), Buffer.from(crop, 'base64'));
  if (!/smoke-flat\.pdf · 2 pg · 0 marks/.test(flatInfo)) errors.push('flat export reopen: ' + flatInfo);

  // Regression: a size set in the side panel becomes the size of the next stamp.
  key('x');
  await click(await at(0, 300, 740));
  await js(`(() => { const f = [...document.querySelectorAll('.inspector .field')].find(f => f.querySelector('span')?.textContent === 'Width');
    const i = f.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '30');
    i.dispatchEvent(new Event('input', { bubbles: true })); return 0; })()`);
  await sleep(150);
  key('Escape');
  await click(await at(0, 380, 740));
  await sleep(150);
  const xWidths = await js(`[...document.querySelectorAll('.overlay')[0].querySelectorAll('.annot .hit')].slice(-2).map(r => Math.round(+r.getAttribute('width')))`);
  if (xWidths.join() !== '30,30') errors.push('next stamp did not keep the size set in the panel: ' + xWidths);
  console.log('panel-set size then next stamp (widths):', xWidths.join(', '));
  key('Delete');
  await click(await at(0, 300, 740));
  key('Delete');

  // Open the saved .pdfmark: same marks, nothing baked in.
  await open(out('smoke.pdfmark'));
  const pmInfo = await js(`document.querySelector('.file').textContent`);
  const pmStatus = await js(`document.querySelector('.status')?.textContent ?? ''`);
  if (pmInfo !== count) errors.push(`.pdfmark reopen: "${pmInfo}" vs "${count}"`);

  // ---- Multi-select (on the freshly opened .pdfmark: 20 marks, 2 text boxes on page 1) ----
  {
    const check = (cond, msg) => {
      if (!cond) errors.push('multi-select: ' + msg);
    };
    const withMods = (type, [x, y], modifiers) => wc.sendInputEvent({ type, x, y, button: 'left', clickCount: 1, modifiers });
    const modClick = async (p, modifiers) => {
      withMods('mouseMove', p, modifiers);
      withMods('mouseDown', p, modifiers);
      withMods('mouseUp', p, modifiers);
      await sleep(80);
    };
    const chord = (keyCode, modifiers) => {
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    };
    const setField = (label, value) =>
      js(`(() => { const f = [...document.querySelectorAll('.inspector .field')].find(f => f.querySelector('span')?.textContent === '${label}');
        if (!f) return false; const i = f.querySelector('input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '${value}');
        i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    const outlines = () => js(`document.querySelectorAll('.overlay .sel-outline').length`);
    const handles = () => js(`document.querySelectorAll('.overlay .sel-handle').length`);
    const header = () => js(`document.querySelector('.inspector h3')?.textContent ?? ''`);
    const markCount = async () => +(await js(`document.querySelector('.file').textContent`)).match(/(\d+) marks/)[1];
    const fontSizes = () => js(`[...document.querySelectorAll('.overlay')[0].querySelectorAll('.annot text')].map(t => +t.getAttribute('font-size'))`);
    // x, y, w, h of the stamps' hit boxes on page 1 (stamps come first in the list, in creation order)
    const stampBoxes = () => js(`[...document.querySelectorAll('.overlay')[0].querySelectorAll('.annot')]
      .filter(g => !g.querySelector('text')).map(g => { const r = g.querySelector('.hit'); return ['x', 'y', 'width', 'height'].map(k => +r.getAttribute(k)); })`);
    const zoomNow = await js(`document.querySelectorAll('.overlay')[0].getBoundingClientRect().width / 612`);

    // 1. Shift+click two text boxes (with the X tool still active: it works with any tool), set the size.
    key('Escape');
    key('Escape'); // nothing selected -> Select tool
    key('x');
    await click(await at(0, 150, 80)); // the name box
    check((await outlines()) === 1 && (await handles()) === 1, 'single selection should show 1 outline + the handle');
    check((await header()) === 'Text box', 'single text header: ' + (await header()));
    await modClick(await at(0, 300, 600), ['shift']); // the paragraph box
    check((await outlines()) === 2, 'two text boxes should have 2 outlines: ' + (await outlines()));
    check((await handles()) === 0, 'no resize handle with 2 selected');
    check((await header()) === '2 marks selected', 'header: ' + (await header()));
    const summary = await js(`document.querySelector('.inspector .sel-summary')?.textContent`);
    check(summary === '2 text', 'breakdown: ' + summary);
    check(await setField('Font size', '14'), 'no Font size field for 2 text boxes');
    await sleep(150);
    const sizes = await fontSizes();
    check(sizes.length === 2 && sizes.every((s) => s === 14), 'both text boxes should be 14pt: ' + sizes);
    // Shift+click again toggles one back out.
    await modClick(await at(0, 150, 80), ['shift']);
    check((await outlines()) === 1 && (await handles()) === 1, 'shift+click should deselect one of two');
    key('Escape');
    check((await outlines()) === 0, 'Escape should clear the selection');

    // 2. Marquee (Select tool) over three circles (rows 0-2 of the bubble sheet), then drag one.
    key('v');
    const before = await stampBoxes();
    await dragFrom(await at(0, 350, 110), await at(0, 470, 200));
    check((await outlines()) === 3, 'marquee should select 3 circles: ' + (await outlines()));
    check((await header()) === '3 marks selected', 'marquee header: ' + (await header()));
    check((await js(`document.querySelector('.inspector .sel-summary')?.textContent`)) === '3 circle', 'marquee breakdown');
    check((await js(`document.querySelectorAll('.overlay .box-preview').length`)) === 0, 'marquee rectangle should be gone after release');
    const marks0 = await markCount();
    const dxPx = 40, dyPx = 30;
    const grab = await at(0, 414, 156.5); // the middle one
    await dragFrom(grab, [grab[0] + dxPx, grab[1] + dyPx]);
    const after = await stampBoxes();
    const moved = before.map((b, i) => [after[i][0] - b[0], after[i][1] - b[1]]);
    const exp = [dxPx / zoomNow, dyPx / zoomNow];
    const movedIdx = moved.map((m, i) => (Math.hypot(m[0], m[1]) > 0.01 ? i : -1)).filter((i) => i >= 0);
    check(movedIdx.length === 3, 'dragging should move exactly the 3 selected: ' + movedIdx);
    check(
      movedIdx.every((i) => Math.abs(moved[i][0] - exp[0]) < 0.6 && Math.abs(moved[i][1] - exp[1]) < 0.6),
      `all three should move by (${exp.map((v) => v.toFixed(1))}): ` + JSON.stringify(movedIdx.map((i) => moved[i])),
    );
    check((await outlines()) === 3, 'selection should survive the drag');

    // 3. One Ctrl+Z puts all three back (and leaves the earlier font-size change alone).
    chord('z', ['control']);
    await sleep(150);
    const undone = await stampBoxes();
    check(JSON.stringify(undone) === JSON.stringify(before), 'one Ctrl+Z should undo the whole group move');
    const sizesAfterUndo = await fontSizes();
    check(sizesAfterUndo.every((s) => s === 14), 'undo should only undo the move, not the font size: ' + sizesAfterUndo);

    // 4. Delete removes all of them (the selection is still the three circles).
    check((await outlines()) === 3, 'selection should survive undo');
    key('Delete');
    await sleep(150);
    check((await markCount()) === marks0 - 3, `Delete should remove all 3 marks: ${marks0} -> ${await markCount()}`);
    check((await outlines()) === 0, 'nothing should stay selected after Delete');
    chord('z', ['control']);
    await sleep(150);
    check((await markCount()) === marks0, 'Ctrl+Z should bring the 3 back');
    check((await outlines()) === 0, 'selection must not resurrect deleted ids');

    // 5. Group scale, duplicate (copies become the selection), Ctrl+A, Escape.
    await dragFrom(await at(0, 350, 230), await at(0, 540, 310)); // rows 4-6: three circles
    check((await outlines()) === 3, 'second marquee should select 3: ' + (await outlines()));
    const w0 = (await stampBoxes()).map((b) => b[2]);
    key(']');
    await sleep(100);
    const w1 = (await stampBoxes()).map((b) => b[2]);
    const grown = w1.filter((w, i) => Math.abs(w / w0[i] - 1.1) < 0.01).length;
    check(grown === 3, `] should grow exactly the 3 selected by 10%: ${grown}`);
    chord('d', ['control']);
    await sleep(150);
    check((await markCount()) === marks0 + 3, 'Ctrl+D should add 3 copies');
    check((await outlines()) === 3, 'the copies should be the new selection');
    chord('a', ['control']);
    await sleep(100);
    check((await header()) === `${await markCount()} marks selected`, 'Ctrl+A header: ' + (await header()));
    check((await outlines()) === (await js(`document.querySelectorAll('.overlay .annot').length`)), 'Ctrl+A outlines every mark on every page');
    key('Escape');
    check((await outlines()) === 0, 'Escape clears after Ctrl+A');
    console.log(
      'multi-select: font sizes',
      sizes.join('/'),
      '| group move (pt)',
      movedIdx.map((i) => moved[i].map((v) => v.toFixed(1)).join(',')).join(' ; '),
      '| grown',
      grown,
    );
  }

  // ---- Copy / cut / paste, through the real Ctrl+C/X/V path (Edit-menu roles) ----
  // State on entry: the .pdfmark is open; page 2 has a circle at (100,100) and the text "upright?" at (140,100).
  {
    const check = (cond, msg) => {
      if (!cond) errors.push('clipboard: ' + msg);
    };
    const chord = async (keyCode, modifiers = ['control']) => {
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      await sleep(200);
    };
    const hover = async (p) => {
      mouse('mouseMove', p);
      await sleep(80);
    };
    const statusText = () => js(`document.querySelector('.status')?.textContent ?? ''`);
    const outlines = () => js(`document.querySelectorAll('.overlay .sel-outline').length`);
    // hit boxes (x, y, w, h) of every mark on page `i`, in document order
    const marksOn = (i) => js(`[...document.querySelectorAll('.overlay')[${i}].querySelectorAll('.annot')].map(g => {
      const r = g.querySelector('.hit'); return ['x', 'y', 'width', 'height'].map(k => +(+r.getAttribute(k)).toFixed(2)); })`);
    const total = async () => +(await js(`document.querySelector('.file').textContent`)).match(/(\d+) marks/)[1];
    const modClick = async (p, modifiers) => {
      for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) wc.sendInputEvent({ type, x: p[0], y: p[1], button: 'left', clickCount: 1, modifiers });
      await sleep(80);
    };
    const near = (a, b) => Math.abs(a - b) < 0.02;
    const sameBox = (a, b, dx = 0, dy = 0) => a && b && near(a[0] + dx, b[0]) && near(a[1] + dy, b[1]) && near(a[2], b[2]) && near(a[3], b[3]);

    // What actually reaches the page when Ctrl+C / Ctrl+V go through the menu roles?
    await js(`window.__ev = []; for (const t of ['copy', 'cut', 'paste']) document.addEventListener(t, () => window.__ev.push(t), true);
      window.addEventListener('keydown', (e) => { if (e.ctrlKey && 'cvx'.includes(e.key)) window.__ev.push('keydown-' + e.key); }, true); 0`);

    key('Escape');
    key('Escape');
    key('v');
    clipboard.clear();
    const p1before = await marksOn(0);
    const p2marks = await marksOn(1);
    check(p2marks.length === 2, 'page 2 should start with 2 marks: ' + p2marks.length);

    // 1. Copy the circle on page 2, hover page 1, paste: same coordinates on page 1.
    await click(await at(1, 100, 100));
    check((await outlines()) === 1, 'circle on page 2 should be selected');
    await chord('c');
    console.log('clipboard formats after Ctrl+C:', clipboard.availableFormats().join(', '));
    check(/Copied 1 mark/.test(await statusText()), 'copy status: ' + (await statusText()));
    await hover(await at(0, 300, 400));
    await chord('v');
    let p1 = await marksOn(0);
    check(p1.length === p1before.length + 1, `Ctrl+V should add a mark to page 1: ${p1before.length} -> ${p1.length}`);
    check(sameBox(p1[p1.length - 1], p2marks[0]), `pasted mark should keep its coordinates: ${p1[p1.length - 1]} vs ${p2marks[0]}`);
    check((await marksOn(1)).length === 2, 'page 2 must be unchanged');
    check((await outlines()) === 1, 'pasted mark should be the selection');
    check(/Pasted 1 mark on page 1/.test(await statusText()), 'paste status: ' + (await statusText()));

    // 2. Paste again on the same page: +12 each time.
    await chord('v');
    p1 = await marksOn(0);
    check(p1.length === p1before.length + 2, 'second paste should add another');
    check(sameBox(p2marks[0], p1[p1.length - 1], 12, 12), `second paste should be +12,+12: ${p1[p1.length - 1]}`);
    await chord('v');
    p1 = await marksOn(0);
    check(sameBox(p2marks[0], p1[p1.length - 1], 24, 24), `third paste should be +24,+24: ${p1[p1.length - 1]}`);

    // 3. Pasting back onto the page it came from also offsets by 12; one Ctrl+Z takes back a whole paste.
    await hover(await at(1, 300, 400));
    await chord('v');
    const p2 = await marksOn(1);
    check(p2.length === 3 && sameBox(p2marks[0], p2[2], 12, 12), 'paste on the source page should offset +12: ' + JSON.stringify(p2));
    await chord('z');
    check((await marksOn(1)).length === 2, 'one Ctrl+Z should undo one paste');
    await chord('y');
    check((await marksOn(1)).length === 3, 'Ctrl+Y redoes it');
    await chord('z');

    // 4. Ctrl+X removes the (selected) page-1 copy; Ctrl+V puts it back in place.
    const last = p1[p1.length - 1];
    await click(await at(0, last[0] + 8, last[1] + 8)); // the +24 copy
    check((await outlines()) === 1, 'the +24 copy should be selected: ' + (await outlines()));
    const cutBox = (await marksOn(0)).slice(-1)[0];
    const n0 = await total();
    await chord('x');
    check((await total()) === n0 - 1, `Ctrl+X should remove the mark: ${n0} -> ${await total()}`);
    check((await outlines()) === 0, 'nothing selected after cut');
    await hover(await at(0, 300, 400));
    await chord('v');
    check((await total()) === n0, 'Ctrl+V should restore it');
    check(sameBox((await marksOn(0)).slice(-1)[0], cutBox), 'restored mark should be where it was: ' + (await marksOn(0)).slice(-1)[0]);
    await chord('z'); // undo the paste
    check((await total()) === n0 - 1, 'undo paste');
    await chord('z'); // undo the cut
    check((await total()) === n0, 'undo cut brings the original back');

    // 5. A multi-selection keeps its relative layout (circle + text box from page 2 -> page 1).
    key('Escape');
    await click(await at(1, 100, 100));
    await modClick(await at(1, 150, 105), ['shift']);
    check((await outlines()) === 2, 'circle + text should be selected: ' + (await outlines()));
    await chord('c');
    check(clipboard.readText() === 'upright?', 'plain-text twin should be the text box text: ' + JSON.stringify(clipboard.readText()));
    const n1 = await total();
    const beforeP1 = await marksOn(0);
    await hover(await at(0, 300, 400));
    await chord('v');
    const afterP1 = await marksOn(0);
    check((await total()) === n1 + 2 && afterP1.length === beforeP1.length + 2, 'pasting 2 marks adds 2');
    const [pc, pt] = afterP1.slice(-2);
    check(sameBox(pc, p2marks[0]) && sameBox(pt, p2marks[1]), `group should keep coordinates and layout: ${pc} ${pt} vs ${p2marks[0]} ${p2marks[1]}`);
    check((await outlines()) === 2, 'both pasted marks selected');
    check(/Pasted 2 marks on page 1/.test(await statusText()), 'plural status: ' + (await statusText()));

    // 6. Mouse not over any page (side panel): lands on the page you are looking at.
    await js(`document.querySelector('.scroller').scrollTo(0, 0)`);
    await sleep(150);
    await hover([1290, 500]);
    const pageBefore = await marksOn(0);
    await chord('v');
    check((await marksOn(0)).length === pageBefore.length + 2, 'with the mouse off the pages, paste goes to the most visible page (page 1)');

    // 7. Ctrl+C inside the text box editor copies text, not marks.
    key('Escape');
    await click(await at(1, 150, 105));
    key('Enter');
    await sleep(200);
    check((await js(`document.activeElement?.tagName`)) === 'TEXTAREA', 'Enter should open the editor');
    await chord('a');
    clipboard.writeText('sentinel');
    const n2 = await total();
    await chord('c');
    check(clipboard.readText() === 'upright?', 'Ctrl+C in the editor should copy the selected text: ' + JSON.stringify(clipboard.readText()));
    check(!clipboard.availableFormats().includes('application/x-pdfmark+json') && (await total()) === n2, 'no marks copied from the editor');
    await chord('End', []);
    await chord('v');
    const typed = await js(`document.querySelector('textarea')?.value`);
    check(typed === 'upright?upright?', 'Ctrl+V in the editor should paste text: ' + JSON.stringify(typed));
    check((await total()) === n2, 'Ctrl+V in the editor must not paste marks: ' + (await total()));
    await chord('z'); // undo inside the editor: leaves the box's text as it was
    key('Escape');
    await sleep(100);

    // 8. The system clipboard now holds plain text only; paste falls back to the in-memory marks.
    key('Escape');
    clipboard.writeText('just some text');
    await hover(await at(0, 300, 400));
    const n3 = await total();
    await chord('v');
    check((await total()) === n3 + 2, 'without marks on the system clipboard, paste uses the in-memory copy: ' + n3 + ' -> ' + (await total()));

    // 9. The clipboard survives opening another file. Page 2 -> page 2 of a different document is NOT the source page.
    clipboard.clear();
    await open(out('smoke-flat.pdf'));
    const flatBefore = [await marksOn(0), await marksOn(1)];
    await hover(await at(1, 300, 400));
    await chord('v');
    const flatAfter = [await marksOn(0), await marksOn(1)];
    check(flatAfter[1].length === 2 && flatBefore[1].length === 0, 'paste in another file: 2 marks on page 2: ' + flatAfter[1].length);
    check(sameBox(flatAfter[1][0], p2marks[0]) && sameBox(flatAfter[1][1], p2marks[1]), 'in the other file the marks land at the same spot (no +12): ' + JSON.stringify(flatAfter[1]));
    check(flatAfter[0].length === 0, 'nothing on page 1 of the other file');
    await hover(await at(0, 300, 400));
    await chord('v');
    check((await marksOn(0)).length === 2, 'paste on page 1 of the other file');
    console.log('events seen by the page:', (await js(`window.__ev`)).join(' '));
  }

  console.log('hand-drawn stamps on page 1:', handCount);
  console.log('project saved as:', projName, '| button after save:', saveBtn);
  console.log('.pdfmark reopened:', pmInfo, '|', pmStatus);
  console.log('status:', count);
  console.log('reopened:', reopened, '|', reopenStatus);
  console.log('second export name:', savedName);
  console.log('flat export:', flatInfo);
  console.log('console errors:', errors.length ? errors : 'none');
  app.exit(errors.length ? 1 : 0);
}
