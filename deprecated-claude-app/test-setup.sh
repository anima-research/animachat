#!/bin/bash

# Test setup script for context management and prompt caching

echo "=== AnimaChat Context Management Test Setup ==="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if backend is running
echo "Checking if backend is running..."
if curl -s http://localhost:3010/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend is running${NC}"
else
    echo -e "${YELLOW}⚠️  Backend is not running${NC}"
    echo "Starting backend..."
    cd backend
    npm run dev &
    BACKEND_PID=$!
    echo "Backend started with PID: $BACKEND_PID"
    sleep 5
    cd ..
fi

# Check if frontend is running
echo "Checking if frontend is running..."
if curl -s http://localhost:5173 > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Frontend is running${NC}"
else
    echo -e "${YELLOW}⚠️  Frontend is not running${NC}"
    echo "Starting frontend..."
    cd frontend
    npm run dev &
    FRONTEND_PID=$!
    echo "Frontend started with PID: $FRONTEND_PID"
    sleep 5
    cd ..
fi

echo ""
echo "=== Manual Testing Instructions ==="
echo ""
echo "1. Open browser to http://localhost:5173"
echo "2. Login or create an account"
echo "3. Create a new conversation"
echo "4. Click the settings icon (gear) for the conversation"
echo "5. Set Context Management to 'Rolling Window' with:"
echo "   - Max Tokens: 2000"
echo "   - Grace Tokens: 500"
echo "6. Save settings"
echo "7. Start chatting - send at least 20-30 messages"
echo ""
echo "=== What to Look For ==="
echo ""
echo "In the backend logs (terminal running 'npm run dev'), watch for:"
echo ""
echo -e "${GREEN}[ContextManager]${NC} entries showing strategy being used"
echo -e "${GREEN}[RollingContextStrategy]${NC} entries showing token counts and truncation"
echo -e "${GREEN}[EnhancedInference]${NC} entries showing cache control being added"
echo -e "${GREEN}[OpenRouter]${NC} entries showing cache metrics (if using OpenRouter models)"
echo ""
echo "Expected behavior:"
echo "- After ~2500 tokens, older messages should be dropped"
echo "- Cache control should be added to the last cacheable message"
echo "- OpenRouter should report cache hits after the first request"
echo ""
echo "=== Automated Test ==="
echo ""
echo "To run the automated test (after logging in):"
echo "1. Get your auth token from browser DevTools:"
echo "   - Open DevTools (F12)"
echo "   - Go to Application/Storage > Local Storage"
echo "   - Copy the 'token' value"
echo ""
echo "2. Run the test:"
echo "   AUTH_TOKEN=your-token-here node backend/test-full-flow.js"
echo ""
echo "=== Cleanup ==="
echo ""
if [ ! -z "$BACKEND_PID" ]; then
    echo "To stop backend: kill $BACKEND_PID"
fi
if [ ! -z "$FRONTEND_PID" ]; then
    echo "To stop frontend: kill $FRONTEND_PID"
fi
echo ""
echo "Press Ctrl+C to stop watching logs..."

# Tail backend logs if available
if [ -f backend/backend.log ]; then
    tail -f backend/backend.log | grep -E "\[ContextManager\]|\[RollingContextStrategy\]|\[EnhancedInference\]|\[OpenRouter\]"
fi
