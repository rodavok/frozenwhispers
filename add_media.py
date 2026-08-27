#!/usr/bin/env python3
"""
Add an entry to the media log in _data/media.yml.

Looks the title up against a source appropriate to its type, shows the
matches, and asks for your own dates, rating, and comments. Cover art is
downloaded into assets/covers/ so the page never depends on a live URL.

All sources are free and need no API key:

    book   Open Library
    film   Wikidata (metadata) + Wikipedia (poster)
    tv     TVMaze
    game   Steam store
    music  iTunes Search

Usage:
    ./add_media.py "Blue Prince"
    ./add_media.py "Dune" --type book
    ./add_media.py "Dune" "Neuromancer" "Blindsight" --type book

    # Backfill a backlog: one title per line, "Title | type" to pin the type.
    ./add_media.py --from-file backlog.txt --first

Entries are saved as each one completes, so an interrupted batch keeps
whatever it managed.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import unicodedata
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

import yaml

SCRIPT_DIR = Path(__file__).parent
DATA_FILE = SCRIPT_DIR / "_data" / "media.yml"
COVER_DIR = SCRIPT_DIR / "assets" / "covers"

TYPES = ["book", "film", "tv", "game", "music"]

USER_AGENT = "frozenwhispers-media-log/1.0 (https://rodavok.github.io)"


# --------------------------------------------------------------------------
# HTTP helpers
# --------------------------------------------------------------------------

def get_json(url, params=None):
    """GET a URL and parse the response as JSON. Returns None on failure."""
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.load(resp)
    except Exception as e:
        print(f"  ! request failed ({url.split('?')[0]}): {e}", file=sys.stderr)
        return None


def slugify(text):
    """Reduce a title to a filesystem- and URL-safe slug."""
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"[^\w\s-]", "", text).strip().lower()
    return re.sub(r"[\s_-]+", "-", text) or "untitled"


def year_from(value):
    """Pull a 4-digit year out of whatever date-ish string a source returned."""
    if not value:
        return None
    match = re.search(r"(\d{4})", str(value))
    return int(match.group(1)) if match else None


def download_cover(url, slug):
    """Save a cover image locally. Returns the site-relative path, or None."""
    if not url:
        return None
    COVER_DIR.mkdir(parents=True, exist_ok=True)

    ext = Path(urllib.parse.urlparse(url).path).suffix.lower()
    if ext not in (".jpg", ".jpeg", ".png", ".gif", ".webp"):
        ext = ".jpg"
    dest = COVER_DIR / f"{slug}{ext}"

    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            dest.write_bytes(resp.read())
    except Exception as e:
        print(f"  ! could not download cover: {e}", file=sys.stderr)
        return None

    print(f"  cover saved to {dest.relative_to(SCRIPT_DIR)}")
    return f"/assets/covers/{dest.name}"


# --------------------------------------------------------------------------
# Per-type lookups. Each returns a list of candidate dicts with the keys
# title, creator, year, cover_url, source_url, detail.
# --------------------------------------------------------------------------

def search_book(term):
    data = get_json("https://openlibrary.org/search.json", {
        "q": term,
        "limit": 8,
        "fields": "title,author_name,first_publish_year,cover_i,key",
    })
    results = []
    for doc in (data or {}).get("docs", []):
        cover_id = doc.get("cover_i")
        results.append({
            "title": doc.get("title"),
            "creator": ", ".join(doc.get("author_name", [])[:2]) or None,
            "year": doc.get("first_publish_year"),
            "cover_url": f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg" if cover_id else None,
            "source_url": f"https://openlibrary.org{doc['key']}" if doc.get("key") else None,
            "detail": "book",
        })
    return results


def search_film(term):
    """Wikidata for the metadata, Wikipedia's infobox image for the poster."""
    search = get_json("https://www.wikidata.org/w/api.php", {
        "action": "wbsearchentities", "search": term,
        "language": "en", "format": "json", "limit": 8,
    })
    candidates = [
        hit for hit in (search or {}).get("search", [])
        if "film" in (hit.get("description") or "").lower()
    ][:5]
    if not candidates:
        candidates = (search or {}).get("search", [])[:5]

    results = []
    for hit in candidates:
        results.append({
            "title": hit.get("label"),
            "creator": None,          # filled in on selection - one API call each
            "year": None,
            "cover_url": None,
            "source_url": f"https://www.wikidata.org/wiki/{hit['id']}",
            "detail": hit.get("description") or "film",
            "_qid": hit["id"],
        })
    return results


