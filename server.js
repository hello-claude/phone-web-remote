'use strict';

// 手机遥控器 — Mac 服务端
// 职责:① 用 http 把遥控器网页发给手机;② 用 ws 收手机指令;③ 用 nut.js 把指令变成真实键鼠操作。
// 需在「系统设置 → 隐私与安全性 → 辅助功能」里授权运行它的终端 / Node,否则键鼠注入会报错。

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { WebSocketServer } = require('ws');
const { mouse, keyboard, Key, Button, Point } = require('@nut-tree-fork/nut-js');

const PORT = Number(process.env.PORT) || 8765;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CONFIG_PATH = path.join(__dirname, 'config.json');

// 配对 PIN:每次启动随机生成 4 位,不落盘(进程重启即失效)。
const PIN = String(Math.floor(1000 + Math.random() * 9000));

// nut.js:去掉按键间默认延迟,打字更跟手。
keyboard.config.autoDelayMs = 0;

// 方向键/回车等命名键 → nut.js 的 Key 枚举
const KEY_MAP = {
  Up: Key.Up,
  Down: Key.Down,
  Left: Key.Left,
  Right: Key.Right,
  Enter: Key.Enter,
  Escape: Key.Escape,
  Tab: Key.Tab,
  Backspace: Key.Backspace,
};

// ---------- 文本注入(Unicode 安全,跨平台)----------
// nut.js 的 keyboard.type() 模拟物理键位,打不出中文/emoji 等非 ASCII 字符(无对应键位)。
// 解决:纯 ASCII 仍走 keyboard.type()(快、不动剪贴板);含非 ASCII → 写系统剪贴板 + 模拟粘贴热键,
// 粘贴后再把旧剪贴板还原(尽力而为)。
// 平台差异:剪贴板命令 macOS=pbcopy/pbpaste、Windows=PowerShell Set/Get-Clipboard;
//           粘贴热键 macOS=⌘V、Windows=Ctrl+V。
const PLATFORM = process.platform;

// 写系统剪贴板(UTF-8)
function clipCopy(text) {
  if (PLATFORM === 'darwin') {
    return new Promise((resolve, reject) => {
      const p = execFile('pbcopy', (err) => (err ? reject(err) : resolve()));
      p.stdin.end(text, 'utf8');
    });
  }
  if (PLATFORM === 'win32') {
    // 经 stdin 喂给 PowerShell;先把输入编码设为 UTF-8 再 ReadToEnd,避免中文乱码
    return new Promise((resolve, reject) => {
      // -STA:剪贴板 OLE 需单线程套间;PowerShell 5.1 默认 STA,显式钉死以免 apartment 报错
      const p = execFile('powershell', ['-NoProfile', '-NonInteractive', '-STA', '-Command',
        '[Console]::InputEncoding=[System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())'],
        (err) => (err ? reject(err) : resolve()));
      p.stdin.end(text, 'utf8');
    });
  }
  return Promise.reject(new Error(`中文输入暂不支持该平台: ${PLATFORM}(仅 macOS / Windows)`));
}

// 读系统剪贴板(UTF-8);仅用于粘贴后还原,失败可忽略
function clipPaste() {
  if (PLATFORM === 'darwin') {
    return new Promise((resolve, reject) => {
      execFile('pbpaste', { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
        (err, out) => (err ? reject(err) : resolve(out)));
    });
  }
  if (PLATFORM === 'win32') {
    return new Promise((resolve, reject) => {
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-STA', '-Command',
        '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $t=Get-Clipboard -Raw; if($null -ne $t){[Console]::Out.Write($t)}'],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
        (err, out) => (err ? reject(err) : resolve(out)));
    });
  }
  return Promise.reject(new Error(`unsupported platform: ${PLATFORM}`));
}

// 粘贴热键修饰键:macOS=⌘(Key.LeftSuper),Windows=Ctrl(Key.LeftControl)。
// ⚠ macOS 经实测:darwin 原生二进制只认 "meta"(=Key.LeftSuper=⌘),不认 "cmd"(=Key.LeftCmd),勿改 LeftCmd。
const PASTE_MODIFIER = (PLATFORM === 'darwin') ? Key.LeftSuper : Key.LeftControl;

async function injectText(text) {
  // 纯 ASCII(含控制字符):物理按键直接打,跟手且不污染剪贴板
  if (/^[\x00-\x7F]*$/.test(text)) {
    await keyboard.type(text);
    return;
  }
  // 含中文/emoji 等:剪贴板 + 粘贴热键
  let prev = null;
  try { prev = await clipPaste(); } catch (e) { /* 读不到旧剪贴板就不还原 */ }
  await clipCopy(text);
  await keyboard.pressKey(PASTE_MODIFIER);
  await keyboard.pressKey(Key.V);
  await keyboard.releaseKey(Key.V);
  await keyboard.releaseKey(PASTE_MODIFIER);
  // 还原旧剪贴板:延后到粘贴消费完之后(尽力而为,失败静默)
  if (prev !== null) {
    setTimeout(() => { clipCopy(prev).catch(() => {}); }, 300);
  }
}

// ---------- 宏配置读写 ----------
function loadConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!Array.isArray(cfg.macros)) cfg.macros = [];
    return cfg;
  } catch (e) {
    return { macros: [] };
  }
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}
let config = loadConfig();

// ---------- HTTP:发送 public/ 下的静态文件 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, rel);
  // 目录穿越防护:解析后必须仍在 PUBLIC_DIR 内
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- WebSocket:收指令 → 注入键鼠 ----------
const wss = new WebSocketServer({ server });
const authed = new WeakSet(); // 已通过 PIN 校验的连接

