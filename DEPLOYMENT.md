# CollabBoard: Unified Cloudflare Edge Deployment Guide

## Architecture Overview

CollabBoard uses a **Unified Cloudflare Edge Architecture**:
- **Frontend:** Cloudflare Pages (React SPA)
- **Backend:** Cloudflare Workers (Edge API + WebSockets)
- **Database:** Cloudflare Durable Objects (SQLite)

Everything runs on Cloudflare's global edge network for optimal performance.

---

## Prerequisites

1. **Cloudflare Account** (free tier)
   - Sign up at https://dash.cloudflare.com/sign-up

2. **Wrangler CLI** (already installed)
   - Backend: `backend/node_modules/.bin/wrangler`
   - Frontend: `frontend/node_modules/.bin/wrangler`

3. **Clerk Account** (authentication)
   - Get your keys from https://dashboard.clerk.com

---

## Part 1: Deploy Backend (Cloudflare Workers)

### Step 1: Authenticate Wrangler

```bash
cd backend
npx wrangler login
```

This opens a browser window to authenticate with Cloudflare.

### Step 2: Set Production Secrets

```bash
# Set Clerk publishable key
npx wrangler secret put CLERK_PUBLISHABLE_KEY
# Paste your key when prompted: pk_live_xxxxx

# Set Clerk secret key  
npx wrangler secret put CLERK_SECRET_KEY
# Paste your key when prompted: sk_live_xxxxx

# Set Anthropic API key (for Phase 3 AI features)
npx wrangler secret put ANTHROPIC_API_KEY
# Paste your key when prompted: sk-ant-xxxxx
```

### Step 3: Deploy Backend

```bash
# From /backend directory
npm run deploy

# OR from root directory
npm run deploy:backend
```

**Expected Output:**
```
✨ Built successfully
🌍 Uploading...
✨ Deployment complete!

🚀 Published collabboard-backend
   https://collabboard-backend.your-subdomain.workers.dev
```

**Save this URL!** You'll need it for the frontend configuration.

---

## Part 2: Deploy Frontend (Cloudflare Pages)

### Step 1: Update Frontend Environment

Create `/frontend/.env.production`:

```bash
# Clerk (use LIVE keys for production)
VITE_CLERK_PUBLISHABLE_KEY=pk_live_your_key_here

# Backend WebSocket URL (from backend deployment)
VITE_BACKEND_WS_URL=wss://collabboard-backend.your-subdomain.workers.dev
```

**Important:** 
- Use `wss://` (not `ws://`) for production
- Use your actual Worker URL from Step 3 above

### Step 2: Build Frontend

```bash
# From /frontend directory
npm run build

# OR from root directory
npm run build:frontend
```

This creates an optimized production build in `/frontend/dist`.

### Step 3: Deploy to Cloudflare Pages

```bash
# From /frontend directory
npm run deploy

# OR from root directory  
npm run deploy:frontend
```

**On first deployment, you'll be prompted:**
```
? Create a new project? (Y/n) Y
? Enter the name of your new project: collabboard
? Enter the production branch name: main
```

**Expected Output:**
```
✨ Compiled Worker successfully
🌍 Uploading...
✨ Deployment complete!

🚀 Deployed to Cloudflare Pages
   https://collabboard.pages.dev
```

---

## Part 3: Configure Clerk Production

### Step 1: Add Production URLs to Clerk

Go to https://dashboard.clerk.com → Your App → Settings:

1. **Authorized Redirect URLs:**
   - Add: `https://collabboard.pages.dev`
   - Add: `https://collabboard.pages.dev/*`

2. **Authorized Origins:**
   - Add: `https://collabboard.pages.dev`

### Step 2: Update CORS on Backend (if needed)

If you encounter CORS errors, update `/backend/src/index.ts`:

```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://collabboard.pages.dev',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
```

Then redeploy the backend: `npm run deploy:backend`

---

## Quick Deploy Commands (Summary)

### Deploy Both (from root):
```bash
npm run deploy:backend && npm run deploy:frontend
```

### Deploy Backend Only:
```bash
cd backend
npm run deploy
```

### Deploy Frontend Only:
```bash
cd frontend  
npm run deploy
```

---

## Production URLs

After deployment, your app will be available at:

- **Frontend:** `https://collabboard.pages.dev`
- **Backend:** `https://collabboard-backend.your-subdomain.workers.dev`

---

## Monitoring & Logs

### View Backend Logs:
```bash
cd backend
npx wrangler tail
```

### View Pages Deployment:
```bash
cd frontend
npx wrangler pages deployment list
```

### Cloudflare Dashboard:
- Workers: https://dash.cloudflare.com → Workers & Pages
- Analytics: Real-time metrics for both frontend and backend

---

## Rollback (if needed)

### Rollback Backend:
```bash
cd backend
npx wrangler rollback
```

### Rollback Frontend:
```bash
cd frontend
npx wrangler pages deployment list
npx wrangler pages deployment rollback <deployment-id>
```

---

## Custom Domain (Optional)

### Add Custom Domain to Pages:
1. Go to Cloudflare Dashboard → Pages → collabboard
2. Click "Custom domains" → "Set up a custom domain"
3. Follow the wizard to add your domain

### Update Backend CORS:
After adding a custom domain, update CORS headers in the backend to allow your custom domain.

---

## Troubleshooting

### Issue: "Authentication failed" errors

**Solution:** Verify environment variables
```bash
# Check backend secrets
cd backend
npx wrangler secret list

# Verify frontend .env.production
cat .env.production
```

### Issue: WebSocket connection fails

**Solution:** Check backend URL
- Ensure `VITE_BACKEND_WS_URL` uses `wss://` (not `ws://`)
- Verify the Worker URL is correct

### Issue: CORS errors

**Solution:** Update CORS headers
- Add your Pages URL to `corsHeaders` in `/backend/src/index.ts`
- Redeploy backend

---

## Cost & Limits (Free Tier)

### Cloudflare Workers:
- ✅ 100,000 requests/day
- ✅ 10ms CPU time per request
- ✅ Unlimited Durable Objects

### Cloudflare Pages:
- ✅ 500 builds/month
- ✅ Unlimited requests
- ✅ Unlimited bandwidth

**Your app stays 100% free on these limits!**

---

## Next Steps

1. ✅ Test your production deployment
2. ✅ Share the Pages URL with collaborators
3. ✅ Monitor usage in Cloudflare Dashboard
4. 🚀 Ship Phase 3: AI Features!

---

**Questions?** Check the Cloudflare Docs:
- Pages: https://developers.cloudflare.com/pages
- Workers: https://developers.cloudflare.com/workers
