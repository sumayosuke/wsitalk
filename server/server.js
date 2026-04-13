const WebSocket = require('ws');

const port = process.argv[2] ? Number(process.argv[2]) : 8080;
const wss = new WebSocket.Server({ port });

console.log(`WebSocket server running on ws://localhost:${port}`);

// 🔥 共通の通知送信関数
function broadcast(text) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(text);
    }
  });
}

wss.on('connection', (ws) => {
  ws.handle = "匿名";
  ws.isLogout = false;

  ws.on('message', (data) => {
    const text = data.toString().trim();

    // ログインコマンド
    if (text.startsWith("/login ")) {
      const handle = text.replace("/login ", "").trim();
      ws.handle = handle || "匿名";

      // 入室通知
      broadcast(`*** ${ws.handle} が入室しました ***`);
      return;
    }

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
    let notice;

    if (ws.isLogout) {
      notice = `*** ${ws.handle} がログアウトしました ***`;
    } else {
      notice = `*** ${ws.handle} の接続が切れました ***`;
    }

    broadcast(notice);
    console.log(notice);
  });
});
