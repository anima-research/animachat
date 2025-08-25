#!/bin/bash

# Deprecated Claude Models Application Startup Script

echo "🚀 Starting Deprecated Claude Models Application..."

# Clean up caches and build artifacts
echo "🧹 Cleaning up caches and build artifacts..."
rm -rf node_modules/.cache
rm -rf */node_modules/.cache
rm -rf */dist
rm -rf shared/lib

# Fresh install of dependencies
echo "📦 Installing dependencies..."
npm ci

# Check if .env exists in backend
if [ ! -f "backend/.env" ]; then
    echo "⚠️  Creating backend .env file from example..."
    cp backend/env.example backend/.env
    echo "📝 Please edit backend/.env with your AWS credentials and JWT secret"
fi

# Build shared package first
echo "🔨 Building shared package..."
npm run build -w shared

# Start the application
echo "🎯 Starting development servers..."
npm run dev