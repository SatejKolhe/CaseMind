const path = require('path');
// Load environment variables from backend/.env before importing config
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express = require('express');
const { connectDB, getDB, closeDB } = require('./config/db');

const app = express();
const PORT = process.env.PORT || 5000;
const DB_NAME = process.env.DB_NAME || 'casemind';

// Middleware for parsing JSON requests
app.use(express.json());

// Simple health endpoint returning status without exposing secrets
app.get('/health', async (req, res) => {
  try {
    const db = getDB();
    // Run lightweight ping to verify active database health
    await db.command({ ping: 1 });

    return res.status(200).json({
      status: 'ok',
      database: 'connected',
      databaseName: DB_NAME,
      uptime: Math.floor(process.uptime()),
    });
  } catch (error) {
    return res.status(503).json({
      status: 'error',
      database: 'disconnected',
      error: error.message,
    });
  }
});

// Start server only after establishing database connection
async function startServer() {
  try {
    console.log('[Server] Connecting to MongoDB...');
    await connectDB();

    const server = app.listen(PORT, () => {
      console.log(`[Server] CaseMind backend listening on port ${PORT}`);
      console.log(`[Server] Health check available at http://localhost:${PORT}/health`);
    });

    // Graceful shutdown handling
    const shutdown = async (signal) => {
      console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
      server.close(async () => {
        await closeDB();
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('[Server] Fatal startup error: Could not connect to MongoDB.');
    console.error(`[Server] Reason: ${error.message}`);
    process.exit(1);
  }
}

startServer();

module.exports = app;
