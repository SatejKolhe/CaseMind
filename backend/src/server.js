const path = require('path');
// Load environment variables from backend/.env before importing config
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express = require('express');
const { connectDB, getDB, closeDB } = require('./config/db');
const caseRoutes = require('./routes/caseRoutes');

const app = express();
const PORT = process.env.PORT || 5000;
const DB_NAME = process.env.DB_NAME || 'casemind';

// Configurable CORS support
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://localhost:5173'];
const allowedOrigins = process.env.FRONTEND_ORIGIN
  ? process.env.FRONTEND_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
  : DEFAULT_ALLOWED_ORIGINS;

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (allowedOrigins.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

// Middleware for parsing JSON requests
app.use(express.json());

// Handle malformed JSON body errors
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: 'Malformed JSON payload in request body.',
      },
    });
  }
  next(err);
});

// Mount Case API routes
app.use('/api/cases', caseRoutes);

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

// Catch-all 404 for undefined routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `Endpoint ${req.method} ${req.originalUrl} not found.`,
    },
  });
});

// Start server only after establishing database connection
async function startServer() {
  try {
    console.log('[Server] Connecting to MongoDB...');
    await connectDB();

    const server = app.listen(PORT, () => {
      console.log(`[Server] CaseMind backend listening on port ${PORT}`);
      console.log(`[Server] Health check available at http://localhost:${PORT}/health`);
      console.log(`[Server] Case endpoints mounted at http://localhost:${PORT}/api/cases`);
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

// Only start the server directly if executed as main script
if (require.main === module) {
  startServer();
}

module.exports = app;
