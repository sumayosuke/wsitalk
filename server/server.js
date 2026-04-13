const WebSocket = require('ws');
const fs = require('fs');

const port = process.argv[2] ? Number(process.argv[2]) : 8080;
const wss = new WebSocket.Server({ port });

console.log(`WebSocket server running on ws://localhost:${port}`);

// 🔥 タイムスタンプ生成関数（将来ここを差し替えるだけでOK）
function timestamp() {
  const d = new Date();
  return d.toTimeString().split(' ')[0]; // "HH:MM:SS"
}

// 🔥 broadcast は「送る＋ログに書く」だけの純粋な処理にする
function broadcast(text) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(text);
    }
  });

  fs.appendFileSync("chat.log", text + "\n");
}

wss.on('connection', (ws) => {
  ws.handle = null;
  ws.isLogout = false;

  ws.on('message', (data) => {
    const raw = data.toString().trim();

    // -------------------------
    // 🔥 ログイン前（最初のメッセージ）
    // -------------------------
    if (ws.handle === null) {
      ws.handle = raw || "匿名";

      // 🔥 ここでタイムスタンプを付ける
      const msg = `[${timestamp()}] *** ${ws.handle} が入室しました ***`;
      broadcast(msg);
      return;
    }

    // -------------------------
    // 🔥 ログイン後の処理
    // -------------------------

    // ログアウトコマンド
    if (raw === "/q" || raw === "/l") {
      ws.isLogout = true;
      ws.close();
      return;
    }

    // 🔥 通常メッセージ（ここでタイムスタンプ付加）
    const msg = `[${timestamp()}] ${ws.handle}: ${raw}`;
    broadcast(msg);
  });

  ws.on('close', () => {
    if (ws.handle !== null) {
      const base = ws.isLogout
        ? `*** ${ws.handle} がログアウトしました ***`
        : `*** ${ws.handle} の接続が切れました ***`;

      // 🔥 退室通知にもタイムスタンプを付ける
      const msg = `[${timestamp()}] ${base}`;
      broadcast(msg);

      console.log(msg);
    }
  });
});
