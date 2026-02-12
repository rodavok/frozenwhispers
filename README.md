# Frozen Whispers

A Jekyll blog with articles, dashboards, and data visualizations.

## Setup

```bash
bundle install
```

## Development

```bash
bundle exec jekyll serve
```

Site will be available at http://localhost:4000

## Updating the Reading Page

The Reading page displays bookmarks from your Firefox "Reading" folder (last 3 months).

To sync bookmarks from Firefox:

```bash
python3 sync_bookmarks.py
```

This reads from Firefox's bookmarks database and generates `_data/bookmarks.yml`.

**Note:** Close Firefox first, or the script will use a snapshot copy to avoid database locking issues.

### Configuration

Edit `sync_bookmarks.py` to change:
- `READING_FOLDER_ID` - Firefox folder ID to sync from (default: 693 for "Reading")
- `DAYS_BACK` - How far back to include bookmarks (default: 90 days)

## Deployment

The site is hosted on GitHub Pages from the `docs/` folder on `main`.

To deploy:

```bash
./deploy.sh
git add -A && git commit -m "Update site" && git push
```

**First-time setup:** In GitHub repo settings, set Pages source to `main` branch, `/docs` folder.
