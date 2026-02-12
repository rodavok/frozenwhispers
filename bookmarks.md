---
layout: page
title: Reading
permalink: /reading/
---

{% assign sorted_bookmarks = site.data.bookmarks | sort: "date" | reverse %}

{% for bookmark in sorted_bookmarks %}
- [{{ bookmark.title }}]({{ bookmark.url }}) <span class="bookmark-meta">{{ bookmark.date }} &middot; {{ bookmark.category }}</span>
{% endfor %}
