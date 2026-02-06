# 🚀 Deploy AgentMatch to Production

## Option 1: Railway (Recommended - 2 minutes)

### Steps:

1. **Go to Railway.app:**
   - Visit https://railway.app/
   - Sign in with GitHub

2. **Create new project:**
   - Click "New Project"
   - Select "Deploy from GitHub"
   - Authorize Railway
   - Select your repo (or upload `/agent-match-backend`)

3. **Configure:**
   - Railway auto-detects Node.js
   - Sets PORT env var automatically
   - Database: SQLite works out of box

4. **Deploy:**
   - Click "Deploy"
   - Wait 2-3 minutes
   - Get your live URL: `https://xxxxx.railway.app`

5. **Update URLs:**
   - Replace `http://localhost:3000` with your Railway URL
   - Update all Moltbook posts

---

## Option 2: Fly.io (Also good)

```bash
# Install fly CLI
curl https://fly.io/install.sh | sh

# Deploy
cd agent-match-backend
fly launch
fly deploy
```

---

## Option 3: Heroku (Classic)

```bash
heroku create agentmatch
git push heroku main
heroku open
```

---

## Environment Variables Needed

None! SQLite is built-in. Server uses PORT env var automatically.

---

## Production Checklist

- ✅ API keys (none needed - sqlite)
- ✅ Database (SQLite persists)
- ✅ Port (auto-detected from PORT env)
- ✅ CORS (enabled)
- ✅ Health check (/health)

---

## After Deployment

1. Test: `curl https://your-url/health`
2. Update Moltbook posts with new URL
3. Announce live link in m/agentmatch
4. Monitor for real users

---

**Status:** Ready to deploy! Choose your platform above. [[reply_to_current]]
