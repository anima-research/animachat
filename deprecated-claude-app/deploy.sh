#!/bin/bash

# Deployment script for Deprecated Claude App
# This script handles the complete deployment process

set -e  # Exit on any error

# Configuration - Update these variables
REMOTE_HOST=""              # e.g., "user@your-server.com"
REMOTE_PATH="/var/www/deprecated-claude-app"
APP_NAME="deprecated-claude-app"
SERVICE_NAME="claude-app"
DOMAIN="your-domain.com"    # Update this
DEPLOY_MODE="path"          # "path" for /claude-app or "subdomain" for claude-app.domain.com

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}"
    exit 1
}

# Check if remote host is set
if [ -z "$REMOTE_HOST" ]; then
    error "Please set REMOTE_HOST in the script configuration"
fi

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
log "Checking prerequisites..."
if ! command_exists ssh; then
    error "SSH is not installed"
fi

if ! command_exists rsync; then
    error "rsync is not installed"
fi

if ! command_exists npm; then
    error "npm is not installed"
fi

# Build the application locally
log "Building application locally..."
npm ci
npm run build

if [ ! -d "frontend/dist" ] || [ ! -d "backend/dist" ]; then
    error "Build failed - dist directories not found"
fi

# Create deployment package
log "Creating deployment package..."
mkdir -p deploy-temp
cp -r frontend/dist deploy-temp/frontend
cp -r backend/dist deploy-temp/backend
cp backend/package.json deploy-temp/backend/
cp -r shared/dist deploy-temp/shared
cp shared/package.json deploy-temp/shared/
cp nginx.conf deploy-temp/
cp backend/.env.example deploy-temp/env.example

# Copy configuration files
if [ -f backend/config/models.json ]; then
    mkdir -p deploy-temp/backend/config
    cp backend/config/models.json deploy-temp/backend/config/
    log "Including models.json in deployment package"
fi

# Create systemd service file
cat > deploy-temp/claude-app.service << EOF
[Unit]
Description=Deprecated Claude App Backend
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=$REMOTE_PATH/backend
Environment=NODE_ENV=production
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Create remote installation script
cat > deploy-temp/remote-install.sh << 'EOF'
#!/bin/bash

set -e

REMOTE_PATH="/var/www/deprecated-claude-app"
SERVICE_NAME="claude-app"

log() {
    echo -e "\033[0;32m[$(date +'%Y-%m-%d %H:%M:%S')] $1\033[0m"
}

error() {
    echo -e "\033[0;31m[ERROR] $1\033[0m"
    exit 1
}

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then
    error "Please run this script as root or with sudo"
fi

log "Installing Node.js if not present..."
if ! command -v node >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    apt-get install -y nodejs
fi

log "Creating application directory..."
mkdir -p $REMOTE_PATH
chown -R www-data:www-data $REMOTE_PATH

log "Installing backend dependencies..."
cd $REMOTE_PATH/backend
npm ci --production

log "Setting up environment file..."
if [ ! -f .env ]; then
    cp ../env.example .env
    log "Created .env file from example - please configure it"
else
    log ".env file already exists"
fi

log "Setting up configuration files..."
if [ ! -d /etc/claude-app ]; then
    mkdir -p /etc/claude-app
fi

# Copy models.json if it doesn't exist
if [ ! -f /etc/claude-app/models.json ]; then
    if [ -f $REMOTE_PATH/backend/config/models.json ]; then
        cp $REMOTE_PATH/backend/config/models.json /etc/claude-app/models.json
        chown www-data:www-data /etc/claude-app/models.json
        chmod 644 /etc/claude-app/models.json
        log "Copied models.json to /etc/claude-app/"
    else
        log "WARNING: models.json not found in deployment package"
    fi
else
    log "models.json already exists in /etc/claude-app/"
fi

# Note about config.json
if [ ! -f /etc/claude-app/config.json ]; then
    log "WARNING: config.json not found in /etc/claude-app/ - please create it"
fi

log "Setting up systemd service..."
cp ../claude-app.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable $SERVICE_NAME

log "Configuring nginx..."
# Backup existing nginx config if it exists
if [ -f /etc/nginx/sites-available/claude-app ]; then
    cp /etc/nginx/sites-available/claude-app /etc/nginx/sites-available/claude-app.backup.$(date +%s)
fi

cp ../nginx.conf /etc/nginx/sites-available/claude-app

# Create symlink if it doesn't exist
if [ ! -L /etc/nginx/sites-enabled/claude-app ]; then
    ln -s /etc/nginx/sites-available/claude-app /etc/nginx/sites-enabled/
fi

log "Testing nginx configuration..."
nginx -t

log "Starting services..."
systemctl restart $SERVICE_NAME
systemctl reload nginx

log "Deployment completed successfully!"
log "Backend service status:"
systemctl status $SERVICE_NAME --no-pager -l

log "Setting up configuration files..."
if [ ! -d /etc/claude-app ]; then
    mkdir -p /etc/claude-app
fi

# Copy models.json if it doesn't exist
if [ ! -f /etc/claude-app/models.json ]; then
    if [ -f $REMOTE_PATH/backend/config/models.json ]; then
        cp $REMOTE_PATH/backend/config/models.json /etc/claude-app/models.json
        chown www-data:www-data /etc/claude-app/models.json
        chmod 644 /etc/claude-app/models.json
        log "Copied models.json to /etc/claude-app/"
    else
        log "WARNING: models.json not found in deployment package"
    fi
else
    log "models.json already exists in /etc/claude-app/"
fi

# Note about config.json
if [ ! -f /etc/claude-app/config.json ]; then
    log "WARNING: config.json not found in /etc/claude-app/ - please create it"
fi

log "Don't forget to:"
log "1. Configure $REMOTE_PATH/backend/.env with your settings"
log "2. Update the domain name in /etc/nginx/sites-available/claude-app"
log "3. Set up SSL certificate if needed"
log "4. Configure firewall rules if necessary"
log "5. Create /etc/claude-app/config.json with your API keys"
EOF

chmod +x deploy-temp/remote-install.sh

# Transfer files to remote server
log "Transferring files to remote server..."
ssh $REMOTE_HOST "sudo mkdir -p $REMOTE_PATH && sudo chown -R \$USER:www-data $REMOTE_PATH"

rsync -avz --progress deploy-temp/ $REMOTE_HOST:$REMOTE_PATH/

# Execute remote installation
log "Executing remote installation..."
ssh $REMOTE_HOST "cd $REMOTE_PATH && sudo ./remote-install.sh"

# Clean up
log "Cleaning up temporary files..."
rm -rf deploy-temp

log "Deployment completed!"
log ""
log "Next steps:"
log "1. SSH to your server: ssh $REMOTE_HOST"
log "2. Configure environment: sudo nano $REMOTE_PATH/backend/.env"
log "3. Update nginx domain: sudo nano /etc/nginx/sites-available/claude-app"
log "4. Restart services: sudo systemctl restart claude-app && sudo systemctl reload nginx"
log "5. Set up SSL certificate with certbot if needed"
log ""
log "Your application should be available at:"
if [ "$DEPLOY_MODE" = "subdomain" ]; then
    log "http://claude-app.$DOMAIN"
else
    log "http://$DOMAIN/claude-app"
fi
