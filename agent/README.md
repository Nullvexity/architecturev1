# ArchitectureV1 Agent

Background companion app for [ArchitectureV1](../desktop/). Run it on any PC and that PC will appear inside ArchitectureV1 — letting you open sites and view its screen remotely.

## What it does

- Registers this PC with the ArchitectureV1 relay (over WebSocket)
- Detects installed browsers and reports them
- Receives `open URL in browser X` commands and executes them locally
- Streams 1 frame/sec screenshots when ArchitectureV1 is viewing this PC

It does **not** install drivers, capture keystrokes, log activity, or open any local network port — it is an outbound-only WebSocket client.

## Install

Requires Node.js 18+ on the target PC.

```bash
cd agent
npm install
```

## Run silently

### Windows (recommended)
1. Double-click **`start-silent.vbs`** — the agent starts hidden (no console window).
2. To verify it's running, open Task Manager → Details → look for `node.exe`.

To start the agent automatically every login, double-click **`install-startup.bat`** (one-time setup).

To stop the agent, end the `node.exe` task in Task Manager.

### macOS / Linux
```bash
nohup node agent.js > /dev/null 2>&1 &
```
This runs the agent in the background and detaches it from the terminal.

For a clean foreground run:
```bash
node agent.js
```

## Configuration

Two environment variables are supported:

| Variable | Default | Notes |
|---|---|---|
| `ARCH_SERVER_URL` | preview URL embedded in `agent.js` | Override to point at your own relay |
| `ARCH_FRAME_MS` | `1500` | Milliseconds between screen frames while streaming |
| `ARCH_DEBUG` | unset | Set to `1` to print connection logs to stdout |

You can also edit `config.json`:

```json
{
  "serverUrl": "http://127.0.0.1:8000"
}
```

Run `start-debug.bat` if the PC does not appear in the desktop app; it shows the exact relay connection error.

Example (Windows, set for current session before launching):
```cmd
set ARCH_SERVER_URL=https://your-server.example.com
set ARCH_DEBUG=1
node agent.js
```

## How identity works

On first run the agent generates a random 16-character ID and saves it to:
- Windows: `%USERPROFILE%\.architecturev1-agent-id`
- macOS / Linux: `~/.architecturev1-agent-id`

That ID + your machine's hostname is how ArchitectureV1 lists this PC. Delete the file to get a fresh ID.

## Files

```
agent/
├── agent.js              Main agent (WebSocket client, screen capture, command exec)
├── browsers.js           Browser detection (same logic as ArchitectureV1)
├── start-silent.vbs      Windows hidden launcher
├── install-startup.bat   Adds autostart entry on Windows
├── package.json
└── README.md
```
