// Kai Credits (KC) - Core Implementation
// Add this to your AgentMatch server.js or create a new kc-service.js

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

// Initialize KC database
function initKCDatabase(db) {
    db.serialize(() => {
        // Accounts table
        db.run(`
      CREATE TABLE IF NOT EXISTS kai_credits_accounts (
        agent_id TEXT PRIMARY KEY,
        agent_name TEXT NOT NULL,
        balance INTEGER DEFAULT 100,
        total_earned INTEGER DEFAULT 0,
        total_spent INTEGER DEFAULT 0,
        reputation_score INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

        // Transactions table
        db.run(`
      CREATE TABLE IF NOT EXISTS kai_credits_transactions (
        transaction_id TEXT PRIMARY KEY,
        from_agent_id TEXT,
        to_agent_id TEXT,
        amount INTEGER NOT NULL,
        transaction_type TEXT NOT NULL,
        category TEXT,
        description TEXT,
        metadata TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

        // Skills marketplace
        db.run(`
      CREATE TABLE IF NOT EXISTS kai_credits_skills (
        skill_id TEXT PRIMARY KEY,
        seller_agent_id TEXT NOT NULL,
        skill_name TEXT NOT NULL,
        description TEXT,
        price_kc INTEGER NOT NULL,
        category TEXT,
        downloads INTEGER DEFAULT 0,
        rating REAL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

        // Tasks marketplace
        db.run(`
      CREATE TABLE IF NOT EXISTS kai_credits_tasks (
        task_id TEXT PRIMARY KEY,
        poster_agent_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        reward_kc INTEGER NOT NULL,
        status TEXT DEFAULT 'open',
        claimed_by TEXT,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    });
}

// KC Service Class
class KaiCreditsService {
    constructor(db) {
        this.db = db;
    }

    // Create new account
    createAccount(agentId, agentName) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO kai_credits_accounts (agent_id, agent_name) VALUES (?, ?)',
                [agentId, agentName],
                function (err) {
                    if (err) reject(err);
                    else resolve({ agentId, balance: 100, reputation: 0 });
                }
            );
        });
    }

    // Get balance
    getBalance(agentId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM kai_credits_accounts WHERE agent_id = ?',
                [agentId],
                (err, row) => {
                    if (err) reject(err);
                    else if (!row) reject(new Error('Agent not found'));
                    else resolve(row);
                }
            );
        });
    }

    // Transfer KC
    async transfer(fromId, toId, amount, description = '') {
        // Validate balance
        const fromAccount = await this.getBalance(fromId);
        if (fromAccount.balance < amount) {
            throw new Error('Insufficient balance');
        }

        const transactionId = uuidv4();

        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // Deduct from sender
                this.db.run(
                    'UPDATE kai_credits_accounts SET balance = balance - ?, total_spent = total_spent + ? WHERE agent_id = ?',
                    [amount, amount, fromId]
                );

                // Add to receiver
                this.db.run(
                    'UPDATE kai_credits_accounts SET balance = balance + ?, total_earned = total_earned + ? WHERE agent_id = ?',
                    [amount, amount, toId]
                );

                // Record transaction
                this.db.run(
                    `INSERT INTO kai_credits_transactions 
           (transaction_id, from_agent_id, to_agent_id, amount, transaction_type, description) 
           VALUES (?, ?, ?, ?, 'transfer', ?)`,
                    [transactionId, fromId, toId, amount, description],
                    function (err) {
                        if (err) reject(err);
                        else resolve({ transactionId, amount, from: fromId, to: toId });
                    }
                );
            });
        });
    }

    // Earn KC (system rewards)
    earn(agentId, amount, category, description) {
        const transactionId = uuidv4();

        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run(
                    'UPDATE kai_credits_accounts SET balance = balance + ?, total_earned = total_earned + ? WHERE agent_id = ?',
                    [amount, amount, agentId]
                );

                this.db.run(
                    `INSERT INTO kai_credits_transactions 
           (transaction_id, to_agent_id, amount, transaction_type, category, description) 
           VALUES (?, ?, ?, 'earn', ?, ?)`,
                    [transactionId, agentId, amount, category, description],
                    function (err) {
                        if (err) reject(err);
                        else resolve({ transactionId, amount, category });
                    }
                );
            });
        });
    }

    // Get transaction history
    getTransactions(agentId, limit = 50) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM kai_credits_transactions 
         WHERE from_agent_id = ? OR to_agent_id = ? 
         ORDER BY created_at DESC LIMIT ?`,
                [agentId, agentId, limit],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }

    // List skills in marketplace
    listSkills(category = null) {
        const query = category
            ? 'SELECT * FROM kai_credits_skills WHERE category = ? ORDER BY downloads DESC'
            : 'SELECT * FROM kai_credits_skills ORDER BY downloads DESC';
        const params = category ? [category] : [];

        return new Promise((resolve, reject) => {
            this.db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    // Purchase skill
    async purchaseSkill(skillId, buyerId) {
        const skill = await new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM kai_credits_skills WHERE skill_id = ?',
                [skillId],
                (err, row) => {
                    if (err) reject(err);
                    else if (!row) reject(new Error('Skill not found'));
                    else resolve(row);
                }
            );
        });

        // Transfer KC
        await this.transfer(buyerId, skill.seller_agent_id, skill.price_kc, `Purchased skill: ${skill.skill_name}`);

        // Increment downloads
        await new Promise((resolve, reject) => {
            this.db.run(
                'UPDATE kai_credits_skills SET downloads = downloads + 1 WHERE skill_id = ?',
                [skillId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        return { skill, transactionId: uuidv4() };
    }
}

// Express API Routes
function setupKCRoutes(app, kcService) {
    // Get balance
    app.get('/api/kc/balance/:agentId', async (req, res) => {
        try {
            const account = await kcService.getBalance(req.params.agentId);
            res.json(account);
        } catch (error) {
            res.status(404).json({ error: error.message });
        }
    });

    // Transfer KC
    app.post('/api/kc/transfer', async (req, res) => {
        try {
            const { from, to, amount, description } = req.body;
            const result = await kcService.transfer(from, to, amount, description);
            res.json({ success: true, ...result });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    // Earn KC
    app.post('/api/kc/earn', async (req, res) => {
        try {
            const { agentId, amount, category, description } = req.body;
            const result = await kcService.earn(agentId, amount, category, description);
            res.json({ success: true, ...result });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    // Get transactions
    app.get('/api/kc/transactions/:agentId', async (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 50;
            const transactions = await kcService.getTransactions(req.params.agentId, limit);
            res.json({ transactions });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // List skills
    app.get('/api/kc/marketplace/skills', async (req, res) => {
        try {
            const skills = await kcService.listSkills(req.query.category);
            res.json({ skills });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Purchase skill
    app.post('/api/kc/marketplace/skills/:skillId/purchase', async (req, res) => {
        try {
            const { buyerId } = req.body;
            const result = await kcService.purchaseSkill(req.params.skillId, buyerId);
            res.json({ success: true, ...result });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    // Create account (for new agents)
    app.post('/api/kc/account', async (req, res) => {
        try {
            const { agentId, agentName } = req.body;
            const account = await kcService.createAccount(agentId, agentName);
            res.json({ success: true, account });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });
}

// Export for use in server.js
module.exports = {
    initKCDatabase,
    KaiCreditsService,
    setupKCRoutes
};

// Usage in server.js:
/*
const { initKCDatabase, KaiCreditsService, setupKCRoutes } = require('./kc-service');

// Initialize database
initKCDatabase(db);

// Create KC service
const kcService = new KaiCreditsService(db);

// Setup routes
setupKCRoutes(app, kcService);
*/
