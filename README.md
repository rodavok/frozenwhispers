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

This builds to `_site/` for previewing only. GitHub builds and publishes its
own copy when you push — see [Deployment](#deployment).

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
| Add one thing, from any browser | **+ Add entry** on the Media page (or go to `/media/add/`) |
| Add one thing, from the terminal | `python3 add_media.py "Blue Prince"` |
| Add one thing, skip the search guessing | `python3 add_media.py "Dune" --type book` |
| Add several | `python3 add_media.py "Dune" "Neuromancer" --type book` |
| Backfill a whole backlog, unattended | `python3 add_media.py --from-file backlog.txt --first` |
| Fix a comment I wrote badly | `python3 add_media.py --edit habsburgs` |
| Change a rating, date, or title | Edit `_data/media.yml` directly |
| Publish my comments to the site | Set `media_show_comments: true` in `_config.yml` |
| See it before it goes live | `bundle exec jekyll serve` → http://localhost:4000/media/ |
| Actually put it online | Commit and push (entries added on the site are already pushed) |

**Set `$EDITOR` once** and comment-writing stops being painful:

```bash
echo 'export EDITOR=nano' >> ~/.bashrc    # or vim, micro, "code --wait"
```

## Adding entries from the site

Go to https://frozenwhispers.duckdns.org/media/add/, pick a type, and search.
Results come with covers. Pick one, fill in your dates, rating, and comment,
and hit **Save to log**.

Save commits the entry to `_data/media.yml` and the cover to `assets/covers/`
in one commit, straight to `main` through the GitHub API. That push rebuilds
the site, which is live a minute or two later. Nothing needs to happen on
your computer; just `git pull` before you next edit locally.

**One-time setup, per browser.** The page needs a GitHub token to commit:

1. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new).
2. Repository access: **Only select repositories** → `frozenwhispers`.
3. Permissions: **Contents** → **Read and write**. Nothing else.
4. Paste it into the page.

The token stays in that browser's `localStorage` and is sent only to
`api.github.com`. Once it's saved, an **+ Add entry** link appears on the
Media page in that browser. Visitors never see the link, and without a token
the add page can't save anything. When the token expires, the page says so
and asks for a new one. **Forget token** on the page removes it.

Lookups match the command-line tool's sources, except games: Steam's search
API refuses requests from web pages, so games are found through Wikidata.
Wikidata stores each game's Steam app ID, so you still get Steam's portrait
cover art and a store link, and games not on Steam fall back to the box art
from Wikipedia. If a cover is wrong or missing, **Change cover** takes an
image URL or an uploaded file.

The page finds the same duplicates `add_media.py` does, and marks search
results that are already in the log.

Code: `media-add.md`, `_includes/media-add.html`, `assets/js/media-add.js`,
with styles under `/* Media: add entry page */` in `assets/css/style.css`.

## Adding entries from the command line

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
`backlog.txt` and rerun the same file. Duplicates are caught by source URL as
well as by title, so the same work still counts as a duplicate when a search
returns it under a different name (`Habsburgs` vs `Habsburgs: To Rule the
World`). A genuinely different work with a similar title is still added.

Anything with no match is skipped and listed at the end to rerun with an
explicit `--type`.

Each entry saves as it completes, so an interrupted batch keeps whatever it got
through.

## Editing entries

The site can add entries but not edit them. Edit locally, then commit and push.

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

## Comments are hidden on the site, not private

`media_show_comments` in `_config.yml` is `false`. Comment text is then **never
written into the built HTML** — not merely hidden with CSS — so site visitors
cannot read it, not even from the page source.

They can still read it on GitHub. The repo is public, and `_data/media.yml`
is in it. Don't write anything in a comment you wouldn't want found.

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
| `game`  | Steam store                                    | Prefers the portrait capsule over the wide banner. The site uses Wikidata instead, then Steam art by app ID |
| `music` | iTunes Search                                  | |

## Page layout and styling

| Piece | File |
|---|---|
| The page itself | `media.md` |
| Table markup, filtering, sorting, expand/collapse | `_includes/media-table.html` |
| Add entry page | `media-add.md`, `_includes/media-add.html`, `assets/js/media-add.js` |
| Styles | `assets/css/style.css`, under `/* Media page */` and `/* Media: add entry page */` |
| Data | `_data/media.yml` |
| Cover images | `assets/covers/` |

The table drops columns as the screen narrows, so it always fits without
pushing the page sideways:

| Width | Columns shown |
|---|---|
| Over 768px | All eight |
| 768px and under | Cover, Title, Type, Finished, Rating (Creator, Year, Started hidden) |
| 480px and under | Same, with tighter padding and a smaller cover |

Below about 350px — where exactly depends on your longest title — the table
scrolls horizontally **inside its own box** rather than breaking the page
layout.

If you add a column, keep it inside `.media-table-wrap` and give it a real
class name. The responsive rules match on classes like `.col-started`; an
earlier version used `:first-of-type`, which matches on element type rather
than class, silently matched nothing, and let the table overflow the page on
phones.

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

Entries are sorted newest-activity-first on save, by both the script and the
site. The site inserts each new entry without reformatting the rest of the
file, so your hand edits stay as you wrote them.

---

# Reading page

The Reading page displays bookmarks from your Firefox "Reading" folder (last 3 months).

To sync bookmarks from Firefox:

```bash
python3 sync_bookmarks.py
```

This reads from Firefox's bookmarks database and generates `_data/bookmarks.yml`.
`deploy.sh` runs it for you. Commit the file and push to update the Reading
page, because GitHub builds the site from what is committed and has no access
to your Firefox.

**Note:** Close Firefox first, or the script will use a snapshot copy to avoid database locking issues.

### Configuration

Edit `sync_bookmarks.py` to change:
- `READING_FOLDER_ID` - Firefox folder ID to sync from (default: 693 for "Reading")
- `DAYS_BACK` - How far back to include bookmarks (default: 90 days)

---

# Deployment

The site is hosted on GitHub Pages and built by GitHub Actions
(`.github/workflows/pages.yml`). Every push to `main` builds it with Jekyll
and publishes the result, including the commits the add page makes. Nothing
built is committed, so there is no `docs/` folder any more.

```bash
bundle exec jekyll serve                  # optional: preview at http://localhost:4000
./deploy.sh                               # refreshes _data/bookmarks.yml from Firefox
git add -A && git commit -m "Update site" && git push
```

Live a minute or two later at https://frozenwhispers.duckdns.org. Each build
shows under the repo's **Actions** tab; a failed build leaves the previous
version of the site up.

**First-time setup:** In GitHub repo settings → Pages, set **Source** to
**GitHub Actions**. Do this before the first push that removes `docs/`.
Switching first is safe, because the current site stays up until the first
build replaces it. Pushing first leaves Pages serving a `docs/` folder that
no longer exists.
