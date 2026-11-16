// Minimal Electron shell around the web app.
//   npm run electron       -> builds the web app, opens dist/ in a window
//   npm run electron:dev   -> opens the running Vite dev server (npm run dev)
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');

const DEV = process.argv.includes('--dev');
const DEV_URL = process.env.VITE_DEV_URL || 'http://localhost:5199';

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 950,
    title: 'PDF Marker',
    backgroundColor: '#e9e7e2',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Open external links in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // On Windows a lone Alt press/release (e.g. after Alt-dragging a resize
  // handle) focuses the menu bar and swallows the next key, such as a tool
  // shortcut. Swallow just that Alt key-up so the page keeps the keyboard.
  // Alt+<key> combos and every other key are untouched.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyUp' && input.key === 'Alt') event.preventDefault();
  });

  if (DEV) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  if (process.env.PDFM_SELFTEST) selfTest(win, process.env.PDFM_SELFTEST);
}

// Packaging check: PDFM_SELFTEST=<path to a pdf> opens that PDF in the packaged
// app, verifies a page rendered, prints the result, and exits.
function selfTest(win, pdfPath) {
  const fs = require('node:fs');
  win.webContents.once('did-finish-load', async () => {
    const js = (code) => win.webContents.executeJavaScript(code, true);
    try {
      const b64 = fs.readFileSync(pdfPath).toString('base64');
      await js(`(() => { const bytes = Uint8Array.from(atob('${b64}'), c => c.charCodeAt(0));
        const dt = new DataTransfer(); dt.items.add(new File([bytes], 'selftest.pdf', { type: 'application/pdf' }));
        window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt })); return 0; })()`);
      let result = null;
      for (let i = 0; i < 40 && !result; i++) {
        await new Promise((r) => setTimeout(r, 250));
        result = await js(`(() => { const c = document.querySelector('.page canvas'); if (!c || !c.width) return null;
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let ink = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i] < 128) ink++;
          return ink > 100 ? document.querySelector('.file').textContent + ' | dark pixels: ' + ink : null; })()`);
      }
      console.log(result ? `SELFTEST OK: ${result}` : 'SELFTEST FAIL: page did not render');
      app.exit(result ? 0 : 1);
    } catch (err) {
      console.log('SELFTEST FAIL:', err);
      app.exit(1);
    }
  });
}

// The app handles Ctrl+O / Ctrl+S / Ctrl +/- itself, so keep the menu free of
// those accelerators.
Menu.setApplicationMenu(
  Menu.buildFromTemplate([
    { label: 'File', submenu: [{ role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }] },
  ]),
);

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
