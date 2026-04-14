const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// 🔥 親ディレクトリ（ログ）
const LOG_PARENT = "logs";

// 🔥 親ディレクトリ（伝言 + utmp + umsg + ann）
const MSG_PARENT = "messages";

const port = process.argv[2] ? Number(process.argv[2]) : 8080;
const wss = new WebSocket.Server({ port });

console.log(`WebSocket server running on ws://localhost:${port}`);

// 🔥 ログパスキャッシュ
let cachedLogPath = null;
let cachedDateStr = null;

// 🔥 ログイン順 ID カウンタ
let nextUserId = 1;

// 🔥 ログファイルパスを生成（キャッシュ対応）
function getLogFilePath() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");

  const dateStr = `${yyyy}${mm}${dd}`;

  if (cachedDateStr === dateStr) {
    return cachedLogPath;
  }

  const dir = path.join(LOG_PARENT, String(port));
  const file = path.join(dir, `${dateStr}.italk`);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  cachedLogPath = file;
  cachedDateStr = dateStr;

  return file;
}

// タイムスタンプ生成（ログ用）
function timestamp() {
  const d = new Date();
  return d.toTimeString().split(' ')[0];
}

// 🔥 日時（YYYY-MM-DD HH:MM:SS）
function formatDateTime(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

// 🔥 経過時間（秒 → 12h23m45s）
function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;

  if (h > 0) return `${h}h${m}m${s}s`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

// 🔥 YYYYMMDD → Date
function parseDateYMD(ymd) {
  const y = parseInt(ymd.slice(0,4), 10);
  const m = parseInt(ymd.slice(4,6), 10) - 1;
  const d = parseInt(ymd.slice(6,8), 10);
  return new Date(y, m, d);
}

// 🔥 Date → YYYYMMDD
function formatYMD(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

// broadcast は「送信＋ログ保存」だけの純粋な処理
function broadcast(text) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(text);
    }
  });

  const logFile = getLogFilePath();
  fs.appendFileSync(logFile, text + "\n");
}

// 🔥 ログ取得処理（共通化）
function sendRecentLog(ws, num) {
  const logFile = getLogFilePath();

  if (!fs.existsSync(logFile)) return;

  const content = fs.readFileSync(logFile, "utf8");
  const lines = content.trim().split("\n");
  const recent = lines.slice(-num);

  recent.forEach(line => {
    ws.send(line);
  });
}

// 🔥 各種ファイルパス
function getMessageFilePath(handle) {
  const dir = path.join(MSG_PARENT, String(port));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${encodeURIComponent(handle)}.msg`);
}

function getUMessageFilePath(handle) {
  const dir = path.join(MSG_PARENT, String(port));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${encodeURIComponent(handle)}.umsg`);
}

function getUtmpFilePath(handle) {
  const dir = path.join(MSG_PARENT, String(port));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${encodeURIComponent(handle)}.utmp`);
}

function getAnnFilePath(handle) {
  const dir = path.join(MSG_PARENT, String(port));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${encodeURIComponent(handle)}.ann`);
}

// 🔥 保存処理
function saveMessage(targetHandle, message) {
  fs.appendFileSync(getMessageFilePath(targetHandle), message + "\n");
}

function saveUMessage(targetHandle, message) {
  fs.appendFileSync(getUMessageFilePath(targetHandle), message + "\n");
}

function saveLogoutTime(handle, time) {
  fs.writeFileSync(getUtmpFilePath(handle), time);
}

function loadLogoutTime(handle) {
  const file = getUtmpFilePath(handle);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8").trim();
}

// 🔥 アナウンス再生（全ユーザーの .ann をチェック）
function replayAllAnnounce(ws, prevLogout) {
  const dir = path.join(MSG_PARENT, String(port));
  if (!fs.existsSync(dir)) return;

  const prev = new Date(prevLogout);
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    if (!file.endsWith(".ann")) return;

    const sender = decodeURIComponent(file.replace(".ann", ""));
    const full = path.join(dir, file);

    const content = fs.readFileSync(full, "utf8").trim();
    if (!content) return;

    // content は "[日時] 内容"
    const m = content.match(/^

\[(.*?)\]

 (.*)$/);
    if (!m) return;

    const time = new Date(m[1]);

    if (time > prev) {
      ws.send(`(アナウンス) ${sender} ${content}`);
    }
  });
}

