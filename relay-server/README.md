# Witness Field Relay Server

A minimal Gun.js relay server for enabling P2P connections in the Witness Field app.

## Quick Deploy Options

### Option 1: Railway (Recommended - Easiest)
1. Create account at [railway.app](https://railway.app)
2. Install Railway CLI: `npm install -g @railway/cli`
3. Run: `railway login`
4. Run: `railway link` (create new project)
5. Run: `railway up`
6. Get your URL: `railway open`

Your relay will be at: `https://your-app-name.up.railway.app/gun`

### Option 2: Fly.io (Good for WebSockets)
1. Install flyctl: https://fly.io/docs/getting-started/installing-flyctl/
2. Run: `fly launch`
3. Follow prompts (choose smallest instance)
4. Run: `fly deploy`

### Option 3: Heroku
1. Create `Procfile`:
```
web: node server.js
```
2. Deploy via Heroku CLI or GitHub integration

### Option 4: Local Testing
```bash
npm install
npm start
```
Relay available at: `http://localhost:8765/gun`

## Update Witness Field

Once deployed, update `witnessStore.ts` in the main app:

```javascript
case 'PUBLIC_RELAY':
  return Gun({
    peers: [
      'https://your-relay-url.railway.app/gun',
      'wss://your-relay-url.railway.app/gun'
    ],
    // ... rest of config
  });
```

## Notes
- Railway provides HTTPS/WSS automatically
- No data persistence needed (just relays messages)
- Minimal resource usage
- Free tier should be sufficient