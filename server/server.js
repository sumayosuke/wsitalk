// =========================================================
// server.js（最適化版・正規表現マッチ方式）
// =========================================================

const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const LOG_PARENT = "logs";
const MSG_PARENT = "messages";

const port = process.argv[2] ? Number(process.argv[2]) : 8080;
const wss = new WebSocket.Server({ port });

console.log(`WebSocket server running on ws://localhost:${port}`);

let cachedLogPath = null;
let cachedDateStr = null;
let nextUserId = 1;

// =========================================================
// 共通ユーティリティ
// =========================================================

const timestamp = () => new Date().toTimeString().split(" ")[0];

const formatDateTime = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;

const formatDuration = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h${m}m${s}s`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
};

// =========================================================
// ファイルパス生成（共通化）
// =========================================================

function filePath(type, handle) {
  const dir = path.join(MSG_PARENT, String(port));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${encodeURIComponent(handle)}.${type}`);
}

// =========================================================
// ログ処理
// =========================================================

function getLogFilePath() {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(
    2,
    "0"
  )}${String(now.getDate()).padStart(2, "0")}`;

  if (cachedDateStr === ymd) return cachedLogPath;

  const dir = path.join(LOG_PARENT, String(port));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  cachedLogPath = path.join(dir, `${ymd}.italk`);
  cachedDateStr = ymd;

  return cachedLogPath;
}

function broadcast(text) {
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(text);
  });
  fs.appendFileSync(getLogFilePath(), text + "\n");
}

function sendRecentLog(ws, num) {
  const file = getLogFilePath();
  if (!fs.existsSync(file)) return;

  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  lines.slice(-num).forEach((line) => ws.send(line));
}

// =========================================================
// アナウンス・伝言処理
// =========================================================

function replayAllAnnounce(ws, prevLogout) {
  const dir = path.join(MSG_PARENT, String(port));
  if (!fs.existsSync(dir)) return;

  const prev = new Date(prevLogout);

  fs.readdirSync(dir)
    .filter((f) => f.endsWith(".ann"))
    .forEach((file) => {
      const sender = decodeURIComponent(file.replace(".ann", ""));
      const content = fs.readFileSync(path.join(dir, file), "utf8").trim();
      if (!content) return;

      const m = content.match(/^

\[(.*?)\]

/);
      if (!m) return;

      const time = new Date(m[1]);
      if (time > prev) ws.send(`(アナウンス) ${sender} ${content}`);
    });
}

function replayMessages(handle) {
  const file = filePath("msg", handle);
  if (!fs.existsSync(file)) return;

  fs.readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .forEach((line) =>
      broadcast(`[${timestamp()}] (伝言) ${handle} 宛: ${line}`)
    );

  fs.unlinkSync(file);
}

function replayUMessages(handle, ws) {
  const file = filePath("umsg", handle);
  if (!fs.existsSync(file)) return;

  fs.readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .forEach((line) => ws.send(`(裏伝言) ${line}`));

  fs.unlinkSync(file);
}

// =========================================================
// ログイン処理（関数化）
// =========================================================

function handleLogin(ws, raw) {
  ws.handle = raw || "匿名";
  ws.id = nextUserId++;
  ws.loginTime = formatDateTime();
  ws.lastActive = Date.now();

  const utmp = filePath("utmp", ws.handle);
  if (fs.existsSync(utmp)) {
    const prev = fs.readFileSync(utmp, "utf8").trim();
    ws.send(`前回ログアウト時刻: ${prev}`);
    replayAllAnnounce(ws, prev);
    fs.unlinkSync(utmp);
  }

  broadcast(`[${timestamp()}] *** ${ws.handle} が入室しました ***`);

  sendRecentLog(ws, 10);
  replayMessages(ws.handle);
  replayUMessages(ws.handle, ws);

  ws.send("コマンド一覧は /? で表示できます");
}
// =========================================================
// コマンド処理関数（1つずつ独立した関数として定義）
// =========================================================

// ① /w 在室者一覧
function cmdW(ws) {
  const now = Date.now();
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN && c.handle) {
      const idStr = String(c.id).padStart(4, "0");
      const diffSec = Math.floor((now - c.lastActive) / 1000);
      ws.send(`${idStr} ${c.handle} ${c.loginTime} ${formatDuration(diffSec)}`);
    }
  });
}

// ② /rN ログの最後N行
function cmdR(ws, num) {
  if (isNaN(num) || num <= 0) {
    ws.send("[/r{行数}] の形式で指定してください");
    return;
  }
  sendRecentLog(ws, num);
}

// ③ /rn 前回ログアウト以降のログ
function cmdRn(ws) {
  const utmp = filePath("utmp", ws.handle);
  if (!fs.existsSync(utmp)) {
    ws.send("前回ログアウト時刻が記録されていません");
    return;
  }

  const prev = new Date(fs.readFileSync(utmp, "utf8").trim());
  const today = new Date();
  let cur = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate());

  while (cur <= today) {
    const ymd = `${cur.getFullYear()}${String(cur.getMonth() + 1).padStart(
      2,
      "0"
    )}${String(cur.getDate()).padStart(2, "0")}`;

    const logFile = path.join(LOG_PARENT, String(port), `${ymd}.italk`);
    if (fs.existsSync(logFile)) {
      const lines = fs.readFileSync(logFile, "utf8").trim().split("\n");
      let sending = false;

      lines.forEach((line) => {
        const m = line.match(/^

\[(\d\d):(\d\d):(\d\d)\]

/);
        if (m && !sending) {
          const lineDate = new Date(
            cur.getFullYear(),
            cur.getMonth(),
            cur.getDate(),
            parseInt(m[1], 10),
            parseInt(m[2], 10),
            parseInt(m[3], 10)
          );
          if (lineDate >= prev) sending = true;
        }
        if (sending) ws.send(line);
      });
    }

    cur.setDate(cur.getDate() + 1);
  }
}

// ④ /p ID msg 個別チャット
function cmdP(ws, id, message) {
  const targetId = parseInt(id, 10);
  const target = [...wss.clients].find((c) => c.id === targetId);

  if (!target) {
    ws.send(`ID ${id} のユーザーは見つかりません`);
    return;
  }

  const time = timestamp();
  ws.send(`[${time}] (p) → ${target.handle}: ${message}`);
  target.send(`[${time}] (p) ${ws.handle} → あなた: ${message}`);
  ws.lastActive = Date.now();
}

// ⑤ /m msg>>handle 裏伝言
function cmdM(ws, msg, targetHandle) {
  fs.appendFileSync(filePath("umsg", targetHandle), `${ws.handle}: ${msg}\n`);
  ws.send(`裏伝言を ${targetHandle} に預かりました`);
}

// ⑥ /a msg アナウンス発信
function cmdAWrite(ws, msg) {
  broadcast(`[${timestamp()}] (アナウンス) ${ws.handle}: ${msg}`);
  fs.writeFileSync(filePath("ann", ws.handle), `[${formatDateTime()}] ${msg}`);
}

// ⑦ /a アナウンス削除
function cmdADelete(ws) {
  const file = filePath("ann", ws.handle);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    broadcast(`[${timestamp()}] *** ${ws.handle} のアナウンスが削除されました ***`);
  }
}

// ⑧ /al アナウンス一覧
function cmdAl(ws) {
  const dir = path.join(MSG_PARENT, String(port));
  if (!fs.existsSync(dir)) {
    ws.send("(アナウンス一覧) 現在アナウンスはありません");
    return;
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ann"));
  if (files.length === 0) {
    ws.send("(アナウンス一覧) 現在アナウンスはありません");
    return;
  }

  ws.send("(アナウンス一覧)");
  files.forEach((file) => {
    const sender = decodeURIComponent(file.replace(".ann", ""));
    const content = fs.readFileSync(path.join(dir, file), "utf8").trim();
    if (content) ws.send(`${sender} ${content}`);
  });
}

// ⑨ /h name ハンドル変更
function cmdH(ws, newHandle) {
  const oldHandle = ws.handle;
  ws.handle = newHandle;

  broadcast(`[${timestamp()}] *** ${oldHandle} はハンドルを ${newHandle} に変更しました ***`);

  replayMessages(newHandle);
  replayUMessages(newHandle, ws);
}

// ⑩ /q /l ログアウト
function cmdQuit(ws) {
  fs.writeFileSync(filePath("utmp", ws.handle), formatDateTime());
  ws.isLogout = true;
  ws.close();
}

// ⑪ /? コマンド一覧
function cmdHelp(ws) {
  ws.send("(コマンド一覧)");
  ws.send("/w        : 在室者一覧");
  ws.send("/rN       : ログの最後N行");
  ws.send("/rn       : 前回ログアウト以降のログ");
  ws.send("/p ID msg : 個別チャット");
  ws.send("/m msg>>h : 裏伝言");
  ws.send("/a {msg}  : アナウンス発信");
  ws.send("/a        : 自分のアナウンス削除");
  ws.send("/al       : アナウンス一覧表示");
  ws.send("/h {name} : ハンドル名変更");
  ws.send("/q /l     : ログアウト");
  ws.send("/?        : この一覧を表示");
}

// =========================================================
// 正規表現コマンドテーブル
// =========================================================

const commandTable = [
  { pattern: /^\/w$/, handler: (ws) => cmdW(ws) },
  { pattern: /^\/r(\d+)$/, handler: (ws, m) => cmdR(ws, parseInt(m[1], 10)) },
  { pattern: /^\/rn$/, handler: (ws) => cmdRn(ws) },
  { pattern: /^\/p (\d+) (.+)$/, handler: (ws, m) => cmdP(ws, m[1], m[2]) },
  { pattern: /^\/m (.+)>>(.+)$/, handler: (ws, m) => cmdM(ws, m[1], m[2]) },
  { pattern: /^\/a (.+)$/, handler: (ws, m) => cmdAWrite(ws, m[1]) },
  { pattern: /^\/a$/, handler: (ws) => cmdADelete(ws) },
  { pattern: /^\/al$/, handler: (ws) => cmdAl(ws) },
  { pattern: /^\/h (.+)$/, handler: (ws, m) => cmdH(ws, m[1]) },
  { pattern: /^\/q$/, handler: (ws) => cmdQuit(ws) },
  { pattern: /^\/l$/, handler: (ws) => cmdQuit(ws) },
  { pattern: /^\/\?$/, handler: (ws) => cmdHelp(ws) },
];

// =========================================================
// WebSocket メッセージ処理
// =========================================================

wss.on("connection", (ws) => {
  ws.handle = null;
  ws.id = null;
  ws.isLogout = false;

  ws.on("message", (data) => {
    const raw = data.toString().trim();

    // ログイン処理
    if (ws.handle === null) {
      handleLogin(ws, raw);
      return;
    }

    // コマンドテーブルで処理
    for (const entry of commandTable) {
      const m = raw.match(entry.pattern);
      if (m) {
        entry.handler(ws, m);
        return;
      }
    }

    // 通常発言
    broadcast(`[${timestamp()}] ${ws.handle}: ${raw}`);
    ws.lastActive = Date.now();

    // 通常伝言
    if (raw.includes(">>")) {
      const [body, targetHandle] = raw.split(">>");
      if (body && targetHandle) {
        fs.appendFileSync(filePath("msg", targetHandle), `${ws.handle}: ${body}\n`);
        ws.send(`伝言を ${targetHandle} に預かりました`);
      }
    }
  });

  // 接続終了処理
  ws.on("close", () => {
    if (ws.handle) {
      const msg = ws.isLogout
        ? `*** ${ws.handle} がログアウトしました ***`
        : `*** ${ws.handle} の接続が切れました ***`;
      broadcast(`[${timestamp()}] ${msg}`);
    }
  });
});