// 🔥 通常伝言再生
function replayMessages(handle) {
  const file = getMessageFilePath(handle);
  if (!fs.existsSync(file)) return;

  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  lines.forEach(line => {
    broadcast(`[${timestamp()}] (伝言) ${handle} 宛: ${line}`);
  });

  fs.unlinkSync(file);
}

// 🔥 裏伝言再生
function replayUMessages(handle, ws) {
  const file = getUMessageFilePath(handle);
  if (!fs.existsSync(file)) return;

  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  lines.forEach(line => {
    ws.send(`(裏伝言) ${line}`);
  });

  fs.unlinkSync(file);
}

wss.on('connection', (ws) => {
  ws.handle = null;
  ws.id = null;
  ws.isLogout = false;

  ws.loginTime = null;
  ws.lastActive = null;

  ws.on('message', (data) => {
    const raw = data.toString().trim();

    // -------------------------
    // 🔥 ログイン処理
    // -------------------------
    if (ws.handle === null) {
      ws.handle = raw || "匿名";
      ws.id = nextUserId++;

      ws.loginTime = formatDateTime();
      ws.lastActive = Date.now();

      const prevLogout = loadLogoutTime(ws.handle);
      if (prevLogout) {
        ws.send(`前回ログアウト時刻: ${prevLogout}`);

        // 🔥 全ユーザーのアナウンスをチェック
        replayAllAnnounce(ws, prevLogout);

        fs.unlinkSync(getUtmpFilePath(ws.handle));
      }

      broadcast(`[${timestamp()}] *** ${ws.handle} が入室しました ***`);

      sendRecentLog(ws, 10);

      replayMessages(ws.handle);
      replayUMessages(ws.handle, ws);

      return;
    }

    // -------------------------
    // 🔥 /al アナウンス一覧（先に判定）
    // -------------------------
    if (raw === "/al") {
      const dir = path.join(MSG_PARENT, String(port));

      if (!fs.existsSync(dir)) {
        ws.send("(アナウンス一覧) 現在アナウンスはありません");
        return;
      }

      const files = fs.readdirSync(dir).filter(f => f.endsWith(".ann"));

      if (files.length === 0) {
        ws.send("(アナウンス一覧) 現在アナウンスはありません");
        return;
      }

      ws.send("(アナウンス一覧)");

      files.forEach(file => {
        const sender = decodeURIComponent(file.replace(".ann", ""));
        const full = path.join(dir, file);

        const content = fs.readFileSync(full, "utf8").trim();
        if (!content) return;

        ws.send(`${sender} ${content}`);
      });

      return;
    }

    // -------------------------
    // 🔥 /a アナウンス（削除 or 発信）
    // -------------------------
    if (raw === "/a") {
      const file = getAnnFilePath(ws.handle);

      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        broadcast(`[${timestamp()}] *** ${ws.handle} のアナウンスが削除されました ***`);
      }

      return;
    }

    if (raw.startsWith("/a ")) {
      const ann = raw.slice(3).trim();
      if (!ann) {
        ws.send("[/a {アナウンス}] の形式で指定してください");
        return;
      }

      broadcast(`[${timestamp()}] (アナウンス) ${ws.handle}: ${ann}`);

      fs.writeFileSync(getAnnFilePath(ws.handle), `[${formatDateTime()}] ${ann}`);

      return;
    }

    // -------------------------
    // 🔥 /h ハンドル変更
    // -------------------------
    if (raw.startsWith("/h ")) {
      const newHandle = raw.slice(3).trim();
      if (!newHandle) {
        ws.send("[/h {新ハンドル}] の形式で指定してください");
        return;
      }

      const oldHandle = ws.handle;
      ws.handle = newHandle;

      broadcast(`[${timestamp()}] *** ${oldHandle} はハンドルを ${newHandle} に変更しました ***`);

      replayMessages(newHandle);
      replayUMessages(newHandle, ws);

      return;
    }

    // -------------------------
    // 🔥 /m 裏伝言
    // -------------------------
    if (raw.startsWith("/m ") && raw.includes(">>")) {
      const body = raw.slice(3);
      const [message, targetHandle] = body.split(">>");

      if (!message || !targetHandle) {
        ws.send("[/m {message}>>{handle}] の形式で指定してください");
        return;
      }

      saveUMessage(targetHandle, `${ws.handle}: ${message}`);
      ws.send(`裏伝言を ${targetHandle} に預かりました`);

      return;
    }

    // -------------------------
    // 🔥 /w
    // -------------------------
    if (raw === "/w") {
      const now = Date.now();
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.handle) {
          const idStr = String(client.id).padStart(4, "0");
          const logintime = client.loginTime;
          const diffSec = Math.floor((now - client.lastActive) / 1000);
          const elapsed = formatDuration(diffSec);
          ws.send(`${idStr} ${client.handle} ${logintime} ${elapsed}`);
        }
      });
      return;
    }

    // -------------------------
    // 🔥 /p 個別チャット
    // -------------------------
    if (raw.startsWith("/p ")) {
      const parts = raw.split(" ");
      if (parts.length < 3) {
        ws.send("[/p {ID} {message}] の形式で指定してください");
        return;
      }

      const targetId = parseInt(parts[1], 10);
      const message = parts.slice(2).join(" ");

      let target = null;
      wss.clients.forEach(client => {
        if (client.id === targetId) target = client;
      });

      if (!target) {
        ws.send(`ID ${parts[1]} のユーザーは見つかりません`);
        return;
      }

      const time = timestamp();
      ws.send(`[${time}] (p) → ${target.handle}: ${message}`);
      target.send(`[${time}] (p) ${ws.handle} → あなた: ${message}`);

      ws.lastActive = Date.now();
      return;
    }

    // -------------------------
    // 🔥 /q /l ログアウト
    // -------------------------
    if (raw === "/q" || raw === "/l") {
      ws.isLogout = true;
      saveLogoutTime(ws.handle, formatDateTime());
      ws.close();
      return;
    }

    // -------------------------
    // 🔥 /r{行数}
    // -------------------------
    if (raw.startsWith("/r")) {
      const num = parseInt(raw.slice(2), 10);
      if (!isNaN(num) && num > 0) sendRecentLog(ws, num);
      else ws.send("[/r{行数}] の形式で指定してください");
      return;
    }

    // -------------------------
    // 🔥 /rn 前回ログアウト以降のログ
    // -------------------------
    if (raw === "/rn") {
      const prev = loadLogoutTime(ws.handle);
      if (!prev) {
        ws.send("前回ログアウト時刻が記録されていません");
        return;
      }

      const prevDate = new Date(prev);
      const startYMD = formatYMD(prevDate);
      const endYMD = formatYMD(new Date());

      let cur = parseDateYMD(startYMD);

      while (formatYMD(cur) <= endYMD) {
        const ymd = formatYMD(cur);
        const logFile = path.join(LOG_PARENT, String(port), `${ymd}.italk`);

        if (fs.existsSync(logFile)) {
          const lines = fs.readFileSync(logFile, "utf8").trim().split("\n");
          let sending = false;

          lines.forEach(line => {
            if (!sending) {
              const m = line.match(/^

\[(\d\d):(\d\d):(\d\d)\]

/);
              if (m) {
                const lineDate = new Date(
                  cur.getFullYear(),
                  cur.getMonth(),
                  cur.getDate(),
                  parseInt(m[1], 10),
                  parseInt(m[2], 10),
                  parseInt(m[3], 10)
                );
                if (lineDate >= prevDate) sending = true;
              }
            }
            if (sending) ws.send(line);
          });
        }

        cur.setDate(cur.getDate() + 1);
      }

      return;
    }

    // -------------------------
    // 🔥 通常発言
    // -------------------------
    const msg = `[${timestamp()}] ${ws.handle}: ${raw}`;
    broadcast(msg);

    ws.lastActive = Date.now();

    // -------------------------
    // 🔥 通常伝言
    // -------------------------
    if (raw.includes(">>")) {
      const [body, targetHandle] = raw.split(">>");
      if (body && targetHandle) {
        saveMessage(targetHandle, `${ws.handle}: ${body}`);
        ws.send(`伝言を ${targetHandle} に預かりました`);
      }
    }
  });

  ws.on('close', () => {
    if (ws.handle !== null) {
      const msg = ws.isLogout
        ? `*** ${ws.handle} がログアウトしました ***`
        : `*** ${ws.handle} の接続が切れました ***`;

      broadcast(`[${timestamp()}] ${msg}`);
    }
  });
});
