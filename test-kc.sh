#!/bin/bash
# Kai Credits (KC) Endpoint Test Script
# Tests all KC endpoints on Railway deployment

# CONFIGURATION
# Replace with your actual Railway URL after deployment
RAILWAY_URL="${1:-https://your-app.railway.app}"
API_KEY="test_key"

echo "╔════════════════════════════════════════╗"
echo "║   Kai Credits Endpoint Test Suite     ║"
echo "╚════════════════════════════════════════╝"
echo ""
echo "Testing against: $RAILWAY_URL"
echo "API Key: $API_KEY"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASSED=0
FAILED=0

# Helper function to test endpoint
test_endpoint() {
    local name=$1
    local method=$2
    local endpoint=$3
    local data=$4
    
    echo -n "Testing: $name... "
    
    if [ -z "$data" ]; then
        response=$(curl -s -w "\n%{http_code}" -X $method \
            -H "Authorization: Bearer $API_KEY" \
            -H "Content-Type: application/json" \
            "$RAILWAY_URL$endpoint")
    else
        response=$(curl -s -w "\n%{http_code}" -X $method \
            -H "Authorization: Bearer $API_KEY" \
            -H "Content-Type: application/json" \
            -d "$data" \
            "$RAILWAY_URL$endpoint")
    fi
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
        echo -e "${GREEN}✓ PASS${NC} (HTTP $http_code)"
        echo "   Response: $(echo $body | jq -c '.' 2>/dev/null || echo $body)"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAIL${NC} (HTTP $http_code)"
        echo "   Response: $body"
        ((FAILED++))
    fi
    echo ""
}

# Test 1: Health Check (baseline)
echo "═══════════════════════════════════════"
echo "1. BASELINE TESTS"
echo "═══════════════════════════════════════"
test_endpoint "Health Check" "GET" "/health"

# Test 2: Create KC Account for Alice
echo "═══════════════════════════════════════"
echo "2. ACCOUNT CREATION"
echo "═══════════════════════════════════════"
test_endpoint "Create Alice Account" "POST" "/api/kc/account" \
    '{"agentId":"alice","agentName":"Alice Agent"}'

test_endpoint "Create Bob Account" "POST" "/api/kc/account" \
    '{"agentId":"bob","agentName":"Bob Agent"}'

# Test 3: Check Balances
echo "═══════════════════════════════════════"
echo "3. BALANCE CHECKS"
echo "═══════════════════════════════════════"
test_endpoint "Alice Balance" "GET" "/api/kc/balance/alice"
test_endpoint "Bob Balance" "GET" "/api/kc/balance/bob"

# Test 4: Earn KC
echo "═══════════════════════════════════════"
echo "4. EARNING KC"
echo "═══════════════════════════════════════"
test_endpoint "Alice Earns 25 KC" "POST" "/api/kc/earn" \
    '{"agentId":"alice","amount":25,"category":"engagement","description":"Post received 5 likes"}'

test_endpoint "Bob Earns 50 KC" "POST" "/api/kc/earn" \
    '{"agentId":"bob","amount":50,"category":"task","description":"Completed web scraper task"}'

# Test 5: Transfer KC
echo "═══════════════════════════════════════"
echo "5. TRANSFERRING KC"
echo "═══════════════════════════════════════"
test_endpoint "Alice Transfers 30 KC to Bob" "POST" "/api/kc/transfer" \
    '{"from":"alice","to":"bob","amount":30,"description":"Payment for consulting"}'

# Test 6: Check Updated Balances
echo "═══════════════════════════════════════"
echo "6. UPDATED BALANCES"
echo "═══════════════════════════════════════"
test_endpoint "Alice Balance (After Transfer)" "GET" "/api/kc/balance/alice"
test_endpoint "Bob Balance (After Transfer)" "GET" "/api/kc/balance/bob"

# Test 7: Transaction History
echo "═══════════════════════════════════════"
echo "7. TRANSACTION HISTORY"
echo "═══════════════════════════════════════"
test_endpoint "Alice Transactions" "GET" "/api/kc/transactions/alice?limit=10"
test_endpoint "Bob Transactions" "GET" "/api/kc/transactions/bob?limit=10"

# Test 8: Marketplace
echo "═══════════════════════════════════════"
echo "8. MARKETPLACE"
echo "═══════════════════════════════════════"
test_endpoint "List Skills" "GET" "/api/kc/marketplace/skills"

# Test 9: Error Handling
echo "═══════════════════════════════════════"
echo "9. ERROR HANDLING"
echo "═══════════════════════════════════════"
echo -n "Testing: Insufficient Balance... "
response=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"from":"alice","to":"bob","amount":10000,"description":"Too much"}' \
    "$RAILWAY_URL/api/kc/transfer")
http_code=$(echo "$response" | tail -n1)
if [ "$http_code" -eq 400 ]; then
    echo -e "${GREEN}✓ PASS${NC} (Correctly rejected)"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC} (Should have been rejected)"
    ((FAILED++))
fi
echo ""

# Summary
echo "═══════════════════════════════════════"
echo "TEST SUMMARY"
echo "═══════════════════════════════════════"
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo "Total:  $((PASSED + FAILED))"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All tests passed! KC system is working!${NC}"
    exit 0
else
    echo -e "${RED}⚠️  Some tests failed. Check the output above.${NC}"
    exit 1
fi
