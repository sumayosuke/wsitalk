const WebSocket = require('ws');

const port = process.argv[2] ? Number(process.argv[2]) : 8080;
const wss = new WebSocket.Server({ port });

console.log(`WebSocket server running on ws://localhost:${port}`);

// 共通ブロードキャスト関数
function broadcast(text) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(text);
    }
  });
}

wss.on('connection', (ws) => {
  ws.handle = null;      // 🔥 接続直後は未ログイン
  ws.isLogout = false;

  ws.on('message', (data) => {
    const text = data.toString().trim();

    // -------------------------
    // 🔥 ログイン前（最初のメッセージ）
    // -------------------------
    if (ws.handle === null) {
      ws.handle = text || "匿名";

      broadcast(`*** ${ws.handle} が入室しました ***`);
      return;
    }

    // -------------------------
    // 🔥 ログイン後の処理
    // -------------------------

    // ログアウトコマンド
    if (text === "/q" || text === "/l") {
      ws.isLogout = true;
      ws.close();
      return;
    }

    // 通常メッセージ
    broadcast(`${ws.handle}: ${text}`);
  });

  ws.on('close', () => {
    if (ws.handle !== null) {
      const notice = ws.isLogout
        ? `*** ${ws.handle} がログアウトしました ***`
        : `*** ${ws.handle} の接続が切れました ***`;

      broadcast(notice);
      console.log(notice);
    }
  });
});