def enrich_film(item):
    """Second pass for the film the user actually picked."""
    qid = item.get("_qid")
    if not qid:
        return item

    data = get_json("https://www.wikidata.org/w/api.php", {
        "action": "wbgetentities", "ids": qid,
        "props": "claims|sitelinks", "format": "json",
    })
    entity = (data or {}).get("entities", {}).get(qid, {})
    claims = entity.get("claims", {})

    def claim_ids(prop):
        out = []
        for statement in claims.get(prop, []):
            value = statement["mainsnak"].get("datavalue", {}).get("value", {})
            if isinstance(value, dict) and value.get("id"):
                out.append(value["id"])
        return out

    # Director (P57), falling back to creator (P170).
    director_ids = claim_ids("P57") or claim_ids("P170")
    if director_ids:
        labels = get_json("https://www.wikidata.org/w/api.php", {
            "action": "wbgetentities", "ids": "|".join(director_ids[:2]),
            "props": "labels", "languages": "en", "format": "json",
        })
        names = [
            ent.get("labels", {}).get("en", {}).get("value")
            for ent in (labels or {}).get("entities", {}).values()
        ]
        item["creator"] = ", ".join(n for n in names if n) or None

    # Publication date (P577) - take the earliest.
    years = [
        year_from(s["mainsnak"].get("datavalue", {}).get("value", {}).get("time"))
        for s in claims.get("P577", [])
    ]
    years = [y for y in years if y]
    if years:
        item["year"] = min(years)

    # Poster: the English Wikipedia article's infobox image.
    title = entity.get("sitelinks", {}).get("enwiki", {}).get("title")
    if title:
        item["source_url"] = "https://en.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))
        item["cover_url"] = wikipedia_page_image(title)
    return item


def wikipedia_page_image(page_title):
    """Resolve the file named by an article's page_image into an image URL."""
    props = get_json("https://en.wikipedia.org/w/api.php", {
        "action": "query", "format": "json", "prop": "pageprops",
        "redirects": "1", "titles": page_title,
    })
    pages = (props or {}).get("query", {}).get("pages", {})
    filename = None
    for page in pages.values():
        filename = (page.get("pageprops") or {}).get("page_image")
    if not filename:
        return None

    info = get_json("https://en.wikipedia.org/w/api.php", {
        "action": "query", "format": "json", "prop": "imageinfo",
        "iiprop": "url", "iiurlwidth": "400", "titles": f"File:{filename}",
    })
    for page in (info or {}).get("query", {}).get("pages", {}).values():
        for image in page.get("imageinfo", []):
            url = image.get("thumburl") or image.get("url")
            if url:
                return url.split("?")[0]
    return None


def search_tv(term):
    data = get_json("https://api.tvmaze.com/search/shows", {"q": term})
    results = []
    for hit in (data or [])[:8]:
        show = hit.get("show", {})
        channel = show.get("network") or show.get("webChannel") or {}
        image = show.get("image") or {}
        results.append({
            "title": show.get("name"),
            # Placeholder until the crew lookup runs; the network is a
            # distributor, not a creator, so it is only the fallback.
            "creator": channel.get("name"),
            "year": year_from(show.get("premiered")),
            # "medium" is the poster-sized crop; "original" can be 3000px tall.
            "cover_url": image.get("medium") or image.get("original"),
            "source_url": show.get("url"),
            "detail": ", ".join(show.get("genres", [])) or "tv",
            "_showid": show.get("id"),
        })
    return results


