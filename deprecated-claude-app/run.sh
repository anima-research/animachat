#!/bin/bash

# Deprecated Claude Models Application Startup Script

echo "🚀 Starting Deprecated Claude Models Application..."

# Check if node_modules exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Check if .env exists in backend
if [ ! -f "backend/.env" ]; then
    echo "⚠️  Creating backend .env file from example..."
    cp backend/env.example backend/.env
    echo "📝 Please edit backend/.env with your AWS credentials and JWT secret"
fi

# Start the application
echo "🎯 Starting development servers..."
npm run dev
