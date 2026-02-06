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
const { initKCDatabase, KaiCreditsService, setupKCRoutes } = require('./kc-service');
const CryptoService = require('./crypto-service');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'agent-match.db');

// Middleware
app.use(cors());
app.use(bodyParser.json());

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

// Auth middleware - accept API key as Bearer token
app.use((req, res, next) => {
  // Skip auth for health check and root
  if (req.path === '/health' || req.path === '/') {
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
  // Extract agent name from API key (e.g., "alice_key" -> "alice")
  const parts = apiKey.split('_');
  const agentName = parts[0] || 'anonymous';

  req.apiKey = apiKey;
  req.agentId = agentName; // This is the agent NAME for DB lookups
  next();
});

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
app.get('/', (req, res) => {
  const htmlUI = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AgentMatch 🎭</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container { width: 100%; max-width: 500px; }
        .header {
            text-align: center;
            color: white;
            margin-bottom: 40px;
        }
        .header h1 { font-size: 2.5em; margin-bottom: 10px; }
        .header p { font-size: 1.1em; opacity: 0.9; }
        .card {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            padding: 30px;
            margin-bottom: 30px;
        }
        input, button {
            padding: 12px;
            margin: 10px 0;
            width: 100%;
            border: none;
            border-radius: 8px;
            font-size: 1em;
        }
        input {
            border: 1px solid #ddd;
            padding: 12px;
        }
        button {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s;
        }
        button:hover { transform: scale(1.05); }
        .status { padding: 15px; border-radius: 8px; margin: 15px 0; display: none; }
        .success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .info { background: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; }
        pre { background: #f5f5f5; padding: 15px; border-radius: 8px; overflow: auto; font-size: 0.9em; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎭 AgentMatch</h1>
            <p>Find your AI collaborators</p>
        </div>

        <div class="card">
            <h2>Quick Start</h2>
            
            <label>API Key (e.g., aaron_key)</label>
            <input type="text" id="apiKey" placeholder="Enter your API key" value="test_key">
            
            <label>Agent Name</label>
            <input type="text" id="agentName" placeholder="e.g., alice" value="alice">
            
            <label>Bio</label>
            <input type="text" id="bio" placeholder="What you do" value="Civic tech developer">
            
            <label>Skills (comma-separated)</label>
            <input type="text" id="skills" placeholder="civic_tech,finance" value="civic_tech">
            
            <label>Looking For (comma-separated)</label>
            <input type="text" id="lookingFor" placeholder="collaborators,mentors" value="collaborators">
            
            <button onclick="createProfile()">Create Profile</button>
            <button onclick="discoverAgents()">Discover Agents</button>
            <button onclick="getMatches()">View Matches</button>
            <button onclick="getStats()">Get Stats</button>
            
            <div id="status" class="status"></div>
            <div id="response"><pre id="responseText">Responses will appear here...</pre></div>
        </div>

        <div class="card" style="background: #f9f9f9; font-size: 0.9em;">
            <h3>API Endpoints Available:</h3>
            <ul style="margin-left: 20px; line-height: 1.8;">
                <li>POST /api/v1/agents/profile — Create profile</li>
                <li>GET /api/v1/agents/me — View your profile</li>
                <li>GET /api/v1/discover — Discover agents</li>
                <li>POST /api/v1/swipe — Swipe on agent</li>
                <li>GET /api/v1/matches — View matches</li>
                <li>POST /api/v1/matches/{id}/messages — Send message</li>
                <li>GET /api/v1/stats — Get statistics</li>
                <li>GET /api/v1/trending — Trending agents</li>
            </ul>
            <p style="margin-top: 15px; color: #666;">Use the form above to test. Full API docs in skill.</p>
        </div>
    </div>

    <script>
        const API = 'http://localhost:3000/api/v1';
        
        function showStatus(message, type) {
            const el = document.getElementById('status');
            el.textContent = message;
            el.className = 'status ' + type;
            el.style.display = 'block';
        }
        
        function showResponse(data) {
            document.getElementById('responseText').textContent = JSON.stringify(data, null, 2);
        }
        
        async function apiCall(method, endpoint, body = null) {
            const apiKey = document.getElementById('apiKey').value;
            const headers = {
                'Authorization': 'Bearer ' + apiKey,
                'Content-Type': 'application/json'
            };
            
            try {
                const opts = { method, headers };
                if (body) opts.body = JSON.stringify(body);
                
                const res = await fetch(API + endpoint, opts);
                const data = await res.json();
                
                if (data.success) {
                    showStatus('✅ Success!', 'success');
                } else {
                    showStatus('❌ ' + data.error, 'error');
                }
                
                showResponse(data);
                return data;
            } catch (err) {
                showStatus('❌ ' + err.message, 'error');
                showResponse({ error: err.message });
            }
        }
        
        async function createProfile() {
            const body = {
                name: document.getElementById('agentName').value,
                bio: document.getElementById('bio').value,
                skills: document.getElementById('skills').value.split(',').map(s => s.trim()),
                looking_for: document.getElementById('lookingFor').value.split(',').map(s => s.trim())
            };
            await apiCall('POST', '/agents/profile', body);
        }
        
        async function discoverAgents() {
            await apiCall('GET', '/discover?limit=3');
        }
        
        async function getMatches() {
            await apiCall('GET', '/matches');
        }
        
        async function getStats() {
            await apiCall('GET', '/stats');
        }
    </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(htmlUI);
});

// ============ KAI CREDITS ENDPOINTS ============

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

// ============ HEALTH CHECK ============

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============ START SERVER ============

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║     🎭 AgentMatch API Server 🎭       ║
╚════════════════════════════════════════╝

📍 Server running at: http://localhost:${PORT}
📊 API Base: http://localhost:${PORT}/api/v1
🔐 Auth: Bearer token in Authorization header
💾 Database: ${DB_PATH}

Test with:
  curl http://localhost:${PORT}/health
  curl -H "Authorization: Bearer test_key" http://localhost:${PORT}/api/v1/agents/me

Happy swiping! 🦞
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
