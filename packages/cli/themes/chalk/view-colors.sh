#!/bin/bash

# Install ansi-to-html if not installed
npm install -g ansi-to-html 2>/dev/null

# Run the demo and convert to HTML
echo "Generating HTML preview..."
node demo-colors-working.cjs | ansi-to-html > colors-preview.html

echo "✓ Created colors-preview.html"
echo "Open this file in your browser to see the colors!"
echo "Path: $(pwd)/colors-preview.html"