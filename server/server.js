const WebSocket = require('ws');
const fs = require('fs');

const port = process.argv[2] ? Number(process.argv[2]) : 8080;
const wss = new WebSocket.Server({ port });

console.log(`WebSocket server running on ws://localhost:${port}`);

// タイムスタンプ生成（将来ここを変えるだけでOK）
function timestamp() {
  const d = new Date();
  return d.toTimeString().split(' ')[0]; // "HH:MM:SS"
}

// broadcast は「送信＋ログ保存」だけの純粋な処理
function broadcast(text) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(text);
    }
  });

  fs.appendFileSync("chat.log", text + "\n");
}

wss.on('connection', (ws) => {
  ws.handle = null;      // 未ログイン状態
  ws.isLogout = false;

  ws.on('message', (data) => {
    const raw = data.toString().trim();

    // -------------------------
    // 🔥 ログイン前（最初のメッセージ）
    // -------------------------
    if (ws.handle === null) {
      ws.handle = raw || "匿名";

      const msg = `[${timestamp()}] *** ${ws.handle} が入室しました ***`;
      broadcast(msg);
      return;
    }

    // -------------------------
    // 🔥 /r{行数} コマンド
    // -------------------------
    if (raw.startsWith("/r")) {
      const num = parseInt(raw.slice(2), 10);

      if (!isNaN(num) && num > 0) {

        // ログが無ければ何も送らない
        if (fs.existsSync("chat.log")) {
          const content = fs.readFileSync("chat.log", "utf8");
          const lines = content.trim().split("\n");
          const recent = lines.slice(-num);

          // このユーザーにだけ送信
          recent.forEach(line => {
            ws.send(line);
          });
        }

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