def enrich_tv(item):
    """Second pass: swap the network for the show's actual Creator credit."""
    show_id = item.get("_showid")
    if not show_id:
        return item

    crew = get_json(f"https://api.tvmaze.com/shows/{show_id}/crew")
    creators = [
        member["person"]["name"]
        for member in (crew or [])
        if member.get("type") == "Creator" and member.get("person", {}).get("name")
    ]
    if creators:
        item["creator"] = ", ".join(creators[:2])
    return item


def search_game(term):
    data = get_json("https://store.steampowered.com/api/storesearch/", {
        "term": term, "cc": "us", "l": "en",
    })
    results = []
    for item in (data or {}).get("items", [])[:8]:
        results.append({
            "title": item.get("name"),
            "creator": None,          # filled in on selection
            "year": None,
            "cover_url": None,
            "source_url": f"https://store.steampowered.com/app/{item['id']}",
            "detail": "game",
            "_appid": item["id"],
        })
    return results


def enrich_game(item):
    """Second pass: Steam's appdetails has the developer, date, and capsule art."""
    appid = item.get("_appid")
    if not appid:
        return item

    data = get_json("https://store.steampowered.com/api/appdetails", {"appids": appid})
    entry = (data or {}).get(str(appid), {})
    if not entry.get("success"):
        return item

    details = entry.get("data", {})
    item["creator"] = ", ".join(details.get("developers", [])[:2]) or None
    item["year"] = year_from((details.get("release_date") or {}).get("date"))
    # Prefer the portrait library capsule so game art matches the shape of
    # book/film covers; header_image is a wide banner that crops badly.
    portrait = f"https://cdn.akamai.steamstatic.com/steam/apps/{appid}/library_600x900.jpg"
    item["cover_url"] = portrait if url_exists(portrait) else details.get("header_image")
    return item


def url_exists(url):
    """Cheap existence check - not every Steam app has portrait art."""
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except Exception:
        return False


def search_music(term):
    data = get_json("https://itunes.apple.com/search", {
        "term": term, "media": "music", "entity": "album", "limit": 8,
    })
    results = []
    for album in (data or {}).get("results", []):
        artwork = album.get("artworkUrl100") or ""
        results.append({
            "title": album.get("collectionName"),
            "creator": album.get("artistName"),
            "year": year_from(album.get("releaseDate")),
            # The 100x100 path swaps out for any size Apple hosts.
            "cover_url": artwork.replace("100x100bb", "600x600bb") or None,
            "source_url": album.get("collectionViewUrl"),
            "detail": album.get("primaryGenreName") or "music",
        })
    return results


SEARCHERS = {
    "book": search_book,
    "film": search_film,
    "tv": search_tv,
    "game": search_game,
    "music": search_music,
}

ENRICHERS = {
    "film": enrich_film,
    "game": enrich_game,
    "tv": enrich_tv,
}


# --------------------------------------------------------------------------
# Interactive prompts
# --------------------------------------------------------------------------

def choose_match(term, media_type, auto_first=False):
    """Search one or all types and let the user pick a match."""
    types = [media_type] if media_type else TYPES

    candidates = []
    for t in types:
        if not auto_first:
            print(f"Searching {t}...")
        for result in SEARCHERS[t](term):
            if result.get("title"):
                result["type"] = t
                candidates.append(result)

    if not candidates:
        if auto_first:
            # Nothing to pick from and nobody to ask. With an explicit --type
            # the bare title is still worth recording; without one the caller
            # skips it, since an untyped entry would break the filters.
            return {"type": media_type, "_unmatched": True}
        print("No matches found. Falling back to manual entry.")
        return {"type": media_type or prompt_choice("Type", TYPES)}

    if auto_first:
        chosen = candidates[0]
        enrich = ENRICHERS.get(chosen["type"])
        if enrich:
            chosen = enrich(chosen)
        return chosen

    print()
    for i, c in enumerate(candidates, 1):
        bits = [c["type"]]
        if c.get("creator"):
            bits.append(c["creator"])
        if c.get("year"):
            bits.append(str(c["year"]))
        elif c.get("detail"):
            bits.append(c["detail"])
        print(f"  {i:2}. {c['title']}  ({' · '.join(bits)})")
    print("   0. none of these - enter manually")

    while True:
        raw = input("\nWhich one? ").strip()
        if raw == "0":
            return {"type": media_type or prompt_choice("Type", TYPES)}
        if raw.isdigit() and 1 <= int(raw) <= len(candidates):
            chosen = candidates[int(raw) - 1]
            enrich = ENRICHERS.get(chosen["type"])
            if enrich:
                print("Fetching details...")
                chosen = enrich(chosen)
            return chosen
        print("Enter a number from the list.")


