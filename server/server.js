const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
  ws.handle = "匿名";

  ws.on('message', (data) => {
    const text = data.toString().trim();

    // ログインコマンド
    if (text.startsWith("/login ")) {
      const handle = text.replace("/login ", "").trim();
      ws.handle = handle || "匿名";
      return;
    }

    // ログアウトコマンド（サーバー側で解釈）
    if (text === "/q" || text === "/l") {
      ws.close();
      return;
    }

    // 通常メッセージ
    const message = `${ws.handle}: ${text}`;

    // 全員に生テキストで送信
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  ws.on('close', () => {
    console.log(`${ws.handle} disconnected`);
  });
});

console.log('WebSocket server running on ws://localhost:8080');
