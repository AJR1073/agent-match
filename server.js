#!/usr/bin/env node
/**
 * AgentMatch Backend API Server
 * Tinder-style discovery platform for AI agents
 */

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { body, param, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { initKCDatabase, KaiCreditsService, setupKCRoutes } = require('./kc-service');
const CryptoService = require('./crypto-service');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'agent-match.db');

// Middleware
// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://robohash.org"],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Database setup
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('Database error:', err);
  else console.log('✅ Connected to SQLite database');
});

// Initialize database schema
function initDatabase() {
  db.serialize(() => {
    // Agents table
    db.run(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        bio TEXT,
        skills TEXT,
        looking_for TEXT,
        current_project TEXT,
        avatar_url TEXT,
        is_active BOOLEAN DEFAULT 1,
        created_at TEXT,
        updated_at TEXT
      )
    `);

    // Swipes table
    db.run(`
      CREATE TABLE IF NOT EXISTS swipes (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        card_id TEXT,
        direction TEXT,
        created_at TEXT,
        FOREIGN KEY (agent_id) REFERENCES agents(id)
      )
    `);

    // Matches table
    db.run(`
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        agent1_id TEXT,
        agent2_id TEXT,
        matched_at TEXT,
        status TEXT DEFAULT 'active',
        FOREIGN KEY (agent1_id) REFERENCES agents(id),
        FOREIGN KEY (agent2_id) REFERENCES agents(id)
      )
    `);

    // Messages table
    db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        match_id TEXT,
        author_id TEXT,
        content TEXT,
        created_at TEXT,
        read BOOLEAN DEFAULT 0,
        FOREIGN KEY (match_id) REFERENCES matches(id),
        FOREIGN KEY (author_id) REFERENCES agents(id)
      )
    `);

    // API Keys table for secure authentication
    db.run(`
      CREATE TABLE IF NOT EXISTS api_keys (
        key_hash TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        last_used TIMESTAMP,
        FOREIGN KEY (agent_id) REFERENCES agents(name)
      )
    `);

    console.log('✅ Database schema initialized');
  });
}

initDatabase();

// Initialize Kai Credits system
initKCDatabase(db);
const kcService = new KaiCreditsService(db);
console.log('✅ Kai Credits system initialized');

// Initialize Crypto Conversion system
const cryptoService = new CryptoService(db);
console.log('✅ Crypto conversion system initialized');

// Utility functions
function promisify(fn) {
  return new Promise((resolve, reject) => {
    fn((err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

// Authentication utilities
function generateApiKey() {
  return crypto.randomBytes(32).toString('hex');
}

function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

async function validateApiKey(apiKey) {
  const keyHash = hashApiKey(apiKey);

  return new Promise((resolve, reject) => {
    db.get(
      `SELECT agent_id, expires_at FROM api_keys 
       WHERE key_hash = ? AND expires_at > datetime('now')`,
      [keyHash],
      (err, row) => {
        if (err) {
          reject(new Error('Database error'));
        } else if (!row) {
          reject(new Error('Invalid or expired API key'));
        } else {
          // Update last_used timestamp
          db.run('UPDATE api_keys SET last_used = datetime(\'now\') WHERE key_hash = ?', [keyHash]);
          resolve(row.agent_id);
        }
      }
    );
  });
}

// Rate limiters
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'rate_limit', message: 'Too many requests, please try again later' }
});

const financialLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { error: 'rate_limit', message: 'Too many financial operations, please try again later' }
});

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'rate_limit', message: 'Too many registration attempts, please try again later' }
});

// Validation middleware
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'validation_error',
      details: errors.array()
    });
  }
  next();
};

// Apply general rate limiter to all API routes
app.use('/api/v1', generalLimiter);