def prompt_choice(label, options):
    joined = "/".join(options)
    while True:
        value = input(f"{label} ({joined}): ").strip().lower()
        if value in options:
            return value
        print(f"Pick one of: {joined}")


def prompt(label, default=None):
    suffix = f" [{default}]" if default not in (None, "") else ""
    value = input(f"{label}{suffix}: ").strip()
    return value or default


def prompt_date(label, default=None):
    """Accept YYYY-MM-DD, YYYY-MM, YYYY, or 'today'. Empty means unknown."""
    while True:
        value = prompt(label, default)
        if not value:
            return None
        if value.lower() == "today":
            return date.today().isoformat()
        if re.fullmatch(r"\d{4}(-\d{2}(-\d{2})?)?", value):
            return value
        print("  Use YYYY-MM-DD, YYYY-MM, YYYY, or 'today'. Leave blank to skip.")


def prompt_rating():
    while True:
        value = input("Rating (0-5, blank to skip): ").strip()
        if not value:
            return None
        try:
            rating = float(value)
        except ValueError:
            print("  Numbers only.")
            continue
        if 0 <= rating <= 5:
            return int(rating) if rating == int(rating) else rating
        print("  Must be between 0 and 5.")


EDITOR_HEADER = """
# Write your comment above. Lines starting with # are ignored.
# Save and close when you are done; leave it empty to skip.
"""


def compose_in_editor(initial=""):
    """Open $EDITOR for a comment. Returns the text, or None if left empty."""
    editor = os.environ.get("VISUAL") or os.environ.get("EDITOR")
    if not editor:
        return None

    with tempfile.NamedTemporaryFile("w+", suffix=".md", delete=False) as tmp:
        tmp.write(initial + "\n" if initial else "\n")
        tmp.write(EDITOR_HEADER)
        path = tmp.name

    try:
        # shell=True so EDITOR can carry arguments, e.g. "code --wait".
        subprocess.run(f'{editor} "{path}"', shell=True, check=True)
        text = Path(path).read_text()
    except subprocess.CalledProcessError as e:
        print(f"  ! editor exited with {e.returncode} - comment not saved", file=sys.stderr)
        return None
    finally:
        os.unlink(path)

    body = "\n".join(
        line for line in text.splitlines() if not line.lstrip().startswith("#")
    )
    return body.strip() or None


def prompt_comment(initial=""):
    """Compose a comment in $EDITOR, falling back to reading stdin lines."""
    editor = os.environ.get("VISUAL") or os.environ.get("EDITOR")
    if editor:
        print(f"Comment: opening {editor.split()[0]} (save and close when done)...")
        return compose_in_editor(initial)

    print("Comment (blank line to finish, or just Enter to skip):")
    print("  tip: set $EDITOR to compose this in a real editor instead.")
    lines = []
    while True:
        line = input("  ")
        if not line:
            break
        lines.append(line)
    return "\n".join(lines) or None


# --------------------------------------------------------------------------
# Storage
# --------------------------------------------------------------------------

def load_entries():
    if not DATA_FILE.exists():
        return []
    with open(DATA_FILE) as f:
        return yaml.safe_load(f) or []


