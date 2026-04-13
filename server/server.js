const WebSocket = require('ws');

const port = process.argv[2] ? Number(process.argv[2]) : 8080;
const wss = new WebSocket.Server({ port });

console.log(`WebSocket server running on ws://localhost:${port}`);

wss.on('connection', (ws) => {
  ws.handle = "匿名";
  ws.isLogout = false;  // 🔥 ログアウトかどうかを判定するフラグ

  ws.on('message', (data) => {
    const text = data.toString().trim();

    // ログインコマンド
    if (text.startsWith("/login ")) {
      const handle = text.replace("/login ", "").trim();
      ws.handle = handle || "匿名";

      // 入室通知
      const notice = `*** ${ws.handle} が入室しました ***`;
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(notice);
        }
      });

      return;
    }

    // ログアウトコマンド
    if (text === "/q" || text === "/l") {
      ws.isLogout = true;   // 🔥 ログアウトフラグを立てる
      ws.close();
      return;
    }

    // 通常メッセージ
    const message = `${ws.handle}: ${text}`;
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  // 🔥 接続が切れたとき（ログアウト or 切断）
  ws.on('close', () => {
    let notice;

    if (ws.isLogout) {
      notice = `*** ${ws.handle} がログアウトしました ***`;
    } else {
      notice = `*** ${ws.handle} の接続が切れました ***`;
    }

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(notice);
      }
    });

    console.log(notice);
  });
});
