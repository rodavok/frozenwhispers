---
name: new-post
description: Turn raw material — notes, a brain dump, a chat log, a README, or another project's codebase — into a finished Jekyll post in _posts/ for the Frozen Whispers site, formatted to this site's conventions and ready to preview and deploy. Use when the user wants to write, draft, or publish an article/post/blog entry here.
---

# Draft a Frozen Whispers post

Turn whatever the user hands you into a publishable post at `_posts/YYYY-MM-DD-slug.markdown`.

## 1. Get the source material

The argument to the skill is the source. It may be:

- **Inline text** — notes, bullets, a brain dump. Use it directly.
- **A file path** — read it.
- **A directory / project path** — this is the common case ("write up what I learned building X"). Read the README, skim the commit history (`git log --oneline -40`), and read the handful of files that carry the actual ideas. Look for what was *non-obvious*: the wrong turn, the constraint that forced a redesign, the thing that turned out simpler than expected. That is the article. A feature list is not an article.
- **Nothing** — ask what the post is about and what material exists, then stop. Don't invent a topic.

Never fabricate technical details, benchmark numbers, or war stories that aren't in the source. If the material is too thin for a real post, say so and ask for more rather than padding.

## 2. Decide the frame

Before writing, settle two things and state them in one line each:

- **The claim** — the one thing a reader should walk away believing.
- **The reader** — someone who has hit this problem but not solved it.

Cut anything that serves neither.

## 3. Write it

Create `_posts/YYYY-MM-DD-slug.markdown` where the date is today (get it from the environment context or `date +%F`) and the slug is short, lowercase, hyphenated.

```markdown
---
layout: post
title:  "Sentence-case title, specific not clever"
date:   YYYY-MM-DD HH:MM:SS -0500
categories: one-or-two lowercase-tags
---

First paragraph.

Rest of the post.
```

Site conventions that matter:

- **The first paragraph is the excerpt.** `_layouts/home.html` renders it on the home page stripped of HTML and truncated to 30 words. Make it a self-contained hook that states the problem or the punchline — not "In this post I will…". No links, images, or code in it.
- **Title is rendered by the layout** (`_layouts/post.html`). Do not repeat it as an `#` heading in the body. Start body sections at `##`.
- **Timezone is `-0500`** to match the existing post. A future timestamp will not publish until then.
- **Code** uses standard fenced blocks with a language tag. Styled dark via `assets/css/style.css` (`pre`, `code`). Keep snippets short and real — copied from the actual project, trimmed of noise. Avoid the `{% highlight %}` Liquid tag; fences are cleaner.
- **Images** go in `assets/images/` (create the dir if needed) and are referenced as `![alt]({{ '/assets/images/foo.png' | relative_url }})`. `.post-content img` is already styled responsive.
- **Tables** are styled and fine to use for comparisons.
- Curly quotes and em dashes render fine; no escaping needed.

Voice: first person, direct, concrete. Short paragraphs — the site's line-height is generous and long blocks read heavy. Lead with the finding, then the evidence. No "In today's fast-paced world", no summary section restating what was just said, no exhortations to the reader. Aim for 600–1200 words unless the material clearly warrants more.

## 4. Preview and hand off

After writing, report the file path and the title, and offer to preview:

```bash
bundle exec jekyll serve
```

Then the publish step, which the user runs when happy with the draft:

```bash
bundle exec jekyll build --destination docs
git add -A && git commit -m "Add post: <title>" && git push
```

Prefer that plain build over `./deploy.sh` unless the user also wants the Reading page re-synced — `deploy.sh` runs `sync_bookmarks.py` first under `set -e`, so a locked Firefox database aborts the whole deploy.

Do not commit or push unless the user asks.