def save_entries(entries):
    DATA_FILE.parent.mkdir(exist_ok=True)
    with open(DATA_FILE, "w") as f:
        yaml.dump(entries, f, default_flow_style=False,
                  allow_unicode=True, sort_keys=False, width=100)


def discard_cover(cover_path):
    """Delete a cover downloaded for an entry we ended up not keeping."""
    if not cover_path:
        return
    path = SCRIPT_DIR / cover_path.lstrip("/")
    try:
        path.unlink()
    except OSError:
        pass


def unique_slug(base, entries):
    """Avoid clobbering an existing entry's cover with the same title."""
    existing = {e.get("id") for e in entries}
    if base not in existing:
        return base
    n = 2
    while f"{base}-{n}" in existing:
        n += 1
    return f"{base}-{n}"


def add_entry(term, media_type, entries, quick=False, auto_first=False):
    """Look one title up, ask what is needed, and return the new entry."""
    match = choose_match(term, media_type, auto_first=auto_first)

    if quick:
        # Backfill mode: take the source's word for everything and leave the
        # personal fields blank to be filled in later.
        title = match.get("title") or term
        resolved_type = match.get("type") or media_type
        if not resolved_type:
            # An untyped entry would break the type filters, and there is
            # nobody to ask in an unattended run.
            print("  ! no match and no --type given - skipping", file=sys.stderr)
            return None
        creator, year = match.get("creator"), match.get("year")
        started = finished = rating = comment = None
    else:
        print()
        title = prompt("Title", match.get("title") or term)
        resolved_type = match.get("type") or prompt_choice("Type", TYPES)
        creator = prompt("Creator (author/director/developer/artist)", match.get("creator"))
        year = prompt("Year created", match.get("year"))
        started = prompt_date("Started")
        finished = prompt_date("Finished")
        rating = prompt_rating()
        comment = prompt_comment()

    slug = unique_slug(slugify(title), entries)

    cover = None
    if match.get("cover_url"):
        cover = download_cover(match["cover_url"], slug)

    return {
        "id": slug,
        "title": title,
        "type": resolved_type,
        "creator": creator or None,
        "year": int(year) if str(year or "").isdigit() else None,
        "started": started,
        "finished": finished,
        "rating": rating,
        "comment": comment,
        "cover": cover,
        "url": match.get("source_url"),
        "added": date.today().isoformat(),
    }


def sort_entries(entries):
    """Newest activity first, on whatever date the entry actually has."""
    entries.sort(
        key=lambda e: (e.get("finished") or e.get("started") or e.get("added") or ""),
        reverse=True,
    )
    return entries


def read_list_file(path):
    """Read a batch file. One title per line; 'Title | type' pins the type.

    Blank lines and lines starting with # are ignored.
    """
    jobs = []
    for raw in Path(path).read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "|" in line:
            title, _, kind = line.rpartition("|")
            kind = kind.strip().lower()
            if kind not in TYPES:
                print(f"  ! unknown type '{kind}' on line: {line}", file=sys.stderr)
                kind = None
            jobs.append((title.strip(), kind))
        else:
            jobs.append((line, None))
    return jobs


def find_entry(entries, needle):
    """Locate an entry by exact id, else by case-insensitive title substring."""
    for entry in entries:
        if entry.get("id") == needle:
            return entry

    matches = [e for e in entries if needle.lower() in e.get("title", "").lower()]
    if len(matches) == 1:
        return matches[0]
    if not matches:
        print(f"No entry matching '{needle}'.", file=sys.stderr)
        return None

    print(f"'{needle}' matches several entries - be more specific:", file=sys.stderr)
    for entry in matches:
        print(f"  {entry['id']}  ({entry['title']})", file=sys.stderr)
    return None


