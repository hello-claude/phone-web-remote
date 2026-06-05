# Phone Web Remote

Turn your **phone's browser** into a remote for your Mac / Windows PC: trackpad + custom macro buttons + arrow keys / Enter + voice input.
Runs over **Wi-Fi LAN** (not Bluetooth), works on iOS / Android, **nothing to install on the phone**.

> **Languages:** English | [中文](README.zh-CN.md)

## Install

```bash
git clone https://github.com/hello-claude/phone-web-remote.git
cd phone-web-remote
npm install
```

> `npm install` pulls in `@nut-tree-fork/nut-js` (a native mouse/keyboard module). If it fails to build,
> see "If nut.js won't install" at the bottom.

## Run

```bash
npm start
```

**Or one-click:** double-click `start.command` (macOS) or `start.bat` (Windows) in the project folder. It auto-runs `npm install` on first launch, then starts the server (no terminal commands to type).

The terminal prints something like:

```
Pairing PIN (changes on every launch): 7421
Open one of these URLs in your phone's browser (phone must be on the same Wi-Fi as the host):
   http://192.168.1.23:8765
```

Join the same Wi-Fi on your phone, open that URL in the browser, enter the PIN, and you're in.

## Platform support

The server runs on **macOS or Windows** (the phone side is always just a browser, OS-agnostic). Non-ASCII text
(Chinese / emoji, etc.) is injected via "write to the system clipboard + simulate paste": macOS uses `pbcopy` + ⌘V,
Windows uses PowerShell `Set-Clipboard` + Ctrl+V.

## First-time setup (macOS only): grant Accessibility

macOS won't let a program simulate the keyboard/mouse by default. The first injection fails until you:

**System Settings → Privacy & Security → Accessibility** → turn it on and tick **the program that runs this server**
(running in Terminal → tick Terminal; in the VSCode integrated terminal → tick Visual Studio Code; you may also
need to tick `node`). Then restart `npm start`.

> **Windows** generally needs no such grant; for the rare app running elevated, start this server as Administrator too.

## Interface (landscape)

```
┌───────────────────────────┬──────────────────────────────┐
│ [/compact][/clear][cont.] │                              │
│ [/review][yes y][no n]    │                              │
├───────────────────────────┤         Trackpad area        │
│   [⌫]  [↑]  [↵]           │   slide = move · tap = left  │
│   [←]  [↓]  [→]           │  two-finger tap = right ·    │
├───────────────────────────┤  two-finger slide = scroll   │
│ [text / voice input][send]│                              │
└───────────────────────────┴──────────────────────────────┘
      Left: keyboard panel            Right: trackpad (right hand)
```

The keypad mimics a keyboard/gamepad: arrows form a D-pad, with ⌫ (delete) and ↵ (enter) as colored action keys.

- **Macro buttons**: tap to type the preset text into whatever field is focused on the Mac/PC. **Long-press a button**
  to edit its label and payload (saved to `config.json`, synced to every connected phone). Tapping an empty slot creates one.
- **Arrow keys / ↵**: quickly pick options from Claude's prompts.
- **⌫ Delete**: backspace (delete the character to the left).
- **Voice / text input**: tap the input bar to bring up the phone keyboard, then tap its microphone to dictate (iOS uses
  Siri dictation, Android uses the IME's). The recognized text lands in the bar; tap "send" to type it on the Mac/PC. You can also just type.

## Default macro buttons

See `config.json`; edit directly (or long-press to edit on the phone):

| Label | Payload |
|---|---|
| /compact | /compact |
| /clear | /clear |
| 继续 (continue) | 继续 |
| /review | /review |
| 是 y (yes) | y |
| 否 n (no) | n |

## Security

- Control requires a **4-digit PIN** on the LAN (randomly generated each launch, printed to the terminal). Use only on trusted Wi-Fi.

## If nut.js won't install (fallback)

`@nut-tree-fork/nut-js` is a native module and fails to build in some environments. Fallback (macOS):
1. `brew install cliclick`
2. Replace the mouse/keyboard injection in `server.js` with shell calls to `cliclick` (mouse/keys) and `osascript` (typing).
   (This is the second choice; continuous trackpad movement via cliclick has per-call subprocess overhead and feels laggy — fix nut.js first.)

## Port

Defaults to `8765`; override with an env var: `PORT=9000 npm start`.

## License

[MIT](LICENSE) © 2026 hello-claude.
