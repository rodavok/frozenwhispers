/*
 * Media log: add an entry from the site (/media/add/).
 *
 * Looks a title up against the same free sources add_media.py uses, with one
 * exception: Steam's search API refuses requests from web pages, so games come
 * from Wikidata instead. Wikidata records each game's Steam app ID, so Steam's
 * portrait cover art still works.
 *
 * Save commits the entry and its cover to the repo in a single commit through
 * the GitHub API. That push triggers .github/workflows/pages.yml, which
 * rebuilds the site.
 *
 * Saving needs a fine-grained GitHub token for this repo with Contents: read
 * and write. It lives in this browser's localStorage and nowhere else.
 */
(function () {
  'use strict';

  var root = document.getElementById('media-add');
  if (!root) return;

  if (!window.jsyaml) {
    var failed = document.createElement('p');
    failed.className = 'media-add-error';
    failed.textContent = 'Could not load the YAML library this page needs. Reload to try again.';
    root.appendChild(failed);
    return;
  }

  var REPO = root.dataset.repo;
  var BRANCH = root.dataset.branch || 'main';
  var DATA_PATH = '_data/media.yml';
  var COVER_DIR = 'assets/covers';
  var TOKEN_KEY = 'fw-media-token';
  var TYPE_KEY = 'fw-media-type';
  var TYPES = ['game', 'book', 'film', 'tv', 'music'];
  var WIKIDATA = 'https://www.wikidata.org/w/api.php';
  var WIKIPEDIA = 'https://en.wikipedia.org/w/api.php';
  var IMAGE_TYPES = {
    'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
    'image/gif': '.gif', 'image/webp': '.webp'
  };

  function $(id) { return document.getElementById(id); }


  // ------------------------------------------------------------------------
  // Storage. localStorage can be missing or throw (private windows, blocked
  // site data); then the token is only remembered for this visit.
  // ------------------------------------------------------------------------

  var memory = {};

  function load(key) {
    try {
      var value = localStorage.getItem(key);
      if (value !== null) return value;
    } catch (e) { /* fall through to memory */ }
    return memory[key] || null;
  }

  function store(key, value) {
    memory[key] = value;
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { /* memory copy still works for this visit */ }
  }


  // ------------------------------------------------------------------------
  // Helpers shared with add_media.py. Keep slugify in step with the Python
  // version so cover filenames come out the same from either tool.
  // ------------------------------------------------------------------------

  function slugify(text) {
    var ascii = text.normalize('NFKD').replace(/[^\x00-\x7f]/g, '');
    var cleaned = ascii.replace(/[^\w\s-]/g, '').trim().toLowerCase();
    return cleaned.replace(/[\s_-]+/g, '-') || 'untitled';
  }

  function yearFrom(value) {
    var match = /(\d{4})/.exec(String(value || ''));
    return match ? Number(match[1]) : null;
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  }

  async function getJSON(url, params) {
    var resp = await fetch(params ? url + '?' + new URLSearchParams(params) : url);
    if (!resp.ok) throw new Error(new URL(url).hostname + ' answered ' + resp.status);
    return resp.json();
  }


  // ------------------------------------------------------------------------
  // Per-type lookups. Each returns a list of candidates:
  //   { title, creator, year, covers: [url, fallback, ...], thumb, url,
  //     detail, enrich }
  // enrich, when present, fetches details only worth getting for the one
  // candidate actually picked.
  // ------------------------------------------------------------------------

  async function searchBook(term) {
    var data = await getJSON('https://openlibrary.org/search.json', {
      q: term, limit: 8, fields: 'title,author_name,first_publish_year,cover_i,key'
    });
    return (data.docs || []).map(function (doc) {
      var cover = doc.cover_i && 'https://covers.openlibrary.org/b/id/' + doc.cover_i;
      return {
        title: doc.title,
        creator: (doc.author_name || []).slice(0, 2).join(', ') || null,
        year: doc.first_publish_year || null,
        covers: cover ? [cover + '-L.jpg'] : [],
        thumb: cover ? cover + '-M.jpg' : null,
        url: doc.key ? 'https://openlibrary.org' + doc.key : null,
        detail: null
      };
    });
  }

  function searchFilm(term) {
    // Director (P57), falling back to creator (P170).
    return searchWikidata(term, 'haswbstatement:P57', ['P57', 'P170']).then(function (items) {
      return items.map(function (item) {
        return {
          title: item.label,
          creator: item.creator,
          year: item.year,
          covers: item.image ? [item.image] : [],
          url: item.wikipedia || item.wikidata,
          detail: item.description
        };
      });
    });
  }

  function searchGame(term) {
    // Anything with a platform (P400) is a game, or close enough to show.
    // Developer (P178), falling back to publisher (P123).
    return searchWikidata(term, 'haswbstatement:P400', ['P178', 'P123']).then(function (items) {
      return items.map(function (item) {
        var appid = claimStrings(item.entity, 'P1733')[0];
        var steam = appid && 'https://cdn.akamai.steamstatic.com/steam/apps/' + appid;
        // Prefer the portrait library capsule so game art matches the shape
        // of book and film covers; the header banner is wide and crops badly.
        var covers = steam ? [steam + '/library_600x900.jpg', steam + '/header.jpg'] : [];
        if (item.image) covers.push(item.image);
        return {
          title: item.label,
          creator: item.creator,
          year: item.year,
          covers: covers,
          url: appid ? 'https://store.steampowered.com/app/' + appid
                     : item.wikipedia || item.wikidata,
          detail: item.description
        };
      });
    });
  }

  async function searchTv(term) {
    var data = await getJSON('https://api.tvmaze.com/search/shows', { q: term });
    return (data || []).slice(0, 8).map(function (hit) {
      var show = hit.show || {};
      var channel = show.network || show.webChannel || {};
      var image = show.image || {};
      return {
        title: show.name,
        // The network is a distributor, not a creator; it only stands in
        // until enrichTv finds the show's actual Creator credit.
        creator: channel.name || null,
        year: yearFrom(show.premiered),
        // "medium" is the poster-sized crop; "original" can be 3000px tall.
        covers: [image.medium || image.original].filter(Boolean),
        url: show.url || null,
        detail: (show.genres || []).join(', ') || null,
        enrich: show.id ? function (candidate) { return enrichTv(candidate, show.id); } : null
      };
    });
  }

  async function enrichTv(candidate, showId) {
    var crew = await getJSON('https://api.tvmaze.com/shows/' + showId + '/crew');
    var creators = (crew || []).filter(function (member) {
      return member.type === 'Creator' && member.person && member.person.name;
    }).map(function (member) { return member.person.name; });
    if (creators.length) candidate.creator = creators.slice(0, 2).join(', ');
  }

  async function searchMusic(term) {
    var data = await getJSON('https://itunes.apple.com/search', {
      term: term, media: 'music', entity: 'album', limit: 8
    });
    return (data.results || []).map(function (album) {
      var artwork = album.artworkUrl100 || '';
      return {
        title: album.collectionName,
        creator: album.artistName || null,
        year: yearFrom(album.releaseDate),
        // The 100x100 path swaps out for any size Apple hosts.
        covers: artwork ? [artwork.replace('100x100bb', '600x600bb')] : [],
        thumb: artwork || null,
        url: album.collectionViewUrl || null,
        detail: album.primaryGenreName || null
      };
    });
  }

  var SEARCHERS = {
    book: searchBook, film: searchFilm, tv: searchTv, game: searchGame, music: searchMusic
  };


  // ------------------------------------------------------------------------
  // Wikidata, shared by films and games: a full-text search narrowed by a
  // haswbstatement filter, one batched fetch for the matching items, one for
  // the names of the people or studios they credit, and one to Wikipedia for
  // the infobox images.
  // ------------------------------------------------------------------------

  async function searchWikidata(term, filter, creatorProps) {
    var found = await getJSON(WIKIDATA, {
      action: 'query', list: 'search', srsearch: term + ' ' + filter,
      srlimit: 8, format: 'json', origin: '*'
    });
    var ids = ((found.query || {}).search || []).map(function (hit) { return hit.title; });
    if (!ids.length) return [];

    var data = await getJSON(WIKIDATA, {
      action: 'wbgetentities', ids: ids.join('|'),
      props: 'labels|descriptions|claims|sitelinks', languages: 'en',
      sitefilter: 'enwiki', format: 'json', origin: '*'
    });
    var entities = ids.map(function (id) { return (data.entities || {})[id]; })
      .filter(function (entity) { return entity && !('missing' in entity); });

    var creatorIds = entities.map(function (entity) {
      for (var i = 0; i < creatorProps.length; i++) {
        var found = claimIds(entity, creatorProps[i]);
        if (found.length) return found.slice(0, 2);
      }
      return [];
    });
    var articles = entities.map(function (entity) {
      return ((entity.sitelinks || {}).enwiki || {}).title || null;
    });

    var lookups = await Promise.all([
      wikidataLabels([].concat.apply([], creatorIds)),
      wikipediaImages(articles.filter(Boolean))
    ]);
    var names = lookups[0];
    var images = lookups[1];

    return entities.map(function (entity, i) {
      var article = articles[i];
      var years = ((entity.claims || {}).P577 || []).map(function (statement) {
        return yearFrom(((statement.mainsnak.datavalue || {}).value || {}).time);
      }).filter(Boolean);
      return {
        entity: entity,
        label: labelOf(entity),
        description: ((entity.descriptions || {}).en || {}).value || null,
        creator: creatorIds[i].map(function (id) { return names[id]; })
          .filter(Boolean).join(', ') || null,
        // Publication date (P577): take the earliest.
        year: years.length ? Math.min.apply(null, years) : null,
        image: article ? images[article] || null : null,
        wikipedia: article
          ? 'https://en.wikipedia.org/wiki/' + encodeURIComponent(article.replace(/ /g, '_'))
          : null,
        wikidata: 'https://www.wikidata.org/wiki/' + entity.id
      };
    });
  }

  function labelOf(entity) {
    var labels = entity.labels || {};
    if (labels.en) return labels.en.value;
    var any = Object.keys(labels)[0];
    return any ? labels[any].value : entity.id;
  }

  function claimIds(entity, prop) {
    return ((entity.claims || {})[prop] || []).map(function (statement) {
      var value = (statement.mainsnak.datavalue || {}).value;
      return value && value.id;
    }).filter(Boolean);
  }

  function claimStrings(entity, prop) {
    return ((entity.claims || {})[prop] || []).map(function (statement) {
      return (statement.mainsnak.datavalue || {}).value;
    }).filter(function (value) { return typeof value === 'string'; });
  }

  async function wikidataLabels(ids) {
    var unique = ids.filter(function (id, i) { return ids.indexOf(id) === i; }).slice(0, 50);
    if (!unique.length) return {};
    var data = await getJSON(WIKIDATA, {
      action: 'wbgetentities', ids: unique.join('|'), props: 'labels',
      languages: 'en', format: 'json', origin: '*'
    });
    var names = {};
    Object.keys(data.entities || {}).forEach(function (id) {
      var label = ((data.entities[id].labels || {}).en || {}).value;
      if (label) names[id] = label;
    });
    return names;
  }

  /* Each article's lead image. pilicense=any matters: posters and box art are
     almost all non-free images, which the API leaves out by default. */
  async function wikipediaImages(titles) {
    if (!titles.length) return {};
    var data = await getJSON(WIKIPEDIA, {
      action: 'query', prop: 'pageimages', piprop: 'thumbnail', pithumbsize: 400,
      pilicense: 'any', redirects: 1, titles: titles.join('|'),
      format: 'json', origin: '*'
    });
    var query = data.query || {};
    var byTitle = {};
    Object.keys(query.pages || {}).forEach(function (key) {
      var page = query.pages[key];
      if (page.thumbnail) byTitle[page.title] = page.thumbnail.source.split('?')[0];
    });
    var hops = {};
    (query.normalized || []).concat(query.redirects || []).forEach(function (hop) {
      hops[hop.from] = hop.to;
    });
    var images = {};
    titles.forEach(function (title) {
      var current = title;
      for (var n = 0; hops[current] && n < 3; n++) current = hops[current];
      if (byTitle[current]) images[title] = byTitle[current];
    });
    return images;
  }


  // ------------------------------------------------------------------------
  // GitHub
  // ------------------------------------------------------------------------

  function token() { return load(TOKEN_KEY); }

  async function github(path, options) {
    options = options || {};
    var headers = {
      Accept: options.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      Authorization: 'Bearer ' + (options.token || token()),
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (options.body) headers['Content-Type'] = 'application/json';

    var resp = await fetch('https://api.github.com/repos/' + REPO + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (!resp.ok) {
      var message = '';
      try { message = (await resp.json()).message || ''; } catch (e) { /* not JSON */ }
      var error = new Error('GitHub answered ' + resp.status + (message ? ': ' + message : ''));
      error.status = resp.status;
      throw error;
    }
    return options.raw ? resp.text() : resp.json();
  }

  /* GitHub lets browsers cache API reads for up to a minute. A unique query
     string makes sure we see where the branch is right now. */
  async function headCommit() {
    var ref = await github('/git/ref/heads/' + BRANCH + '?fresh=' + Date.now());
    return ref.object.sha;
  }

  async function readLog(commitSha) {
    var text;
    try {
      text = await github('/contents/' + DATA_PATH + '?ref=' + commitSha, { raw: true });
    } catch (error) {
      if (error.status !== 404) throw error;
      text = '';
    }
    return parseLog(text);
  }


  // ------------------------------------------------------------------------
  // media.yml, handled as text. The file is split into one chunk per entry,
  // and a new entry's chunk is slotted in among the others untouched, so a
  // save from the site adds lines without reformatting the entries you
  // wrote by hand or with add_media.py.
  // ------------------------------------------------------------------------

  function parseLog(text) {
    var lines = text.replace(/\r\n/g, '\n').split('\n');
    if (lines[lines.length - 1] === '') lines.pop();

    var head = [];
    var chunks = [];
    lines.forEach(function (line) {
      // Only a top-level list item starts at column 0 with a dash; anything
      // nested or wrapped inside an entry is indented.
      if (/^-( |$)/.test(line)) chunks.push([line]);
      else if (chunks.length) chunks[chunks.length - 1].push(line);
      else head.push(line);
    });

    var texts = chunks.map(function (chunk) { return chunk.join('\n'); });
    var entries = texts.map(function (chunk) {
      var parsed = jsyaml.load(chunk);
      if (!Array.isArray(parsed) || parsed.length !== 1 || !parsed[0] || typeof parsed[0] !== 'object') {
        throw new Error(DATA_PATH + ' is not laid out as a list of entries');
      }
      return parsed[0];
    });

    // Cross-check the chunking against a parse of the whole file.
    var whole = jsyaml.load(text) || [];
    if (!Array.isArray(whole) || whole.length !== entries.length) {
      throw new Error(DATA_PATH + ' could not be split into entries safely');
    }
    return { head: head, chunks: texts, entries: entries };
  }

  /* Newest activity first, on whatever date the entry actually has - the
     same order add_media.py sorts into. */
  function activity(entry) {
    var value = entry.finished || entry.started || entry.added || '';
    return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  }

  function logWith(log, entry) {
    var rows = log.entries.map(function (existing, i) {
      return { key: activity(existing), text: log.chunks[i] };
    });
    rows.push({
      key: activity(entry),
      text: jsyaml.dump([entry], { lineWidth: -1 }).replace(/\n$/, '')
    });
    // Stable sort, so ties keep their order in the file.
    rows.sort(function (a, b) { return a.key === b.key ? 0 : (a.key < b.key ? 1 : -1); });

    var head = log.head.filter(function (line) { return line.trim() !== '[]'; });
    var text = head.concat(rows.map(function (row) { return row.text; })).join('\n') + '\n';

    var check = jsyaml.load(text);
    var saved = Array.isArray(check) && check.filter(function (e) { return e.id === entry.id; })[0];
    if (!saved || check.length !== log.entries.length + 1 || saved.title !== entry.title) {
      throw new Error('the updated ' + DATA_PATH + ' did not read back correctly, so nothing was saved');
    }
    return text;
  }

  /* Same rule as add_media.py: the same title and type, or the same source
     link, means it is already logged. */
  function findDuplicate(entries, title, type, url) {
    var lowered = String(title || '').toLowerCase();
    return entries.filter(function (entry) {
      return (String(entry.title || '').toLowerCase() === lowered && entry.type === type) ||
        (url && entry.url === url);
    })[0] || null;
  }

  function uniqueSlug(base, entries) {
    var taken = {};
    entries.forEach(function (entry) { taken[entry.id] = true; });
    if (!taken[base]) return base;
    var n = 2;
    while (taken[base + '-' + n]) n++;
    return base + '-' + n;
  }


  // ------------------------------------------------------------------------
  // Covers. The image is downloaded in the browser as soon as a match is
  // picked, so the preview is exactly the file that gets committed.
  // ------------------------------------------------------------------------

  var cover = null;          // { blob, ext, preview } or null
  var coverBlobSha = null;   // uploaded blob, reused if a save has to retry

  function imageType(blob) {
    return IMAGE_TYPES[(blob.type || '').split(';')[0].trim().toLowerCase()] || null;
  }

  async function fetchImage(url) {
    var resp = await fetch(url, { referrerPolicy: 'no-referrer' });
    if (!resp.ok) throw new Error('the image host answered ' + resp.status);
    var blob = await resp.blob();
    if (!imageType(blob)) throw new Error('that is not a JPEG, PNG, GIF, or WebP image');
    return blob;
  }

  function setCover(blob, note) {
    if (cover) URL.revokeObjectURL(cover.preview);
    cover = blob ? { blob: blob, ext: imageType(blob), preview: URL.createObjectURL(blob) } : null;
    coverBlobSha = null;
    $('add-cover-img').hidden = !cover;
    $('add-cover-blank').hidden = !!cover;
    if (cover) $('add-cover-img').src = cover.preview;
    else $('add-cover-img').removeAttribute('src');
    $('add-cover-status').textContent = note || '';
  }

  async function coverFromUrls(urls, run) {
    setCover(null, urls.length ? 'Fetching cover…' : 'No cover found.');
    for (var i = 0; i < urls.length; i++) {
      try {
        var blob = await fetchImage(urls[i]);
        if (run === picked) setCover(blob);
        return;
      } catch (e) { /* try the next candidate */ }
    }
    if (run === picked && urls.length) setCover(null, 'Could not fetch a cover.');
  }

  function toBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result).split(',')[1]); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }


  // ------------------------------------------------------------------------
  // Page state
  // ------------------------------------------------------------------------

  var type = TYPES.indexOf(load(TYPE_KEY)) !== -1 ? load(TYPE_KEY) : 'game';
  var candidates = [];
  var known = [];       // entries already in the log, for "In your log" marks
  var searches = 0;     // bumped per search, so a slow old one can't land late
  var picked = 0;       // bumped per pick, likewise for details and covers
  var saving = false;

  function showTokenPanel(message) {
    $('add-main').hidden = true;
    $('add-token-panel').hidden = false;
    $('add-token-error').hidden = !message;
    $('add-token-error').textContent = message || '';
  }

  function showMain() {
    $('add-token-panel').hidden = true;
    $('add-main').hidden = false;
    setType(type);
    refreshKnown();
    $('add-term').focus();
  }

  async function refreshKnown() {
    try {
      known = (await readLog(await headCommit())).entries;
      renderResults();
    } catch (error) {
      if (error.status === 401) showTokenPanel(rejectedToken());
      // Anything else only costs the duplicate marks; Save checks again.
    }
  }

  function rejectedToken() {
    return 'GitHub rejected the saved token. It may have expired or been revoked. Paste a new one.';
  }

  function setType(value) {
    type = value;
    store(TYPE_KEY, value);
    Array.prototype.forEach.call(root.querySelectorAll('.media-filter'), function (button) {
      button.classList.toggle('is-active', button.dataset.type === value);
    });
  }

  function setStatus(text) { $('add-search-status').textContent = text || ''; }


  // ------------------------------------------------------------------------
  // Searching and picking
  // ------------------------------------------------------------------------

  async function search() {
    var term = $('add-term').value.trim();
    if (!term) return;
    var run = ++searches;

    $('add-entry').hidden = true;
    $('add-done').hidden = true;
    $('add-results').hidden = false;
    $('add-manual-wrap').hidden = true;
    candidates = [];
    renderResults();
    setStatus('Searching…');

    try {
      var found = (await SEARCHERS[type](term)).filter(function (c) { return c.title; });
      if (run !== searches) return;
      candidates = found;
      renderResults();
      setStatus(found.length ? '' : 'Nothing found. Try another spelling, or enter it by hand.');
    } catch (error) {
      if (run !== searches) return;
      setStatus('Search failed: ' + error.message);
    }
    $('add-manual-wrap').hidden = false;
  }

  function thumbnail(urls) {
    if (!urls.length) return blankThumb();
    var img = document.createElement('img');
    var next = 0;
    img.className = 'media-cover';
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.onerror = function () {
      next++;
      if (next < urls.length) img.src = urls[next];
      else img.replaceWith(blankThumb());
    };
    img.src = urls[0];
    return img;
  }

  function blankThumb() {
    var span = document.createElement('span');
    span.className = 'media-cover media-cover-blank';
    return span;
  }

  function renderResults() {
    var list = $('add-results');
    list.textContent = '';
    candidates.forEach(function (candidate, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'media-add-result';
      button.dataset.index = index;

      var urls = candidate.thumb ? [candidate.thumb] : candidate.covers;
      button.appendChild(thumbnail(urls));

      var text = document.createElement('span');
      text.className = 'media-add-result-text';
      var title = document.createElement('span');
      title.className = 'media-add-result-title';
      title.textContent = candidate.title;
      text.appendChild(title);

      var meta = [candidate.creator, candidate.year].filter(Boolean).join(' · ');
      [meta, candidate.detail].forEach(function (line) {
        if (!line) return;
        var span = document.createElement('span');
        span.className = 'media-add-result-meta';
        span.textContent = line;
        text.appendChild(span);
      });
      button.appendChild(text);

      if (findDuplicate(known, candidate.title, type, candidate.url)) {
        var badge = document.createElement('span');
        badge.className = 'media-add-badge';
        badge.textContent = 'In your log';
        button.appendChild(badge);
      }

      var item = document.createElement('li');
      item.appendChild(button);
      list.appendChild(item);
    });
  }

  async function pick(candidate) {
    var run = ++picked;
    openForm({
      title: candidate.title || '',
      type: type,
      creator: candidate.creator || '',
      year: candidate.year || '',
      url: candidate.url || ''
    });
    var coverLoad = coverFromUrls(candidate.covers || [], run);

    if (candidate.enrich) {
      try {
        await candidate.enrich(candidate);
        if (run === picked && candidate.creator) $('add-creator').value = candidate.creator;
      } catch (e) { /* keep what the search returned */ }
    }
    await coverLoad;
  }

  function openForm(values) {
    $('add-title').value = values.title;
    $('add-type').value = values.type;
    $('add-creator').value = values.creator;
    $('add-year').value = values.year;
    $('add-url').value = values.url;
    $('add-cover-change').hidden = true;
    $('add-entry-error').hidden = true;
    $('add-results').hidden = true;
    $('add-manual-wrap').hidden = true;
    $('add-entry').hidden = false;
    $('add-entry').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function backToResults() {
    picked++;
    $('add-entry').hidden = true;
    $('add-results').hidden = false;
    $('add-manual-wrap').hidden = false;
  }

  function resetForm() {
    ['add-title', 'add-creator', 'add-year', 'add-started', 'add-finished',
     'add-rating', 'add-comment', 'add-url', 'add-cover-url'].forEach(function (id) {
      $(id).value = '';
    });
    $('add-cover-file').value = '';
    setCover(null);
  }


  // ------------------------------------------------------------------------
  // Saving
  // ------------------------------------------------------------------------

  /* Validate the form the way add_media.py's prompts do. Returns the values,
     or null after showing what is wrong. */
  function readForm() {
    var problems = [];
    var title = $('add-title').value.trim();
    if (!title) problems.push('Give it a title.');

    var year = $('add-year').value.trim();
    if (year && !/^\d{1,4}$/.test(year)) problems.push('Year should be a number like 2025.');

    function date(id, label) {
      var value = $(id).value.trim();
      if (!value) return null;
      if (value.toLowerCase() === 'today') return today();
      if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(value)) return value;
      problems.push(label + ' should be YYYY-MM-DD, YYYY-MM, or YYYY.');
      return null;
    }
    var started = date('add-started', 'Started');
    var finished = date('add-finished', 'Finished');

    var rating = null;
    var rawRating = $('add-rating').value.trim();
    if (rawRating) {
      rating = Number(rawRating);
      if (isNaN(rating) || rating < 0 || rating > 5) {
        problems.push('Rating should be between 0 and 5.');
        rating = null;
      }
    }

    if (problems.length) {
      $('add-entry-error').textContent = problems.join(' ');
      $('add-entry-error').hidden = false;
      return null;
    }

    return {
      title: title,
      type: $('add-type').value,
      creator: $('add-creator').value.trim() || null,
      year: year ? Number(year) : null,
      started: started,
      finished: finished,
      rating: rating,
      comment: $('add-comment').value.trim() || null,
      url: $('add-url').value.trim() || null
    };
  }

  function saveError(error) {
    if (error.plain) return error.message;
    if (error.status === 401) return rejectedToken();
    if (error.status === 403 || error.status === 404) {
      return 'The token can\'t write to ' + REPO + '. On GitHub, give it Contents: Read and write ' +
        'for this repo, or make a new one. (' + error.message + ')';
    }
    return 'Could not save: ' + error.message;
  }

  async function save() {
    if (saving) return;
    var values = readForm();
    if (!values) return;

    saving = true;
    $('add-save').disabled = true;
    $('add-entry-error').hidden = true;
    var button = $('add-save');

    try {
      for (var attempt = 1; ; attempt++) {
        button.textContent = 'Reading the log…';
        var parent = await headCommit();
        var parentCommit = await github('/git/commits/' + parent);
        var log = await readLog(parent);

        var duplicate = findDuplicate(log.entries, values.title, values.type, values.url);
        if (duplicate) {
          var already = new Error('Already in the log as “' + duplicate.title + '”. Nothing was saved.');
          already.plain = true;
          throw already;
        }

        var id = uniqueSlug(slugify(values.title), log.entries);
        var coverPath = cover ? COVER_DIR + '/' + id + cover.ext : null;
        var entry = {
          id: id,
          title: values.title,
          type: values.type,
          creator: values.creator,
          year: values.year,
          started: values.started,
          finished: values.finished,
          rating: values.rating,
          comment: values.comment,
          cover: coverPath ? '/' + coverPath : null,
          url: values.url,
          added: today()
        };

        var files = [{ path: DATA_PATH, mode: '100644', type: 'blob', content: logWith(log, entry) }];
        if (cover) {
          if (!coverBlobSha) {
            button.textContent = 'Uploading the cover…';
            coverBlobSha = (await github('/git/blobs', {
              method: 'POST',
              body: { content: await toBase64(cover.blob), encoding: 'base64' }
            })).sha;
          }
          files.push({ path: coverPath, mode: '100644', type: 'blob', sha: coverBlobSha });
        }

        button.textContent = 'Committing…';
        var tree = await github('/git/trees', {
          method: 'POST',
          body: { base_tree: parentCommit.tree.sha, tree: files }
        });
        var commit = await github('/git/commits', {
          method: 'POST',
          body: { message: 'Add "' + values.title + '" to media log', tree: tree.sha, parents: [parent] }
        });

        try {
          await github('/git/refs/heads/' + BRANCH, {
            method: 'PATCH',
            body: { sha: commit.sha, force: false }
          });
        } catch (error) {
          // Something else was pushed in between: redo it on top of that.
          if (error.status === 422 && attempt < 3) continue;
          throw error;
        }

        known = log.entries.concat([entry]);
        showDone(values.title, commit.html_url);
        return;
      }
    } catch (error) {
      $('add-entry-error').textContent = saveError(error);
      $('add-entry-error').hidden = false;
      if (error.status === 401) showTokenPanel(rejectedToken());
    } finally {
      saving = false;
      button.disabled = false;
      button.textContent = 'Save to log';
    }
  }

  function showDone(title, commitUrl) {
    var message = $('add-done-message');
    message.textContent = 'Saved “' + title + '”. The site rebuilds in a minute or two. ';

    var commitLink = document.createElement('a');
    commitLink.href = commitUrl;
    commitLink.rel = 'noopener';
    commitLink.textContent = 'See the commit';
    var buildLink = document.createElement('a');
    buildLink.href = 'https://github.com/' + REPO + '/actions';
    buildLink.rel = 'noopener';
    buildLink.textContent = 'watch the build';
    message.appendChild(commitLink);
    message.appendChild(document.createTextNode(' or '));
    message.appendChild(buildLink);
    message.appendChild(document.createTextNode('.'));

    $('add-entry').hidden = true;
    $('add-done').hidden = false;
    candidates = [];
    renderResults();
    $('add-results').hidden = false;
    setStatus('');
  }


  // ------------------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------------------

  $('add-token-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var value = $('add-token').value.trim();
    var errorBox = $('add-token-error');
    errorBox.hidden = true;
    try {
      await github('', { token: value });
    } catch (error) {
      errorBox.textContent = error.status === 401
        ? 'GitHub rejected that token. Check you copied all of it.'
        : 'Could not check the token: ' + error.message;
      errorBox.hidden = false;
      return;
    }
    store(TOKEN_KEY, value);
    $('add-token').value = '';
    showMain();
  });

  $('add-forget').addEventListener('click', function () {
    store(TOKEN_KEY, null);
    showTokenPanel();
  });

  $('add-search-form').addEventListener('submit', function (e) {
    e.preventDefault();
    search();
  });

  Array.prototype.forEach.call(root.querySelectorAll('.media-filter'), function (button) {
    button.addEventListener('click', function () {
      setType(button.dataset.type);
      if ($('add-term').value.trim()) search();
      else $('add-term').focus();
    });
  });

  $('add-results').addEventListener('click', function (e) {
    var button = e.target.closest('.media-add-result');
    if (button) pick(candidates[Number(button.dataset.index)]);
  });

  $('add-manual').addEventListener('click', function () {
    picked++;
    openForm({ title: $('add-term').value.trim(), type: type, creator: '', year: '', url: '' });
    setCover(null);
    $('add-cover-change').hidden = false;
  });

  $('add-cancel').addEventListener('click', backToResults);

  $('add-entry').addEventListener('submit', function (e) {
    e.preventDefault();
    save();
  });

  Array.prototype.forEach.call(root.querySelectorAll('[data-today]'), function (button) {
    button.addEventListener('click', function () { $(button.dataset.today).value = today(); });
  });

  $('add-cover-toggle').addEventListener('click', function () {
    $('add-cover-change').hidden = !$('add-cover-change').hidden;
  });

  $('add-cover-fetch').addEventListener('click', async function () {
    var url = $('add-cover-url').value.trim();
    if (!url) return;
    var run = ++picked;
    $('add-cover-status').textContent = 'Fetching…';
    try {
      var blob = await fetchImage(url);
      if (run === picked) setCover(blob);
    } catch (error) {
      if (run !== picked) return;
      // A TypeError here is the browser refusing the download outright,
      // which is what a host that blocks other sites' pages looks like.
      $('add-cover-status').textContent = error instanceof TypeError
        ? 'That site won\'t let a web page download its images. Save the image and upload it instead.'
        : 'Could not use that image: ' + error.message + '.';
    }
  });

  $('add-cover-file').addEventListener('change', function () {
    var file = $('add-cover-file').files[0];
    if (!file) return;
    picked++;
    if (imageType(file)) setCover(file);
    else $('add-cover-status').textContent = 'Use a JPEG, PNG, GIF, or WebP image.';
  });

  $('add-cover-clear').addEventListener('click', function () {
    picked++;
    setCover(null);
  });

  $('add-another').addEventListener('click', function () {
    resetForm();
    $('add-done').hidden = true;
    $('add-term').value = '';
    $('add-term').focus();
  });

  if (token()) showMain();
  else showTokenPanel();
})();
