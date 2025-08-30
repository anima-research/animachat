#!/bin/bash

# Script to examine existing nginx configuration on remote server
# Run this script on the remote server: ssh antra@chat.tesserae.cc 'bash -s' < examine-nginx.sh

echo "=== NGINX CONFIGURATION EXAMINATION ==="
echo "Server: $(hostname)"
echo "Date: $(date)"
echo

echo "=== 1. NGINX STATUS ==="
sudo systemctl status nginx --no-pager -l
echo

echo "=== 2. NGINX VERSION ==="
nginx -v
echo

echo "=== 3. NGINX CONFIGURATION STRUCTURE ==="
echo "Main config file:"
ls -la /etc/nginx/nginx.conf
echo

echo "Sites available:"
ls -la /etc/nginx/sites-available/
echo

echo "Sites enabled:"
ls -la /etc/nginx/sites-enabled/
echo

echo "=== 4. MAIN NGINX CONFIGURATION ==="
echo "--- /etc/nginx/nginx.conf ---"
cat /etc/nginx/nginx.conf
echo

echo "=== 5. EXISTING SITE CONFIGURATIONS ==="
for site in /etc/nginx/sites-available/*; do
    if [ -f "$site" ]; then
        echo "--- $site ---"
        cat "$site"
        echo
    fi
done

echo "=== 6. LISTENING PORTS ==="
sudo netstat -tlnp | grep nginx
echo

echo "=== 7. RUNNING PROCESSES ==="
ps aux | grep nginx
echo

echo "=== 8. AVAILABLE DISK SPACE ==="
df -h /var/www/
echo

echo "=== 9. EXISTING WEB DIRECTORIES ==="
ls -la /var/www/
echo

echo "=== 10. NODE.JS STATUS ==="
if command -v node &> /dev/null; then
    echo "Node.js version: $(node --version)"
    echo "NPM version: $(npm --version)"
else
    echo "Node.js is not installed"
fi
echo

echo "=== 11. RUNNING NODE PROCESSES ==="
ps aux | grep node
echo

echo "=== 12. SYSTEMD SERVICES ==="
sudo systemctl list-units --type=service --state=running | grep -E "(nginx|node|pm2)"
echo

echo "=== EXAMINATION COMPLETE ==="