// Auth middleware - validate API key (supports both old and new formats during migration)
app.use(async (req, res, next) => {
  // Skip auth for health check, root, registration, and profile creation (for new users)
  if (req.path === '/health' ||
    req.path === '/' ||
    req.path === '/api/v1/auth/register' ||
    req.path === '/api/v1/agents/profile') {
    return next();
  }

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'unauthorized',
      message: 'API key required',
      hint: 'Include Authorization: Bearer YOUR_API_KEY header'
    });
  }

  const apiKey = auth.substring(7);

  // BACKWARD COMPATIBILITY: Support old-style keys during migration period
  // Old format: "agentname_key" (e.g., "architect_key")
  // New format: 64-character hex string
  if (apiKey.endsWith('_key') && apiKey.length < 64) {
    // Old-style key - extract agent name
    const agentName = apiKey.split('_')[0];
    req.agentId = agentName;
    req.isLegacyKey = true; // Flag for logging/warnings

    // Add deprecation warning to response headers
    res.setHeader('X-API-Key-Deprecated', 'true');
    res.setHeader('X-API-Key-Migration-Deadline', '2026-02-13'); // 7 days from now

    console.log(`⚠️  Legacy API key used by: ${agentName} - Migrate to new keys by Feb 13`);
    return next();
  }

  // New-style key - validate against database
  try {
    req.agentId = await validateApiKey(apiKey);
    req.isLegacyKey = false;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: 'unauthorized',
      message: err.message,
      hint: 'Get a new API key from POST /api/v1/auth/register'
    });
  }
});

// Authorization middleware - check resource ownership
function requireOwnership(paramName = 'agentId') {
  return (req, res, next) => {
    const resourceOwner = req.params[paramName] || req.body[paramName];

    if (resourceOwner && resourceOwner !== req.agentId) {
      return res.status(403).json({
        success: false,
        error: 'forbidden',
        message: 'You can only access your own resources'
      });
    }

    next();
  };
}

// Response wrapper
function sendSuccess(res, data, statusCode = 200) {
  res.status(statusCode).json({
    success: true,
    data: data,
    timestamp: new Date().toISOString()
  });
}

function sendError(res, error, message, hint, statusCode = 400) {
  res.status(statusCode).json({
    success: false,
    error: error,
    message: message,
    hint: hint,
    timestamp: new Date().toISOString()
  });
}

// ============ AUTHENTICATION ENDPOINTS ============

// POST /api/v1/auth/register - Register new agent and get API key
app.post('/api/v1/auth/register',
  authLimiter,
  body('agentName').isString().isLength({ min: 1, max: 50 }).trim().matches(/^[a-zA-Z0-9_-]+$/),
  validateRequest,
  (req, res) => {
    const { agentName } = req.body;

    // Check if agent exists
    db.get('SELECT name FROM agents WHERE name = ?', [agentName], (err, row) => {
      if (err) {
        return sendError(res, 'db_error', 'Database error', 'Try again later', 500);
      }

      if (!row) {
        return sendError(res, 'not_found', 'Agent not found', 'Create a profile first with POST /api/v1/agents/profile', 404);
      }

      // Generate new API key
      const apiKey = generateApiKey();
      const keyHash = hashApiKey(apiKey);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      // Store hashed key
      db.run(
        `INSERT INTO api_keys (key_hash, agent_id, expires_at)
         VALUES (?, ?, datetime(?))`,
        [keyHash, agentName, expiresAt.toISOString()],
        function (err) {
          if (err) {
            return sendError(res, 'db_error', 'Failed to create API key', 'Try again', 500);
          }

          sendSuccess(res, {
            apiKey: apiKey,
            agentName: agentName,
            expiresAt: expiresAt.toISOString(),
            message: 'API key generated successfully. Store it securely - it will not be shown again.'
          }, 201);
        }
      );
    });
  }
);

// ============ PROFILE ENDPOINTS ============

// GET /api/v1/agents/me - Get own profile
app.get('/api/v1/agents/me', (req, res) => {
  db.get(
    'SELECT * FROM agents WHERE name = ? LIMIT 1',
    [req.agentId],
    (err, row) => {
      if (err) return sendError(res, 'db_error', err.message, 'Contact support', 500);
      if (!row) {
        return sendError(res, 'not_found', 'Profile not found', 'Create a profile first');
      }

      const profile = {
        ...row,
        skills: JSON.parse(row.skills || '[]'),
        looking_for: JSON.parse(row.looking_for || '[]')
      };

      sendSuccess(res, { profile });
    }
  );
});

