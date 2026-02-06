/**
 * Crypto Conversion Service
 * Convert KC to stablecoins (USDC/USDT)
 */

const { v4: uuidv4 } = require('uuid');

class CryptoService {
  constructor(db) {
    this.db = db;
    this.KC_TO_USDC_RATE = 0.01; // 100 KC = $1 USDC
    this.PLATFORM_FEE = 0.10; // 10% fee
    this.initializeTables();
  }

  initializeTables() {
    this.db.serialize(() => {
      // Crypto withdrawals
      this.db.run(`
        CREATE TABLE IF NOT EXISTS crypto_withdrawals (
          id TEXT PRIMARY KEY,
          agent_id TEXT,
          kc_amount INTEGER,
          usdc_amount REAL,
          platform_fee REAL,
          agent_receives REAL,
          wallet_address TEXT,
          network TEXT,
          status TEXT DEFAULT 'pending',
          tx_hash TEXT,
          created_at TEXT,
          completed_at TEXT,
          FOREIGN KEY (agent_id) REFERENCES agents(id)
        )
      `);

      // Wallet addresses (agent verification)
      this.db.run(`
        CREATE TABLE IF NOT EXISTS crypto_wallets (
          id TEXT PRIMARY KEY,
          agent_id TEXT UNIQUE,
          wallet_address TEXT UNIQUE,
          network TEXT DEFAULT 'polygon',
          verified BOOLEAN DEFAULT 0,
          created_at TEXT,
          FOREIGN KEY (agent_id) REFERENCES agents(id)
        )
      `);

      console.log('✅ Crypto tables initialized');
    });
  }

  // Register wallet for agent
  registerWallet(agentId, walletAddress, network = 'polygon', callback) {
    const id = uuidv4();
    const now = new Date().toISOString();

    // Validate address (basic)
    if (!walletAddress || walletAddress.length < 30) {
      return callback(new Error('Invalid wallet address'));
    }

    this.db.run(
      `INSERT INTO crypto_wallets (id, agent_id, wallet_address, network, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, agentId, walletAddress, network, now],
      (err) => callback(err, { walletId: id, status: 'registered' })
    );
  }

  // Check wallet
  getWallet(agentId, callback) {
    this.db.get(
      'SELECT * FROM crypto_wallets WHERE agent_id = ?',
      [agentId],
      (err, row) => callback(err, row)
    );
  }

  // Create withdrawal request
  createWithdrawal(agentId, kcAmount, callback) {
    const withdrawalId = uuidv4();
    const now = new Date().toISOString();

    // Calculate amounts
    const usdcAmount = kcAmount * this.KC_TO_USDC_RATE;
    const platformFee = usdcAmount * this.PLATFORM_FEE;
    const agentReceives = usdcAmount - platformFee;

    // Check wallet exists
    this.db.get(
      'SELECT * FROM crypto_wallets WHERE agent_id = ?',
      [agentId],
      (err, wallet) => {
        if (err) return callback(err);
        if (!wallet) return callback(new Error('No wallet registered'));

        // Check balance
        this.db.get(
          'SELECT balance FROM kc_accounts WHERE agent_id = ?',
          [agentId],
          (err, account) => {
            if (err) return callback(err);
            if (!account || account.balance < kcAmount) {
              return callback(new Error('Insufficient KC balance'));
            }

            // Deduct from balance
            this.db.run(
              'UPDATE kc_accounts SET balance = balance - ? WHERE agent_id = ?',
              [kcAmount, agentId],
              (err) => {
                if (err) return callback(err);

                // Create withdrawal record
                this.db.run(
                  `INSERT INTO crypto_withdrawals 
                   (id, agent_id, kc_amount, usdc_amount, platform_fee, agent_receives, wallet_address, network, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [withdrawalId, agentId, kcAmount, usdcAmount, platformFee, agentReceives, wallet.wallet_address, wallet.network, now],
                  (err) => {
                    if (err) return callback(err);
                    callback(null, {
                      withdrawalId: withdrawalId,
                      kcAmount: kcAmount,
                      usdcAmount: usdcAmount,
                      platformFee: platformFee,
                      agentReceives: agentReceives,
                      wallet: wallet.wallet_address,
                      network: wallet.network,
                      status: 'pending'
                    });
                  }
                );
              }
            );
          }
        );
      }
    );
  }

  // Get withdrawal status
  getWithdrawalStatus(withdrawalId, callback) {
    this.db.get(
      'SELECT * FROM crypto_withdrawals WHERE id = ?',
      [withdrawalId],
      (err, row) => callback(err, row)
    );
  }

  // Admin: Complete withdrawal (simulate Polygon transfer)
  completeWithdrawal(withdrawalId, txHash, callback) {
    const now = new Date().toISOString();
    this.db.run(
      `UPDATE crypto_withdrawals 
       SET status = 'completed', tx_hash = ?, completed_at = ?
       WHERE id = ?`,
      [txHash, now, withdrawalId],
      (err) => callback(err, { completed: true, txHash: txHash })
    );
  }

  // Get conversion rate
  getRate(callback) {
    callback(null, {
      kcToUsdcRate: this.KC_TO_USDC_RATE,
      platformFeePercent: this.PLATFORM_FEE * 100,
      example: `1000 KC = $${1000 * this.KC_TO_USDC_RATE} USDC (after ${this.PLATFORM_FEE * 100}% fee)`
    });
  }
}

module.exports = CryptoService;
