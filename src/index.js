require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const { setupWebSocket } = require('./services/websocket');

const authRoutes = require('./routes/auth');
const operatorRoutes = require('./routes/operators');
const operationRoutes = require('./routes/operations');
const deviceRoutes = require('./routes/devices');
const androidRoutes = require('./routes/android');
const statsRoutes = require('./routes/stats');
const setupRoutes = require('./routes/setup');

const app = express();
const server = http.createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server });
setupWebSocket(wss);

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/operators', operatorRoutes);
app.use('/api/operations', operationRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/android', androidRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/setup', setupRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route non trouvée' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Erreur serveur', details: err.message });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
  console.log(`📡 WebSocket actif`);
});
