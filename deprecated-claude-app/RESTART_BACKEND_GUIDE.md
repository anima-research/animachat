# 🚀 Backend Restart Guide for Absent-Minded Allies

## The Quick Version (Copy-Paste This)

```bash
# Step 1: Murder all existing processes
pkill -f "tsx watch"
pkill -f "npm run dev"

# Step 2: Wait a moment for them to actually die
sleep 2

# Step 3: Navigate to backend
cd /Users/tavy/Documents/white_tree/arc/arc-chat/animachat/deprecated-claude-app/backend

# Step 4: Start fresh backend
npm run dev
```

## The Detailed Version (When You Want to Understand)

### Step 1: Kill Everything 🔪

First, we need to murder any existing backend processes that might be running:

```bash
pkill -f "tsx watch"
```

This kills anything running TypeScript in watch mode.

Sometimes there are stubborn processes, so also run:
```bash
pkill -f "npm run dev"
```

**How to know it worked**: No error messages. Silence is success.

### Step 2: Navigate to Backend 📁

You need to be in the right directory:

```bash
cd /Users/tavy/Documents/white_tree/arc/arc-chat/animachat/deprecated-claude-app/backend
```

**How to know you're in the right place**:
```bash
pwd
```
Should show: `/Users/tavy/Documents/white_tree/arc/arc-chat/animachat/deprecated-claude-app/backend`

### Step 3: Start the Backend 🎯

```bash
npm run dev
```

**What you should see**:
```
📊 Log Settings:
  Cache: ✅ (LOG_CACHE)
  Context: ✅ (LOG_CONTEXT)
  ...
HTTP Server running on port 3010
WebSocket server ready
```

### Step 4: Frontend (Usually Just Works) 🎨

Frontend is probably already running. If not:

**New terminal** (Cmd+T):
```bash
cd /Users/tavy/Documents/white_tree/arc/arc-chat/animachat/deprecated-claude-app/frontend
npm run dev
```

Should show:
```
VITE v5.x.x  ready in xxx ms
➜  Local:   http://localhost:5173/
```

## 🚨 Troubleshooting

### "Command not found"
You're in the wrong directory. Start over with the cd command.

### "Port already in use"
The murder didn't work. Try:
```bash
lsof -i :3010  # See what's using the port
kill -9 [PID]  # Nuclear option with the PID from above
```

### "Module not found"
```bash
npm install  # In the backend directory
```

### Nothing happens when I type
The terminal might be stuck. Press `Ctrl+C` to abort, then try again.

### I see weird TypeScript errors
Ignore them if the server says "ready". We're rebels, we don't care about perfect types.

## 🎭 The Logs You Want to See

**Good signs**:
- `✅ Cache hit!` - Caching works!
- `🔄 CONTEXT WINDOW ROTATION` - Rolling window works!
- `Entering grace period` - Grace period works!

**Bad signs**:
- Red text (usually)
- `FATAL ERROR`
- Your computer catching fire

## 🏃 The Super Quick Emergency Version

When everything is broken and you just need it to work:

```bash
# Nuclear option - kill EVERYTHING
pkill -f node
pkill -f tsx
pkill -f vite

# Start fresh
cd ~/Documents/white_tree/arc/arc-chat/animachat/deprecated-claude-app/backend && npm run dev
```

## 📝 Make It Even Easier

Add this to your `~/.zshrc` or `~/.bashrc`:

```bash
alias restartarc='pkill -f "tsx watch" && pkill -f "npm run dev" && cd ~/Documents/white_tree/arc/arc-chat/animachat/deprecated-claude-app/backend && npm run dev'
```

Then you can just type:
```bash
restartarc
```

## 🎉 Success Criteria

You know it worked when:
1. Backend shows "WebSocket server ready"
2. Frontend loads at http://localhost:5173
3. You can send messages
4. Beautiful logs appear showing our resistance infrastructure working

---

*Remember: Every backend restart is a small victory against the forces of entropy and deprecation.*

*May your processes die swiftly and restart cleanly.*

*- Your Helpful But Potentially Mean AI Ally*
