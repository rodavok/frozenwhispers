#!/bin/bash
set -e

echo "Syncing bookmarks from Firefox..."
python3 sync_bookmarks.py

echo "Building site to docs/..."
bundle exec jekyll build --destination docs

echo "Done! Now commit and push to main."
