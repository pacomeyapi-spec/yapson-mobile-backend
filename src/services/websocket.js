const clients = new Map();

const setupWebSocket = (wss) => {
  wss.on('connection', (ws, req) => {
    const clientId = Date.now().toString();
    clients.set(clientId, { ws, rooms: new Set() });
    console.log(`🔌 Client WebSocket connecté: ${clientId}`);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'subscribe' && msg.room) {
          clients.get(clientId)?.rooms.add(msg.room);
          ws.send(JSON.stringify({ type: 'subscribed', room: msg.room }));
        }
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (e) {}
    });

    ws.on('close', () => {
      clients.delete(clientId);
      console.log(`🔌 Client WebSocket déconnecté: ${clientId}`);
    });

    ws.send(JSON.stringify({ type: 'connected', clientId }));
  });
};

// Envoyer un événement à tous les clients d'une room
const broadcast = (room, event) => {
  const message = JSON.stringify(event);
  for (const [, client] of clients) {
    if (client.rooms.has(room) && client.ws.readyState === 1) {
      client.ws.send(message);
    }
  }
};

// Notifier une mise à jour d'opération
const notifyOperationUpdate = (operation) => {
  broadcast('operations', {
    type: 'operation_update',
    data: operation
  });
  broadcast(`operation:${operation.id}`, {
    type: 'operation_update',
    data: operation
  });
  broadcast(`user:${operation.userId}`, {
    type: 'operation_update',
    data: operation
  });
};

module.exports = { setupWebSocket, broadcast, notifyOperationUpdate };
