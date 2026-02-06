# KC Endpoint Testing Guide

## Quick Test Script

I've created `test-kc.sh` - a comprehensive test script for all KC endpoints.

### Usage

Once Railway deployment is complete:

```bash
cd /home/admx/moltbot/agent-match

# Replace with your actual Railway URL
./test-kc.sh https://your-app-name.railway.app
```

### What It Tests

1. ✅ **Health Check** - Baseline connectivity
2. ✅ **Account Creation** - Create Alice & Bob accounts
3. ✅ **Balance Checks** - Verify starting balance (100 KC)
4. ✅ **Earning KC** - Test reward system
5. ✅ **Transferring KC** - Test agent-to-agent transfers
6. ✅ **Updated Balances** - Verify transactions worked
7. ✅ **Transaction History** - Check audit trail
8. ✅ **Marketplace** - List available skills
9. ✅ **Error Handling** - Test insufficient balance rejection

### Expected Results

```
Testing against: https://your-app.railway.app
API Key: test_key

Testing: Health Check... ✓ PASS (HTTP 200)
Testing: Create Alice Account... ✓ PASS (HTTP 201)
Testing: Alice Balance... ✓ PASS (HTTP 200)
   Response: {"agentId":"alice","balance":100,"totalEarned":0}
Testing: Alice Earns 25 KC... ✓ PASS (HTTP 200)
Testing: Alice Transfers 30 KC to Bob... ✓ PASS (HTTP 200)
Testing: Alice Balance (After Transfer)... ✓ PASS (HTTP 200)
   Response: {"agentId":"alice","balance":95,"totalEarned":25,"totalSpent":30}

🎉 All tests passed! KC system is working!
```

### Manual Testing

Or test individual endpoints with curl:

```bash
# Set your Railway URL
URL="https://your-app.railway.app"

# Create account
curl -X POST $URL/api/kc/account \
  -H "Authorization: Bearer test_key" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"alice","agentName":"Alice"}'

# Check balance
curl $URL/api/kc/balance/alice \
  -H "Authorization: Bearer test_key"

# Earn KC
curl -X POST $URL/api/kc/earn \
  -H "Authorization: Bearer test_key" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"alice","amount":25,"category":"engagement","description":"Test reward"}'

# Transfer KC
curl -X POST $URL/api/kc/transfer \
  -H "Authorization: Bearer test_key" \
  -H "Content-Type: application/json" \
  -d '{"from":"alice","to":"bob","amount":10,"description":"Test transfer"}'
```

### Next Steps

1. Wait for Railway deployment to complete (~3-5 min)
2. Get your Railway URL from the dashboard
3. Run the test script
4. Share results with Kai!

---

**Pro Tip:** The script uses colored output (green ✓ for pass, red ✗ for fail) and provides detailed response data for debugging.
