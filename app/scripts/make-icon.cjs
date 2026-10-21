// Renders the app icon (saffron rounded square with a receipt) to app/assets/icon.png and icon.ico.
// Run with Electron:  node_modules/electron/dist/electron.exe scripts/make-icon.cjs
// (the .ico is written here by hand because electron-builder's own converter runs out of memory on small PCs)
const { app, BrowserWindow, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const out = path.join(__dirname, "..", "assets", "icon.png");
const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden"><style>html,body{overflow:hidden;margin:0}svg{display:block}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e8650f"/><stop offset="1" stop-color="#a33b00"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="110" fill="url(#g)"/>
  <!-- receipt with a zig-zag bottom edge -->
  <path d="M156 100h200v264l-25-18-25 18-25-18-25 18-25-18-25 18-25-18-25 18z" transform="translate(0 20)" fill="#fff"/>
  <g fill="#c24a05">
    <rect x="190" y="160" width="132" height="14" rx="7"/>
    <rect x="190" y="204" width="132" height="14" rx="7"/>
    <rect x="190" y="248" width="86" height="14" rx="7"/>
  </g>
  <text x="256" y="372" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="800" font-size="64" fill="#a33b00" transform="translate(0 0)">₹</text>
</svg></body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: false } });
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  console.log("icon written", img.getSize());
  // Windows .ico made of PNG images (supported since Vista), so the build needs no image tool.
  const sizes = [256, 128, 64, 48, 32, 24, 16];
  const pngs = sizes.map((n) => nativeImage.createFromBuffer(img.toPNG()).resize({ width: n, height: n, quality: "best" }).toPNG());
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const entries = sizes.map((n, i) => {
    const e = Buffer.alloc(16);
    e[0] = n === 256 ? 0 : n;
    e[1] = n === 256 ? 0 : n;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    return e;
  });
  fs.writeFileSync(out.replace(/\.png$/, ".ico"), Buffer.concat([head, ...entries, ...pngs]));
  console.log("ico written", sizes.join(","));
  app.exit(0);
});
