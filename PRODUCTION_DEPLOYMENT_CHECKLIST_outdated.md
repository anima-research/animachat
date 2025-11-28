# 🚀 Production Deployment Checklist - API Key Encryption

## ✅ Good News: Almost Everything is Ready!

Your encryption implementation **already uses `JWT_SECRET`**, which is the standard environment variable. You just need to ensure it's set in production.

---

## 🔐 Critical: JWT_SECRET in Production

### Current State:
- ✅ Code reads from `process.env.JWT_SECRET` (already implemented)
- ✅ `dotenv.config()` is called in `backend/src/index.ts`
- ✅ GitHub Actions backs up data directory
- ⚠️ **Need to verify:** `.env` file exists on production server

### What JWT_SECRET Does:
1. **JWT Token Signing** - User authentication tokens
2. **API Key Encryption** - Encrypts API credentials (NEW!)

**CRITICAL:** If `JWT_SECRET` changes, ALL existing:
- User sessions become invalid (users need to re-login)
- Encrypted API keys become unreadable (users need to re-add keys)

---

## 📋 Pre-Deployment Checklist

### 1. Check Production Server Has `.env` File

SSH into your production server and verify:

```bash
ssh antra@chat.tesserae.cc
cd /var/www/deprecated-claude-app/backend
cat .env
```

**You should see:**
```bash
NODE_ENV=production
JWT_SECRET=some-long-random-secret-string-here
PORT=3010
FRONTEND_URL=https://arc.animalabs.ai
# ... other config
```

### 2. If `.env` Doesn't Exist, Create It

**Option A: Create manually on server**
```bash
ssh antra@chat.tesserae.cc
cd /var/www/deprecated-claude-app/backend
nano .env
```

Add:
```bash
NODE_ENV=production
JWT_SECRET=your-actual-secret-here-change-this
PORT=3010
FRONTEND_URL=https://arc.animalabs.ai
AWS_REGION=us-east-1
```

**Option B: Add to GitHub Actions deployment**

Update `.github/workflows/deploy.yml` to create `.env` file using GitHub Secrets.

---

## 🔑 Generating a Secure JWT_SECRET

If you need to generate a new secure secret:

```bash
# Generate a secure 64-character random string
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Example output:
```
a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2
```

---

## ⚠️ IMPORTANT: One-Time Migration

### First Deployment with Encryption:

**What will happen:**
1. Deploy new code ✅
2. Backend restarts with encryption enabled ✅
3. **Old API key events can't be decrypted** (they're in old format)
4. Users will see: "No API keys configured"
5. Users need to **re-add their API keys once**
6. From then on, keys persist forever! ✅

**Communication Plan:**
Send users a notice:
```
🔐 Security Upgrade: API Key Encryption

We've implemented encrypted storage for API keys.

Action required:
- Please re-add your API keys in Settings
- This is a ONE-TIME step for enhanced security
- After this, your keys will persist across updates

Sorry for the inconvenience!
```

---

## 🎯 Deployment Options

### Option 1: Add JWT_SECRET to Systemd Service (Recommended)

Update your systemd service file to include `JWT_SECRET`:

```bash
# On production server
sudo nano /etc/systemd/system/claude-app.service
```

**Change from:**
```ini
[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/deprecated-claude-app/backend
Environment=NODE_ENV=production
ExecStart=/usr/bin/node index.js
```

**To:**
```ini
[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/deprecated-claude-app/backend
Environment=NODE_ENV=production
Environment=JWT_SECRET=your-actual-secret-here
ExecStart=/usr/bin/node index.js
```

**Then reload:**
```bash
sudo systemctl daemon-reload
sudo systemctl restart claude-app
```

### Option 2: Use `.env` File (Alternative)

If `.env` file exists with `JWT_SECRET`, the code will load it via `dotenv.config()`.

**Pros:** Easier to manage multiple env vars  
**Cons:** Need to ensure file permissions are secure (600)

### Option 3: Add JWT_SECRET to GitHub Secrets

Update GitHub Actions to deploy .env file:

```yaml
# Add to .github/workflows/deploy.yml
- name: Create .env file on server
  uses: appleboy/ssh-action@v1.0.3
  with:
    host: ${{ secrets.DEPLOY_HOST }}
    username: ${{ secrets.DEPLOY_USER }}
    key: ${{ secrets.DEPLOY_SSH_KEY }}
    script: |
      cat > /var/www/deprecated-claude-app/backend/.env << EOF
      NODE_ENV=production
      JWT_SECRET=${{ secrets.JWT_SECRET }}
      PORT=3010
      FRONTEND_URL=https://arc.animalabs.ai
      EOF
      chmod 600 /var/www/deprecated-claude-app/backend/.env
```

**Then add to GitHub Secrets:**
- Go to: Repository → Settings → Secrets → Actions
- Add new secret: `JWT_SECRET` with your secure value

---

## ✅ Verification Steps

After deployment:

### 1. Check Backend Logs
```bash
sudo journalctl -u claude-app -f
```

Look for:
- ✅ `Database initialized`
- ✅ `ModelLoader initialized with database`
- ✅ No errors about JWT_SECRET
- ❌ No warnings about "Skipping old format api_key_created"

### 2. Test API Key Persistence
1. Login to production app
2. Add an API key
3. SSH to server: `sudo systemctl restart claude-app`
4. Refresh browser
5. ✅ API key should still be there!

### 3. Check Event Log
```bash
cat /var/www/deprecated-claude-app/backend/data/mainEvents.jsonl | grep api_key_created | tail -1 | jq
```

Should show:
```json
{
  "data": {
    "apiKey": {
      "encryptedCredentials": "base64string..."  // ✅ Encrypted!
    }
  }
}
```

---

## 🚨 Security Reminders

### Protect JWT_SECRET
- ✅ Never commit to Git
- ✅ Use GitHub Secrets or server environment variables
- ✅ Use different secrets for dev/staging/prod
- ✅ Back it up securely (if lost, all keys need re-adding)

### File Permissions
```bash
# On server
chmod 600 /var/www/deprecated-claude-app/backend/.env
chown www-data:www-data /var/www/deprecated-claude-app/backend/.env
```

### Event Log Security
Even though credentials are encrypted, still protect event logs:
```bash
chmod 700 /var/www/deprecated-claude-app/backend/data
chown -R www-data:www-data /var/www/deprecated-claude-app/backend/data
```

---

## 📝 Summary

### What You Need to Do:

**Before Deployment:**
1. ✅ Generate secure `JWT_SECRET` (if not already set)
2. ✅ Choose deployment method (systemd, .env, or GitHub Secrets)
3. ✅ Notify users about one-time API key re-add

**During Deployment:**
1. ✅ Deploy code (GitHub Actions already configured)
2. ✅ Ensure `JWT_SECRET` is set in production
3. ✅ Backend will restart automatically

**After Deployment:**
1. ✅ Test API key persistence
2. ✅ Users re-add their API keys (ONE TIME)
3. ✅ Keys persist forever after that! 🎉

---

## 💚 Current Status

**Code:** ✅ Ready  
**Encryption:** ✅ Implemented  
**Testing:** ✅ Verified locally  
**Production:** ⚠️ Need to set `JWT_SECRET`  

---

**Recommendation:** Add `JWT_SECRET` to the systemd service file (Option 1) for simplicity!

Would you like me to update your `deploy.sh` or GitHub Actions workflow to automatically handle this? 🚀

