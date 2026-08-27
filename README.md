# Frozen Whispers

A Jekyll blog with articles, dashboards, and data visualizations.

Live at **https://frozenwhispers.duckdns.org** (custom domain set by `CNAME`).

## Setup

```bash
bundle install
```

## Development

```bash
bundle exec jekyll serve
```

Site will be available at http://localhost:4000

Note this builds to `_site/`, which is **not** what gets published — see
[Deployment](#deployment).

---

# Media log

The Media page (`/media/`) is a record of books, films, TV, games, and albums:
what it was, who made it, when you started and finished it, your rating, and
your private notes.

Data lives in `_data/media.yml`, cover art in `assets/covers/`, and both are
committed to the repo. The page itself is `media.md` plus
`_includes/media-table.html`.

## Common tasks

| I want to… | Command |
|---|---|
| Add one thing | `python3 add_media.py "Blue Prince"` |
| Add one thing, skip the search guessing | `python3 add_media.py "Dune" --type book` |
| Add several | `python3 add_media.py "Dune" "Neuromancer" --type book` |
| Backfill a whole backlog, unattended | `python3 add_media.py --from-file backlog.txt --first` |
| Fix a comment I wrote badly | `python3 add_media.py --edit habsburgs` |
| Change a rating, date, or title | Edit `_data/media.yml` directly |
| Publish my comments to the site | Set `media_show_comments: true` in `_config.yml` |
| See it before it goes live | `bundle exec jekyll serve` → http://localhost:4000/media/ |
| Actually put it online | `./deploy.sh` then commit and push |

**Set `$EDITOR` once** and comment-writing stops being painful:

```bash
echo 'export EDITOR=nano' >> ~/.bashrc    # or vim, micro, "code --wait"
```

## Adding entries

```bash
python3 add_media.py "Blue Prince"
python3 add_media.py "Dune" --type book     # search only Open Library
```

The script searches for the title, lists the matches, and asks you to pick one.
It then prompts for your own dates, rating (0–5), and comment, and appends the
entry to `_data/media.yml`. Cover art is downloaded into `assets/covers/`, so the
page never depends on a live third-party URL that might rot.

Dates accept `YYYY-MM-DD`, `YYYY-MM`, `YYYY`, or `today`. Leave any prompt blank
to skip it — blank fields render as `—` on the page.

`--type` is worth passing when you know it: a type-restricted search is much
more accurate than searching all five sources at once.

If nothing matches, pick `0` at the prompt and enter everything by hand.

## Adding several at once

Pass more than one title, or read them from a file:

```bash
python3 add_media.py "Dune" "Neuromancer" "Blindsight" --type book
python3 add_media.py --from-file backlog.txt
```

A batch file is one title per line. `Title | type` pins the type, and blank
lines and `#` comments are ignored:

```
# games
Blue Prince | game
Disco Elysium | game

Severance | tv
Neuromancer | book
```

Two flags help when backfilling a long list:

| Flag | Effect |
|---|---|
| `--quick` | Skip the date/rating/comment prompts, leaving them blank to fill in later |
| `--first` | Take the top search result without asking (implies `--quick`) — fully unattended |

So `--from-file backlog.txt --first` chews through a whole backlog with no input
from you, then you fill in your dates and ratings by editing the YAML in bulk —
usually faster than answering four prompts per title.

Things already in the log are skipped, so you can keep appending lines to
`backlog.txt` and rerun the same file. Anything with no match is skipped and
listed at the end to rerun with an explicit `--type`.

Each entry saves as it completes, so an interrupted batch keeps whatever it got
through.

## Editing entries

There is no editing on the live site — it is static HTML generated from the YAML.
Everything is edited locally and redeployed.

**To rewrite a comment**, which is the one field that is unpleasant to type at a
prompt:

```bash
python3 add_media.py --edit habsburgs      # by id, or any unique bit of the title
```

That opens the existing comment preloaded in `$EDITOR` so you revise rather than
retype. Lines starting with `#` are stripped; save it empty to clear the comment.
Requires `$EDITOR` to be set.

**For every other field** — rating, dates, title, creator, cover — edit
`_data/media.yml` directly. It is plain YAML and nothing regenerates it behind
your back.

## Comments are private by default

`media_show_comments` in `_config.yml` is `false`. Comment text is then **never
written into the built HTML** — not merely hidden with CSS — so your notes stay
in `_data/media.yml` as a private record that site visitors cannot read, not
even from the page source.

Set it to `true` to publish them. Rows with a comment then get a `▸` marker and
expand to show the note when clicked.

Everything else in the log — titles, ratings, dates — is always public.

## Sources

All lookups are free and need no API key:

| Type    | Source                                         | Notes |
|---------|------------------------------------------------|-------|
| `book`  | Open Library                                   | |
| `film`  | Wikidata (director, year) + Wikipedia (poster) | iTunes no longer indexes films |
| `tv`    | TVMaze                                         | Second call fetches the real `Creator`, not the network |
| `game`  | Steam store                                    | Prefers the portrait capsule over the wide banner |
| `music` | iTunes Search                                  | |

## The data file

```yaml
- id: blue-prince            # slug, also the cover filename
  title: Blue Prince
  type: game                 # book | film | tv | game | music
  creator: Dogubomb          # author / director / developer / artist
  year: 2025
  started: '2025-03-01'
  finished: '2025-03-20'     # null if still going
  rating: 5                  # 0-5, null if unrated
  comment: Best puzzle box in years.    # private unless media_show_comments
  cover: /assets/covers/blue-prince.jpg
  url: https://store.steampowered.com/app/1569580
  added: '2026-08-26'
```

Entries are sorted newest-activity-first on save. `_data/media.yml` and
`assets/covers/` are committed to the repo, unlike `_data/bookmarks.yml`, which
is regenerated from Firefox on every deploy.

---

# Reading page

The Reading page displays bookmarks from your Firefox "Reading" folder (last 3 months).

To sync bookmarks from Firefox:

```bash
python3 sync_bookmarks.py
```

This reads from Firefox's bookmarks database and generates `_data/bookmarks.yml`.
`deploy.sh` runs it automatically, so your Reading page refreshes on every deploy.

**Note:** Close Firefox first, or the script will use a snapshot copy to avoid database locking issues.

### Configuration

Edit `sync_bookmarks.py` to change:
- `READING_FOLDER_ID` - Firefox folder ID to sync from (default: 693 for "Reading")
- `DAYS_BACK` - How far back to include bookmarks (default: 90 days)

---

# Deployment

The site is hosted on GitHub Pages from the **`docs/` folder** on `main`, and
`docs/` is committed. `bundle exec jekyll serve` builds to `_site/`, which is
gitignored and never published — so changes are not live until you run
`deploy.sh`, which rebuilds into `docs/`.

Preview first, then deploy:

```bash
bundle exec jekyll serve                  # check http://localhost:4000/media/
./deploy.sh                               # syncs bookmarks, rebuilds into docs/
git add -A && git commit -m "Update site" && git push
```

Live a minute or so later at https://frozenwhispers.duckdns.org

**First-time setup:** In GitHub repo settings, set Pages source to `main` branch, `/docs` folder.
