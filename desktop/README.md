# ArchitectureV1

Minimalist red-themed desktop app — created by **nullvexity**.

Open any URL in any browser installed on your PC. Comes with detection for Chrome, Firefox, Edge, Brave, Opera, Opera GX, Vivaldi, Arc, Zen, LibreWolf, Tor, Safari, Yandex, and Chromium across **Windows, macOS, and Linux**.

## Features

- Real installed-browser detection (no hardcoded lists)
- Sharp red cyber UI, JetBrains Mono font, no scanlines/grain
- 3D button hover/click effects on the primary action
- Collapsible history of opened sites — each entry has its own per-row browser selector so you can re-open in any browser
- Pure local app — no telemetry, no network calls beyond opening the URL you typed

## Run from source

Requires Node.js 18+.

```bash
cd desktop
npm install
npm start
```

## Build a distributable

```bash
cd desktop
npm install

# Windows installer (.exe via NSIS)
npm run build:win

# macOS .dmg
npm run build:mac

# Linux AppImage
npm run build:linux
```

Output goes to `desktop/dist/`.

## How browser detection works

- **Windows** — reads `HKLM/HKCU\Software\Clients\StartMenuInternet` and falls back to common install paths in `Program Files` and `AppData/Local/Programs`.
- **macOS** — checks `/Applications` for known browser bundles.
- **Linux** — uses `which` on common browser binary names.

Opening URLs uses `child_process.spawn` with the detected executable path.

## Files

```
desktop/
├── main.js        Electron main process + browser detection + IPC
├── preload.js     contextBridge (secure IPC surface)
├── index.html     Renderer markup
├── styles.css     UI styles
├── renderer.js    Renderer logic
├── package.json   Electron + electron-builder config
└── README.md
```

—
nullvexity · v1.0.0
