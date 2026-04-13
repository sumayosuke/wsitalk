const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// 🔥 親ディレクトリを冒頭で定義
const LOG_PARENT = "logs";

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

      return;
    }

    // -------------------------
    // 🔥 /w コマンド（ログイン中のユーザー一覧）
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
    // 🔥 /p {ID} {message}（旧 /tell）
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

      // 送信者に通知
      ws.send(`[${time}] (p) → ${targetName}: ${message}`);

      // 相手に送信
      target.send(`[${time}] (p) ${senderName} → あなた: ${message}`);

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
    // 🔥 ログアウトコマンド
    // -------------------------
    if (raw === "/q" || raw === "/l") {
      ws.isLogout = true;
      ws.close();
      return;
    }

    // -------------------------
    // 🔥 通常メッセージ
    // -------------------------
    const msg = `[${timestamp()}] ${ws.handle}: ${raw}`;
    broadcast(msg);
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
