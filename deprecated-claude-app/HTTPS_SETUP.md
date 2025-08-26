# HTTPS Setup Guide

This guide explains how to enable HTTPS support for the Claude app backend server.

## Overview

The application supports both HTTP and HTTPS modes. When HTTPS is enabled, it also supports secure WebSocket connections (WSS).

## Environment Variables

Add these variables to your `.env` file:

```bash
# Enable HTTPS
USE_HTTPS=true

# HTTPS port (default: 3443)
HTTPS_PORT=3443

# HTTP redirect (optional)
HTTP_REDIRECT=true

# SSL Certificate paths (default: ./certs/)
SSL_CERT_PATH=./certs/cert.pem
SSL_KEY_PATH=./certs/key.pem
SSL_CA_PATH=./certs/ca.pem  # Optional CA bundle
```

## Certificate Setup

### Option 1: Self-Signed Certificates (Development)

For local development, you can generate self-signed certificates:

```bash
# Create certs directory
mkdir -p deprecated-claude-app/backend/certs
cd deprecated-claude-app/backend/certs

# Generate self-signed certificate
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
```

### Option 2: Let's Encrypt (Production)

For production, use Let's Encrypt with certbot:

```bash
# Install certbot
sudo apt-get update
sudo apt-get install certbot

# Generate certificate (replace example.com with your domain)
sudo certbot certonly --standalone -d example.com

# Certificates will be in /etc/letsencrypt/live/example.com/
# Update .env with the paths:
SSL_CERT_PATH=/etc/letsencrypt/live/example.com/fullchain.pem
SSL_KEY_PATH=/etc/letsencrypt/live/example.com/privkey.pem
```

### Option 3: Commercial SSL Certificate

1. Purchase an SSL certificate from a Certificate Authority (CA)
2. Download the certificate files (usually .crt and .key files)
3. Place them in the certs directory
4. Update the paths in .env

## Frontend Configuration

Update the frontend to use HTTPS/WSS URLs when connecting to the backend:

### Update API Base URL

In `frontend/src/api/index.ts` or wherever your API configuration is:

```typescript
const API_BASE_URL = process.env.NODE_ENV === 'production' 
  ? 'https://your-domain.com:3443/api'
  : 'http://localhost:3010/api';
```

### Update WebSocket URL

In `frontend/src/websocket.ts`:

```typescript
const WS_URL = process.env.NODE_ENV === 'production'
  ? 'wss://your-domain.com:3443'
  : 'ws://localhost:3010';
```

## Running with HTTPS

### Development

1. Generate self-signed certificates (see above)
2. Update `.env` file with `USE_HTTPS=true`
3. Start the server:
   ```bash
   npm run dev
   ```

### Production

1. Set up proper SSL certificates
2. Update environment variables
3. Consider using a reverse proxy (nginx) for better performance
4. Start the server:
   ```bash
   npm run build
   npm start
   ```

## Nginx Reverse Proxy (Recommended for Production)

Instead of handling HTTPS directly in Node.js, it's recommended to use nginx as a reverse proxy:

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # WebSocket support
    location /ws {
        proxy_pass http://localhost:3010;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API routes
    location /api {
        proxy_pass http://localhost:3010;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Frontend (if serving from same domain)
    location / {
        proxy_pass http://localhost:5173;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# HTTP to HTTPS redirect
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}
```

## Security Considerations

1. **Certificate Security**: Keep private keys secure and never commit them to version control
2. **HSTS**: Consider enabling HTTP Strict Transport Security
3. **Certificate Renewal**: Set up automatic renewal for Let's Encrypt certificates
4. **Cipher Suites**: Configure strong cipher suites in production
5. **Certificate Pinning**: Consider implementing certificate pinning for mobile apps

## Troubleshooting

### Common Issues

1. **"SSL certificate files not found!"**
   - Ensure certificate files exist in the specified paths
   - Check file permissions

2. **"ERR_CERT_AUTHORITY_INVALID" in browser**
   - This is normal for self-signed certificates
   - Add exception in browser or use proper certificates

3. **WebSocket connection fails**
   - Ensure you're using `wss://` protocol for HTTPS
   - Check that WebSocket upgrade headers are properly forwarded

4. **Mixed content warnings**
   - Ensure all resources (API, WebSocket) use HTTPS
   - Update all hardcoded HTTP URLs to HTTPS

## Testing HTTPS

Test your HTTPS setup:

```bash
# Test HTTPS endpoint
curl -k https://localhost:3443/health

# Test with verbose output
curl -kv https://localhost:3443/health

# Test WebSocket over HTTPS (using wscat)
npm install -g wscat
wscat -c wss://localhost:3443 --no-check
```