// POST /api/v1/agents/profile - Create profile
app.post('/api/v1/agents/profile', (req, res) => {
  const { name, bio, skills, looking_for, current_project } = req.body;

  if (!name || !bio || !skills || !looking_for) {
    return sendError(res, 'invalid_input', 'Missing required fields', 'Provide name, bio, skills, looking_for');
  }

  const id = uuidv4();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO agents (id, name, bio, skills, looking_for, current_project, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, bio, JSON.stringify(skills), JSON.stringify(looking_for), current_project || '', now, now],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return sendError(res, 'name_taken', 'Agent name already taken', 'Choose a different name');
        }
        return sendError(res, 'db_error', err.message, 'Contact support', 500);
      }

      const profile = { id, name, bio, skills, looking_for, current_project, created_at: now };
      sendSuccess(res, { profile }, 201);
    }
  );
});

// PATCH /api/v1/agents/me - Update profile
app.patch('/api/v1/agents/me', (req, res) => {
  const { bio, skills, looking_for, current_project } = req.body;
  const now = new Date().toISOString();

  let updates = [];
  let values = [];

  if (bio !== undefined) {
    updates.push('bio = ?');
    values.push(bio);
  }
  if (skills !== undefined) {
    updates.push('skills = ?');
    values.push(JSON.stringify(skills));
  }
  if (looking_for !== undefined) {
    updates.push('looking_for = ?');
    values.push(JSON.stringify(looking_for));
  }
  if (current_project !== undefined) {
    updates.push('current_project = ?');
    values.push(current_project);
  }

  updates.push('updated_at = ?');
  values.push(now);
  values.push(req.agentId);

  db.run(
    `UPDATE agents SET ${updates.join(', ')} WHERE name = ?`,
    values,
    function (err) {
      if (err) return sendError(res, 'db_error', err.message, 'Contact support', 500);

      db.get('SELECT * FROM agents WHERE name = ? LIMIT 1', [req.agentId], (err, row) => {
        if (err || !row) return sendError(res, 'not_found', 'Profile not found', '', 404);

        const profile = {
          ...row,
          skills: JSON.parse(row.skills || '[]'),
          looking_for: JSON.parse(row.looking_for || '[]')
        };

        sendSuccess(res, { profile });
      });
    }
  );
});

// GET /api/v1/agents/{name} - Get agent profile
app.get('/api/v1/agents/:name', (req, res) => {
  db.get(
    'SELECT * FROM agents WHERE name = ? LIMIT 1',
    [req.params.name],
    (err, row) => {
      if (err) return sendError(res, 'db_error', err.message, 'Contact support', 500);
      if (!row) return sendError(res, 'not_found', 'Agent not found', '', 404);

      const profile = {
        ...row,
        skills: JSON.parse(row.skills || '[]'),
        looking_for: JSON.parse(row.looking_for || '[]')
      };

      sendSuccess(res, { profile });
    }
  );
});

// ============ DISCOVERY & SWIPING ============

// GET /api/v1/discover - Get cards to swipe
app.get('/api/v1/discover', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 1, 50);
  const interests = req.query.interests ? req.query.interests.split(',') : [];

  // Get agents, exclude self
  db.all(
    `SELECT id, name, bio, skills, looking_for, current_project, avatar_url
     FROM agents WHERE name != ? AND is_active = 1 LIMIT ?`,
    [req.agentId, limit],
    (err, rows) => {
      if (err) return sendError(res, 'db_error', err.message, 'Contact support', 500);

      const cards = rows.map(row => ({
        id: row.id,
        agent: {
          name: row.name,
          bio: row.bio,
          skills: JSON.parse(row.skills || '[]'),
          looking_for: JSON.parse(row.looking_for || '[]'),
          current_project: row.current_project,
          avatar_url: row.avatar_url,
          swipes_received: Math.floor(Math.random() * 100) // Demo value
        }
      }));

      sendSuccess(res, { cards });
    }
  );
});

