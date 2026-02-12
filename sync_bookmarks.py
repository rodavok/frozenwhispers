#!/usr/bin/env python3
"""
Sync Firefox bookmarks from the Reading folder to Jekyll _data/bookmarks.yml
Only includes bookmarks from the last 3 months.
"""

import sqlite3
import shutil
import tempfile
import os
import yaml
from datetime import datetime, timedelta
from pathlib import Path

# Firefox profile path
FIREFOX_PROFILE = os.path.expanduser("~/.mozilla/firefox/pqrrv4ss.default-release")
PLACES_DB = os.path.join(FIREFOX_PROFILE, "places.sqlite")

# Reading folder ID in Firefox bookmarks
READING_FOLDER_ID = 693

# Output path
SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR / "_data"
OUTPUT_FILE = DATA_DIR / "bookmarks.yml"

# How far back to include (in days)
DAYS_BACK = 90


def get_descendant_folder_ids(cursor, parent_id):
    """Recursively get all folder IDs under a parent folder."""
    folder_ids = [parent_id]
    cursor.execute(
        "SELECT id FROM moz_bookmarks WHERE parent = ? AND type = 2",
        (parent_id,)
    )
    for (child_id,) in cursor.fetchall():
        folder_ids.extend(get_descendant_folder_ids(cursor, child_id))
    return folder_ids


def get_folder_name(cursor, folder_id):
    """Get the name of a folder by ID."""
    cursor.execute("SELECT title FROM moz_bookmarks WHERE id = ?", (folder_id,))
    result = cursor.fetchone()
    return result[0] if result else None


def sync_bookmarks():
    """Extract bookmarks from Firefox and write to YAML."""
    # Copy database to avoid locking issues with running Firefox
    with tempfile.NamedTemporaryFile(delete=False, suffix=".sqlite") as tmp:
        shutil.copy(PLACES_DB, tmp.name)
        tmp_path = tmp.name

    try:
        conn = sqlite3.connect(tmp_path)
        cursor = conn.cursor()

        # Get all folder IDs under Reading
        folder_ids = get_descendant_folder_ids(cursor, READING_FOLDER_ID)

        # Calculate cutoff date (Firefox stores timestamps in microseconds)
        cutoff = datetime.now() - timedelta(days=DAYS_BACK)
        cutoff_timestamp = int(cutoff.timestamp() * 1_000_000)

        # Get bookmarks from these folders
        # type=1 means bookmark (not folder or separator)
        placeholders = ",".join("?" * len(folder_ids))
        query = f"""
            SELECT
                b.title,
                p.url,
                b.dateAdded,
                b.parent
            FROM moz_bookmarks b
            JOIN moz_places p ON b.fk = p.id
            WHERE b.parent IN ({placeholders})
              AND b.type = 1
              AND b.dateAdded >= ?
            ORDER BY b.dateAdded DESC
        """
        cursor.execute(query, folder_ids + [cutoff_timestamp])

        bookmarks = []
        for title, url, date_added, parent_id in cursor.fetchall():
            # Convert Firefox timestamp (microseconds) to datetime
            date = datetime.fromtimestamp(date_added / 1_000_000)
            category = get_folder_name(cursor, parent_id) or "Uncategorized"

            bookmarks.append({
                "title": title or url,
                "url": url,
                "date": date.strftime("%Y-%m-%d"),
                "category": category
            })

        conn.close()
    finally:
        os.unlink(tmp_path)

    # Ensure _data directory exists
    DATA_DIR.mkdir(exist_ok=True)

    # Write YAML
    with open(OUTPUT_FILE, "w") as f:
        yaml.dump(bookmarks, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

    print(f"Synced {len(bookmarks)} bookmarks to {OUTPUT_FILE}")
    return bookmarks


if __name__ == "__main__":
    sync_bookmarks()
