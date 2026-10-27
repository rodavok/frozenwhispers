#!/bin/bash
set -e

# GitHub Actions builds and publishes the site on every push to main
# (.github/workflows/pages.yml). The one thing it can't do is read your
# Firefox bookmarks, so refresh those here and commit them.

echo "Syncing bookmarks from Firefox..."
python3 sync_bookmarks.py

echo "Done! Now commit and push to main; GitHub rebuilds the site."
