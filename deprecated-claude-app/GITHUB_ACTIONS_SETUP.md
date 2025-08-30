# GitHub Actions Deployment Setup

## Why GitHub Actions is More Robust

1. **Isolated Build Environment**
   - Fresh Ubuntu container for each build
   - Consistent Node.js version via actions/setup-node
   - No interference from other processes

2. **Proper Dependency Management**
   - `npm ci` with full dev dependencies for build
   - Clean artifact preparation
   - Separate production install on server

3. **Built-in Secret Management**
   - SSH keys stored securely in GitHub Secrets
   - No hardcoded credentials
   - Environment-specific configuration

4. **Atomic Deployments**
   - Build artifacts prepared before touching production
   - Backup before deployment
   - Automatic rollback on failure

5. **Better Error Handling**
   - Each step can fail independently
   - Clear logs for each phase
   - Health checks to verify deployment

## Setup Instructions

### 1. Create GitHub Secrets

In your GitHub repository, go to Settings → Secrets and variables → Actions, and add:

- `DEPLOY_HOST`: `chat.tesserae.cc`
- `DEPLOY_USER`: `antra`
- `DEPLOY_SSH_KEY`: The private SSH key content (the one that matches the public key on the server)

### 2. Ensure Server Access

On the server, make sure:
```bash
# The GitHub Actions runner can SSH in
grep "ssh-" ~/.ssh/authorized_keys  # Should contain the public key

# sudoers is configured (already done)
sudo cat /etc/sudoers.d/claude-deploy
```

### 3. Create Health Check Endpoint (Optional)

Add to your backend:
```javascript
// In backend/src/index.ts or a routes file
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || 'unknown'
  });
});
```

### 4. Remove the Webhook Server

Once GitHub Actions is working:
```bash
# On the server
sudo systemctl stop deploy-webhook
sudo systemctl disable deploy-webhook
sudo rm /etc/systemd/system/deploy-webhook.service
sudo systemctl daemon-reload

# Remove webhook from nginx
# Edit /etc/nginx/sites-available/arc-animalabs and remove the /webhook location
sudo nginx -t
sudo systemctl reload nginx
```

## Advantages Over Current Webhook

1. **No Node.js Version Issues**: Actions controls the exact version
2. **No Permission Juggling**: Runs as GitHub, deploys via SSH
3. **No npm Workspace Confusion**: Build happens in isolation
4. **Parallel Jobs**: Can run tests, linting, multiple deployments
5. **PR Previews**: Can deploy PR branches to staging
6. **Notifications**: Built-in Slack/email/Discord integrations
7. **Audit Trail**: Every deployment is logged with who triggered it

## Migration Path

1. Keep webhook running initially
2. Test GitHub Actions with a test branch
3. Once verified, update main branch to trigger both
4. Monitor both for a few deployments
5. Disable webhook once confident

## Advanced Features You Could Add

```yaml
# Run tests before deployment
- name: Run tests
  working-directory: deprecated-claude-app
  run: |
    npm test -w shared
    npm test -w backend
    npm test -w frontend

# Deploy to staging first
- name: Deploy to staging
  if: github.ref != 'refs/heads/main'
  # ... deploy to staging server

# Cache Docker layers
- name: Build Docker image
  run: docker build -t myapp:${{ github.sha }} .

# Blue-green deployment
- name: Deploy to inactive color
  # ... deploy to blue/green, then switch
```

## Cost

- GitHub Actions free tier: 2,000 minutes/month for private repos
- Your deployment takes ~2-3 minutes
- Can do ~600-900 deployments/month for free