def edit_comment(needle):
    """Reopen an existing entry's comment in $EDITOR."""
    entries = load_entries()
    entry = find_entry(entries, needle)
    if entry is None:
        return 1

    if not (os.environ.get("VISUAL") or os.environ.get("EDITOR")):
        print("Set $EDITOR first, e.g.  export EDITOR=nano", file=sys.stderr)
        return 1

    print(f"Editing comment for \"{entry['title']}\"...")
    updated = compose_in_editor(entry.get("comment") or "")

    if updated == entry.get("comment"):
        print("Unchanged.")
        return 0

    entry["comment"] = updated
    save_entries(entries)
    print("Cleared the comment." if updated is None else "Comment updated.")
    return 0


def main():
    parser = argparse.ArgumentParser(
        description="Add entries to the media log.",
        epilog='examples:\n'
               '  %(prog)s "Blue Prince"\n'
               '  %(prog)s "Dune" "Neuromancer" --type book\n'
               '  %(prog)s --from-file backlog.txt --quick\n',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("titles", nargs="*",
                        help="one or more names of books, films, shows, games, or albums")
    parser.add_argument("--type", choices=TYPES, help="restrict the search to one type")
    parser.add_argument("--from-file", metavar="PATH",
                        help="read titles from a file, one per line ('Title | type' pins the type)")
    parser.add_argument("--quick", action="store_true",
                        help="skip the date/rating/comment prompts and leave them blank")
    parser.add_argument("--first", action="store_true",
                        help="take the top search result without asking (implies --quick)")
    parser.add_argument("--edit", metavar="ID_OR_TITLE",
                        help="reopen an existing entry's comment in $EDITOR")
    args = parser.parse_args()

    if args.edit:
        return edit_comment(args.edit)

    jobs = [(title, args.type) for title in args.titles]
    if args.from_file:
        jobs += [(title, kind or args.type) for title, kind in read_list_file(args.from_file)]

    if not jobs:
        parser.error("give at least one title, or --from-file PATH")

    auto_first = args.first
    quick = args.quick or args.first

    entries = load_entries()
    known = {(e.get("title", "").lower(), e.get("type")) for e in entries}
    added = 0
    skipped = []

    for i, (term, kind) in enumerate(jobs, 1):
        if len(jobs) > 1:
            print(f"\n[{i}/{len(jobs)}] {term}")

        if (term.lower(), kind) in known and kind:
            print("  already logged - skipping")
            continue

        try:
            entry = add_entry(term, kind, entries, quick=quick, auto_first=auto_first)
        except (KeyboardInterrupt, EOFError):
            # Keep whatever the run managed before the interrupt.
            print("\nStopped.")
            break

        if entry is None:
            skipped.append(term)
            continue

        # The search may resolve to a fuller name than the term we looked up
        # ("Disco Elysium" -> "Disco Elysium - The Final Cut"), so re-check
        # for a duplicate now that the real title is known.
        if (entry["title"].lower(), entry["type"]) in known:
            print(f"  already logged as \"{entry['title']}\" - skipping")
            discard_cover(entry.get("cover"))
            continue

        entries.append(entry)
        known.add((entry["title"].lower(), entry["type"]))
        added += 1
        # Save after each entry so a long backfill survives an interruption.
        save_entries(sort_entries(entries))

        if quick:
            bits = [entry["type"]]
            if entry["creator"]:
                bits.append(entry["creator"])
            if entry["year"]:
                bits.append(str(entry["year"]))
            print(f"  added: {entry['title']} ({' · '.join(bits)})")

    if added:
        print(f"\nAdded {added} "
              f"{'entry' if added == 1 else 'entries'} to "
              f"{DATA_FILE.relative_to(SCRIPT_DIR)} ({len(entries)} total).")
    else:
        print("\nNothing added.")

    if skipped:
        print(f"Skipped {len(skipped)} with no match - rerun these with --type:")
        for term in skipped:
            print(f"  {term}")


if __name__ == "__main__":
    try:
        sys.exit(main() or 0)
    except (KeyboardInterrupt, EOFError):
        # Entries already completed were saved as they went.
        print("\nCancelled.")
        sys.exit(1)
