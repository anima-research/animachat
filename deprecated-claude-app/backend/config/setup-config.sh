#!/bin/bash

# Script to help set up config.json with real API keys
# Run this script and it will prompt for API keys and update config.json

CONFIG_FILE="config.json"

echo "Setting up API keys in config.json"
echo "=================================="
echo ""

# Anthropic API Key
echo -n "Enter your Anthropic API key (sk-ant-...): "
read -s ANTHROPIC_KEY
echo ""

# OpenRouter API Key
echo -n "Enter your OpenRouter API key (sk-or-...): "
read -s OPENROUTER_KEY
echo ""

# AWS Credentials
echo -n "Enter your AWS Access Key ID: "
read AWS_ACCESS_KEY
echo -n "Enter your AWS Secret Access Key: "
read -s AWS_SECRET_KEY
echo ""

# Update config.json with the real keys
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s/sk-ant-api03-YOUR-KEY-HERE/$ANTHROPIC_KEY/g" "$CONFIG_FILE"
    sed -i '' "s/sk-or-v1-YOUR-KEY-HERE/$OPENROUTER_KEY/g" "$CONFIG_FILE"
    sed -i '' "s/AKIAIOSFODNN7EXAMPLE/$AWS_ACCESS_KEY/g" "$CONFIG_FILE"
    sed -i '' "s|wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY|$AWS_SECRET_KEY|g" "$CONFIG_FILE"
else
    # Linux
    sed -i "s/sk-ant-api03-YOUR-KEY-HERE/$ANTHROPIC_KEY/g" "$CONFIG_FILE"
    sed -i "s/sk-or-v1-YOUR-KEY-HERE/$OPENROUTER_KEY/g" "$CONFIG_FILE"
    sed -i "s/AKIAIOSFODNN7EXAMPLE/$AWS_ACCESS_KEY/g" "$CONFIG_FILE"
    sed -i "s|wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY|$AWS_SECRET_KEY|g" "$CONFIG_FILE"
fi

echo ""
echo "✅ Config file updated with API keys!"
echo ""
echo "Pricing Summary:"
echo "==============="
echo ""
echo "Haiku models: FREE for all users (100% subsidized)"
echo "Sonnet models: ~83% subsidized ($0.50/$2.50 vs $3/$15)"
echo "Opus models: 80% subsidized ($3/$15 vs $15/$75)"
echo "GPT-3.5: FREE for all users"
echo "GPT-4: 80% subsidized ($2/$6 vs $10/$30)"
echo "Llama models: FREE for all users"
echo ""
echo "Note: This configuration gives users heavily subsidized access to AI models."
echo "Company absorbs most of the API costs to make AI accessible to everyone."
