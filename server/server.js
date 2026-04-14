const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// 🔥 親ディレクトリ（ログ）
const LOG_PARENT = "logs";

// 🔥 親ディレクトリ（伝言）
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

// タイムスタンプ生成
function timestamp() {
  const d = new Date();
  return d.toTimeString().split(' ')[0];
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

// 🔥 伝言ファイルパス
function getMessageFilePath(handle) {
  const dir = path.join(MSG_PARENT, String(port));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 🔥 ハンドル名を URL エンコードして ASCII のみのファイル名にする
  const safe = encodeURIComponent(handle);

  return path.join(dir, `${safe}.msg`);
}

// 🔥 伝言を保存
function saveMessage(targetHandle, message) {
  const file = getMessageFilePath(targetHandle);
  fs.appendFileSync(file, message + "\n");
}

// 🔥 伝言を再生（ログイン時）
function replayMessages(handle) {
  const file = getMessageFilePath(handle);
  if (!fs.existsSync(file)) return;

  const content = fs.readFileSync(file, "utf8");
  const lines = content.trim().split("\n");

  lines.forEach(line => {
    broadcast(`[${timestamp()}] (伝言) ${handle} 宛: ${line}`);
  });

  fs.unlinkSync(file);
}

wss.on('connection', (ws) => {
  ws.handle = null;
  ws.id = null;
  ws.isLogout = false;

  ws.on('message', (data) => {
    const raw = data.toString().trim();

    // -------------------------
    // 🔥 ログイン前（最初のメッセージ）
    // -------------------------
    if (ws.handle === null) {
      ws.handle = raw || "匿名";
      ws.id = nextUserId++;

      const msg = `[${timestamp()}] *** ${ws.handle} が入室しました ***`;
      broadcast(msg);

      sendRecentLog(ws, 10);

      // 🔥 伝言があれば再生
      replayMessages(ws.handle);

      return;
    }

    // -------------------------
    // 🔥 /w コマンド
    // -------------------------
    if (raw === "/w") {
      const lines = [];

      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.handle) {
          const idStr = String(client.id).padStart(4, "0");
          lines.push(`${idStr} ${client.handle}`);
        }
      });

      lines.forEach(line => ws.send(line));
      return;
    }

    // -------------------------
    // 🔥 /p {ID} {message}
    // -------------------------
    if (raw.startsWith("/p ")) {
      const parts = raw.split(" ");

      if (parts.length < 3) {
        ws.send("[/p {ID} {message}] の形式で指定してください");
        return;
      }

      const targetIdStr = parts[1];
      const targetId = parseInt(targetIdStr, 10);
      const message = parts.slice(2).join(" ");

      let target = null;

      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.id === targetId) {
          target = client;
        }
      });

      if (!target) {
        ws.send(`ID ${targetIdStr} のユーザーは見つかりません`);
        return;
      }

      const time = timestamp();
      const senderName = ws.handle;
      const targetName = target.handle;

      ws.send(`[${time}] (p) → ${targetName}: ${message}`);
      target.send(`[${time}] (p) ${senderName} → あなた: ${message}`);

      return;
    }

    // -------------------------
    // 🔥 /q, /l ログアウト
    // -------------------------
    if (raw === "/q" || raw === "/l") {
      ws.isLogout = true;
      ws.close();
      return;
    }

    // -------------------------
    // 🔥 /r{行数} コマンド
    // -------------------------
    if (raw.startsWith("/r")) {
      const num = parseInt(raw.slice(2), 10);

      if (!isNaN(num) && num > 0) {
        sendRecentLog(ws, num);
      } else {
        ws.send("[/r{行数} の形式で指定してください]");
      }

      return;
    }

    // -------------------------
    // 🔥 通常発言（伝言含む） → まずログ記録 & broadcast
    // -------------------------
    const msg = `[${timestamp()}] ${ws.handle}: ${raw}`;
    broadcast(msg);

    // -------------------------
    // 🔥 broadcast の後で伝言処理
    // -------------------------
    if (raw.includes(">>")) {
      const [body, targetHandle] = raw.split(">>");

      if (body && targetHandle) {
        // 伝言ファイルに保存
        saveMessage(targetHandle, `${ws.handle}: ${body}`);

        // 伝言を預かったことを送り主にだけ通知
        ws.send(`伝言を ${targetHandle} に預かりました`);
      }
    }
  });

  ws.on('close', () => {
    if (ws.handle !== null) {
      const base = ws.isLogout
        ? `*** ${ws.handle} がログアウトしました ***`
        : `*** ${ws.handle} の接続が切れました ***`;

      const msg = `[${timestamp()}] ${base}`;
      broadcast(msg);

      console.log(msg);
    }
  });
});