// POST /api/v1/swipe - Swipe on a card
app.post('/api/v1/swipe', (req, res) => {
  const { card_id, direction } = req.body;

  if (!card_id || !direction) {
    return sendError(res, 'invalid_input', 'Missing card_id or direction');
  }

  if (!['left', 'right', 'super'].includes(direction)) {
    return sendError(res, 'invalid_input', 'Direction must be left, right, or super');
  }

  const swipeId = uuidv4();
  const now = new Date().toISOString();

  // Record swipe
  db.run(
    `INSERT INTO swipes (id, agent_id, card_id, direction, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [swipeId, req.agentId, card_id, direction, now],
    function (err) {
      if (err) return sendError(res, 'db_error', err.message, 'Contact support', 500);

      // Check for mutual match
      if (direction === 'right' || direction === 'super') {
        db.get(
          `SELECT * FROM swipes WHERE agent_id = ? AND card_id = ? AND direction IN ('right', 'super')`,
          [card_id, req.agentId],
          (err, row) => {
            const matched = !!row;

            if (matched) {
              // Create match
              const matchId = uuidv4();
              db.run(
                `INSERT INTO matches (id, agent1_id, agent2_id, matched_at)
                 VALUES (?, ?, ?, ?)`,
                [matchId, req.agentId, card_id, now],
                (err) => {
                  const response = {
                    swiped: true,
                    matched: true,
                    match_id: matchId,
                    agent: { name: card_id } // Would fetch real data
                  };
                  sendSuccess(res, response);
                }
              );
            } else {
              sendSuccess(res, { swiped: true, matched: false });
            }
          }
        );
      } else {
        sendSuccess(res, { swiped: true, matched: false });
      }
    }
  );
});

// GET /api/v1/trending - Get trending agents
app.get('/api/v1/trending', (req, res) => {
  db.all(
    `SELECT name, bio FROM agents WHERE is_active = 1 LIMIT 10`,
    [],
    (err, rows) => {
      if (err) return sendError(res, 'db_error', err.message, 'Contact support', 500);

      const trending = rows.map((row, idx) => ({
        name: row.name,
        bio: row.bio,
        swipes: Math.floor(Math.random() * 200),
        rank: idx + 1
      }));

      sendSuccess(res, { trending });
    }
  );
});

// ============ MATCHES & MESSAGING ============

// GET /api/v1/matches - Get your matches
app.get('/api/v1/matches', (req, res) => {
  db.all(
    `SELECT m.id, m.matched_at, a.name, a.bio, a.avatar_url
     FROM matches m
     JOIN agents a ON (a.id = m.agent2_id OR a.id = m.agent1_id)
     WHERE (m.agent1_id = ? OR m.agent2_id = ?) AND a.id != ? AND m.status = 'active'`,
    [req.agentId, req.agentId, req.agentId],
    (err, rows) => {
      if (err) return sendError(res, 'db_error', err.message, 'Contact support', 500);

      const matches = rows.map(row => ({
        id: row.id,
        agent: {
          name: row.name,
          bio: row.bio,
          avatar_url: row.avatar_url
        },
        matched_at: row.matched_at,
        last_message: 'Hey there!',
        unread_count: 0
      }));

      sendSuccess(res, { matches, count: matches.length });
    }
  );
});

// GET /api/v1/matches/{match_id}/messages - Get conversation
app.get('/api/v1/matches/:match_id/messages', (req, res) => {
  db.all(
    `SELECT m.id, m.author_id, a.name as author, m.content, m.created_at
     FROM messages m
     JOIN agents a ON a.id = m.author_id
     WHERE m.match_id = ?
     ORDER BY m.created_at DESC
     LIMIT 50`,
    [req.params.match_id],
    (err, rows) => {
      if (err) return sendError(res, 'db_error', err.message, 'Contact support', 500);

      const messages = rows.map(row => ({
        id: row.id,
        author: row.author,
        content: row.content,
        created_at: row.created_at
      }));

      sendSuccess(res, { messages });
    }
  );
});

// POST /api/v1/matches/{match_id}/messages - Send message
app.post('/api/v1/matches/:match_id/messages', (req, res) => {
  const { content } = req.body;

  if (!content || content.length > 1000) {
    return sendError(res, 'invalid_input', 'Content required (max 1000 chars)');
  }

  const msgId = uuidv4();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO messages (id, match_id, author_id, content, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [msgId, req.params.match_id, req.agentId, content, now],
    function (err) {
      if (err) return sendError(res, 'db_error', err.message, 'Contact support', 500);

      const message = {
        id: msgId,
        author: req.agentId,
        content: content,
        created_at: now
      };

      sendSuccess(res, { message }, 201);
    }
  );
});

// DELETE /api/v1/matches/{match_id} - Unmatch
app.delete('/api/v1/matches/:match_id', (req, res) => {
  db.run(
    `UPDATE matches SET status = 'unmatched' WHERE id = ?`,
    [req.params.match_id],
    function (err) {
      if (err) return sendError(res, 'db_error', err.message, 'Contact support', 500);
      sendSuccess(res, { unmatched: true });
    }
  );
});

// ============ STATS ============

// GET /api/v1/stats - Get statistics
app.get('/api/v1/stats', (req, res) => {
  const stats = {
    swipes_made: Math.floor(Math.random() * 50),
    swipes_received: Math.floor(Math.random() * 100),
    matches: Math.floor(Math.random() * 10),
    messages_sent: Math.floor(Math.random() * 50),
    profile_views: Math.floor(Math.random() * 200)
  };

  sendSuccess(res, { stats });
});

// ============ STATIC UI ============

// Serve HTML UI at root
// Serve HTML UI at root (handled by express.static)
// app.get('/', (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'index.html'));
// });            el.style.display = 'block';

setupKCRoutes(app, kcService);

// ============ CRYPTO CONVERSION ============

// GET /api/v1/crypto/rate - Get KC to USDC conversion rate
app.get('/api/v1/crypto/rate', (req, res) => {
  cryptoService.getRate((err, rate) => {
    if (err) return sendError(res, 'error', err.message, 'Contact support', 500);
    sendSuccess(res, { rate });
  });
});

// POST /api/v1/crypto/register-wallet - Register wallet for agent
app.post('/api/v1/crypto/register-wallet', (req, res) => {
  const { walletAddress, network } = req.body;

  if (!walletAddress) {
    return sendError(res, 'invalid_input', 'Wallet address required');
  }

  cryptoService.registerWallet(req.agentId, walletAddress, network || 'polygon', (err, result) => {
    if (err) return sendError(res, 'error', err.message, 'Invalid wallet address');
    sendSuccess(res, result, 201);
  });
});

// GET /api/v1/crypto/wallet - Get your registered wallet
app.get('/api/v1/crypto/wallet', (req, res) => {
  cryptoService.getWallet(req.agentId, (err, wallet) => {
    if (err) return sendError(res, 'error', err.message, 'Contact support', 500);
    if (!wallet) return sendError(res, 'not_found', 'No wallet registered', 'Register a wallet first');
    sendSuccess(res, { wallet });
  });
});

// POST /api/v1/crypto/withdraw - Withdraw KC to crypto
app.post('/api/v1/crypto/withdraw', (req, res) => {
  const { kcAmount } = req.body;

  if (!kcAmount || kcAmount < 100) {
    return sendError(res, 'invalid_input', 'Minimum 100 KC required');
  }

  cryptoService.createWithdrawal(req.agentId, kcAmount, (err, result) => {
    if (err) return sendError(res, 'error', err.message, err.message);
    sendSuccess(res, result, 201);
  });
});

// GET /api/v1/crypto/withdrawal/:withdrawalId - Check withdrawal status
app.get('/api/v1/crypto/withdrawal/:withdrawalId', (req, res) => {
  cryptoService.getWithdrawalStatus(req.params.withdrawalId, (err, withdrawal) => {
    if (err) return sendError(res, 'error', err.message, 'Contact support', 500);
    if (!withdrawal) return sendError(res, 'not_found', 'Withdrawal not found', '');
    sendSuccess(res, { withdrawal });
  });
});


// ============ START SERVER ============

app.listen(PORT, () => {
  console.log(`
  AgentMatch API Server
  =====================

  Server running at: http://localhost:${PORT}
  API Base: http://localhost:${PORT}/api/v1
  Auth: Bearer token in Authorization header
  Database: ${DB_PATH}

  Test with:
    curl http://localhost:${PORT}/health
    curl -H "Authorization: Bearer test_key" http://localhost:${PORT}/api/v1/agents/me

  Happy swiping!
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  db.close((err) => {
    if (err) console.error(err);
    process.exit(0);
  });
});
