#!/bin/bash

# Exit on error
set -e

# Default URL if none provided
URL=${1:-"https://react.dev"}

echo "Starting request to analyze $URL..."

# Make one request and measure time
time curl -X POST \
     -H "Content-Type: application/json" \
     -d '{"url": "'"$URL"'"}' \
     http://localhost:3000/api/shrinkwrap | jq '.'
