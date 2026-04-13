const WebSocket = require('ws');

// 起動時引数からポート番号を取得（例: node server.js 9000）
const port = process.argv[2] ? Number(process.argv[2]) : 8080;

const wss = new WebSocket.Server({ port });

console.log(`WebSocket server running on ws://localhost:${port}`);

wss.on('connection', (ws) => {
  ws.handle = "匿名";

  ws.on('message', (data) => {
    const text = data.toString().trim();

    if (text.startsWith("/login ")) {
      const handle = text.replace("/login ", "").trim();
      ws.handle = handle || "匿名";
      return;
    }

    if (text === "/q" || text === "/l") {
      ws.close();
      return;
    }

    const message = `${ws.handle}: ${text}`;

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