// 防 PIN 暴力破解:按来源 IP 记失败次数,连错 MAX_FAILS 次锁定 BLOCK_MS 毫秒。
const MAX_FAILS = 5;
const BLOCK_MS = 60 * 1000;
const authFails = new Map(); // ip -> { count, until }

function broadcastMacros() {
  const payload = JSON.stringify({ type: 'macros', list: config.macros });
  wss.clients.forEach((c) => {
    if (authed.has(c) && c.readyState === 1) c.send(payload);
  });
}

wss.on('connection', (ws, req) => {
  const ip = (req && req.socket && req.socket.remoteAddress) || 'unknown';
  const held = new Set(); // 本连接当前按住未松的鼠标键(防断线卡键)

  ws.on('close', async () => {
    // 断线兜底:松开这条连接还按着的所有鼠标键,避免左键永久卡在按下
    for (const b of held) {
      try { await mouse.releaseButton(b === 'right' ? Button.RIGHT : Button.LEFT); } catch (e) {}
    }
    held.clear();
  });

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // 非法 JSON,忽略
    }

    // 鉴权:除 auth 外,未通过校验的连接一律忽略
    if (msg.type === 'auth') {
      const rec = authFails.get(ip);
      if (rec && rec.until > Date.now()) {
        // 该 IP 正在锁定期
        ws.send(JSON.stringify({ type: 'authFail', blocked: true }));
        ws.close();
        return;
      }
      if (String(msg.pin) === PIN) {
        authFails.delete(ip);
        authed.add(ws);
        ws.send(JSON.stringify({ type: 'authOk' }));
        ws.send(JSON.stringify({ type: 'macros', list: config.macros }));
      } else {
        const r = authFails.get(ip) || { count: 0, until: 0 };
        r.count += 1;
        if (r.count >= MAX_FAILS) {
          r.until = Date.now() + BLOCK_MS;
          r.count = 0;
          console.warn('[安全] IP ' + ip + ' 连错 PIN 次数过多,锁定 ' + BLOCK_MS / 1000 + ' 秒');
        }
        authFails.set(ip, r);
        ws.send(JSON.stringify({ type: 'authFail' }));
      }
      return;
    }
    if (!authed.has(ws)) return;

    try {
      switch (msg.type) {
        case 'move': {
          // 相对移动:取当前光标位置 + 位移
          const dx = Number(msg.dx) || 0;
          const dy = Number(msg.dy) || 0;
          if (dx === 0 && dy === 0) break;
          const pos = await mouse.getPosition();
          await mouse.setPosition(new Point(Math.round(pos.x + dx), Math.round(pos.y + dy)));
          break;
        }
        case 'click':
          if (msg.button === 'right') await mouse.rightClick();
          else await mouse.leftClick();
          break;
        case 'mousedown':
          // 按下不抬(配合触控板移动 = 拖拽)
          await mouse.pressButton(msg.button === 'right' ? Button.RIGHT : Button.LEFT);
          held.add(msg.button === 'right' ? 'right' : 'left');
          break;
        case 'mouseup':
          await mouse.releaseButton(msg.button === 'right' ? Button.RIGHT : Button.LEFT);
          held.delete(msg.button === 'right' ? 'right' : 'left');
          break;
        case 'scroll': {
          const dy = Math.round(Number(msg.dy) || 0);
          if (dy === 0) break;
          if (dy > 0) await mouse.scrollDown(dy);
          else await mouse.scrollUp(-dy);
          break;
        }
        case 'type':
          if (typeof msg.text === 'string' && msg.text.length) {
            await injectText(msg.text);
          }
          break;
        case 'key': {
          // 命名键(方向键/回车等)必须用 pressKey/releaseKey 真正"敲一下",
          // 不能用 keyboard.type():type 对 Enter/Tab/Backspace 等控制键行为不可靠。
          const k = KEY_MAP[msg.key];
          if (k !== undefined) {
            await keyboard.pressKey(k);
            await keyboard.releaseKey(k);
          }
          break;
        }
        case 'setMacro': {
          const i = msg.index;
          if (Number.isInteger(i) && i >= 0 && i < 6) { // 与前端 6 个槽位对齐
            config.macros[i] = {
              label: String(msg.label || ''),
              payload: String(msg.payload || ''),
            };
            saveConfig(config);
            broadcastMacros();
          }
          break;
        }
      }
    } catch (e) {
      // 注入失败(最常见:没给"辅助功能"权限)→ 回报给手机提示
      ws.send(JSON.stringify({ type: 'error', message: String((e && e.message) || e) }));
    }
  });
});

// ---------- 启动:打印 PIN + 局域网网址 ----------
function getLanIPs() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
    }
  }
  return ips;
}

server.listen(PORT, () => {
  const ips = getLanIPs();
  console.log('\n================ 手机遥控器已启动 ================');
  console.log('配对 PIN(每次启动都会变): ' + PIN);
  console.log('手机浏览器打开下面任一网址(手机要和 Mac 在同一 WiFi):');
  if (ips.length) ips.forEach((ip) => console.log('   http://' + ip + ':' + PORT));
  else console.log('   (没找到局域网 IP,检查 Mac 的 WiFi 连接)');
  console.log('\n首次使用请授权:系统设置 → 隐私与安全性 → 辅助功能,');
  console.log('勾选运行本程序的终端(如 Terminal / iTerm / VSCode)或 node。');
  console.log('==================================================\n');
});
