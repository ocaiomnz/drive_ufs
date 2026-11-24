/**
 * UFS DRIVE — upload + navegador de arquivos.
 * Fluxo: nome → arquivos → upload-url → PUT → POST /api/files → espelho nas portas.
 */
(function () {
  const NAME_KEY = 'ufs_drive_owner_name';
  const CONCURRENCY = 2;
  const POLL_MS = 45000;
  const POLL_JITTER_MS = 15000;
  const PAGE = 48;
  const THUMB_MAX = 640;
  const RETRY_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 2000;
  const EXT_TYPES = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    heic: 'image/heic', heif: 'image/heif', gif: 'image/gif', svg: 'image/svg+xml',
    pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain', csv: 'text/csv',
    md: 'text/markdown', json: 'application/json', mp4: 'video/mp4', webm: 'video/webm',
    mp3: 'audio/mpeg', wav: 'audio/wav',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };

  const $ = (id) => document.getElementById(id);
  const ownerForm = $('owner-form');
  const nameInput = $('owner-name');
  const suggestEl = $('name-suggest');
  const ownerError = $('owner-error');
  const uploadStep = $('upload-step');
  const ownerLabel = $('owner-label');
  const filePicker = $('file-picker');
  const fileCamera = $('file-camera');
  const summaryEl = $('upload-summary');
  const queueEl = $('queue');
  const grid = $('file-grid');
  const emptyEl = $('files-empty');
  const countEl = $('files-count');
  const tabMine = $('tab-mine');
  const myFolderBar = $('my-folder-bar');
  const myFolderDownload = $('my-folder-download');
  const moreBtn = $('files-more');
  const lightbox = $('lightbox');
  const lbImg = $('lb-img');
  const lbName = $('lb-name');
  const lbTime = $('lb-time');
  const lbCount = $('lb-count');
  const lbOpen = $('lb-open');
  const lbPrev = $('lb-prev');
  const lbNext = $('lb-next');
  const userChip = $('user-chip');
  const searchInput = $('file-search');

  if (!ownerForm || !grid) return;

  const limits = $('enviar').dataset;
  const MAX_BYTES = Number(limits.maxBytes) || 50 * 1024 * 1024;
  const MAX_MB = limits.maxMb || '50';

  function read(key) {
    try { return localStorage.getItem(key) || ''; } catch (_) { return ''; }
  }
  function store(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch (_) {}
  }

  function ownerKey(name) {
    return String(name || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
  }

  function isImage(mime) {
    return typeof mime === 'string' && mime.startsWith('image/') && mime !== 'image/svg+xml';
  }

  function formatBytes(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  }

  let ownerName = read(NAME_KEY);
  let owners = [];
  let layout = 'grid';
  let searchQ = '';

  async function loadOwners() {
    try {
      const res = await fetch('/api/owners', { cache: 'no-store' });
      if (res.ok) owners = (await res.json()).owners || [];
    } catch (_) {}
  }

  function hideSuggestions() {
    suggestEl.hidden = true;
    suggestEl.innerHTML = '';
    nameInput.setAttribute('aria-expanded', 'false');
  }

  function renderSuggestions() {
    const q = ownerKey(nameInput.value);
    const matches = q
      ? owners.filter((g) => g.key.startsWith(q) || g.key.includes('-' + q)).slice(0, 6)
      : [];
    if (!matches.length) return hideSuggestions();
    suggestEl.innerHTML = '';
    matches.forEach((g) => {
      const li = el('li');
      li.setAttribute('role', 'option');
      const btn = el('button', 'suggest-item');
      btn.type = 'button';
      btn.dataset.name = g.name;
      btn.append(
        el('span', 'suggest-name', g.name),
        el('span', 'suggest-count', plural(g.count, 'arquivo', 'arquivos'))
      );
      li.appendChild(btn);
      suggestEl.appendChild(li);
    });
    suggestEl.hidden = false;
    nameInput.setAttribute('aria-expanded', 'true');
  }

  nameInput.addEventListener('input', renderSuggestions);
  nameInput.addEventListener('focus', renderSuggestions);
  nameInput.addEventListener('blur', () => setTimeout(hideSuggestions, 150));
  suggestEl.addEventListener('mousedown', (e) => e.preventDefault());
  suggestEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.suggest-item');
    if (!btn) return;
    nameInput.value = btn.dataset.name;
    hideSuggestions();
    ownerForm.requestSubmit();
  });

  function syncUserChip() {
    if (!userChip) return;
    userChip.textContent = ownerName || 'Entrar na pasta';
  }

  function openOwnerForm() {
    nameInput.value = ownerName;
    nameInput.removeAttribute('aria-invalid');
    ownerError.textContent = '';
    uploadStep.hidden = true;
    ownerForm.hidden = false;
    loadOwners();
  }

  function openUploadStep() {
    ownerLabel.textContent = ownerName;
    ownerForm.hidden = true;
    uploadStep.hidden = false;
    syncUserChip();
  }

  ownerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim().replace(/\s+/g, ' ');
    if (!ownerKey(name)) {
      ownerError.textContent = 'Informe um nome.';
      nameInput.setAttribute('aria-invalid', 'true');
      nameInput.focus();
      return;
    }
    hideSuggestions();
    ownerName = name.slice(0, 120);
    store(NAME_KEY, ownerName);
    openUploadStep();
    resetMine();
  });

  $('owner-change').addEventListener('click', () => {
    openOwnerForm();
    nameInput.focus();
    nameInput.select();
  });

  function ensureOwnerThen(fn) {
    if (ownerName) {
      openUploadStep();
      fn();
    } else {
      openOwnerForm();
      nameInput.focus();
    }
  }

  $('sidebar-new')?.addEventListener('click', () => {
    ensureOwnerThen(() => filePicker.click());
  });
  $('pick-files').addEventListener('click', () => ensureOwnerThen(() => filePicker.click()));
  $('pick-camera').addEventListener('click', () => ensureOwnerThen(() => fileCamera.click()));
  userChip?.addEventListener('click', (e) => {
    if (!ownerName) {
      e.preventDefault();
      openOwnerForm();
    }
  });

  [filePicker, fileCamera].forEach((input) => {
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      input.value = '';
      if (files.length) {
        if (!ownerName) {
          openOwnerForm();
          return;
        }
        enqueue(files);
      }
    });
  });

  $('menu-toggle')?.addEventListener('click', () => {
    document.querySelector('.drive-app')?.classList.toggle('sidebar-open');
  });

  const pending = [];
  let active = 0;
  let batch = { total: 0, done: 0, failed: 0 };

  function resolveType(file) {
    if (file.type) return file.type;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    return EXT_TYPES[ext] || 'application/octet-stream';
  }

  function createQueueItem(file) {
    const li = el('li', 'queue-item');
    const thumb = el('span', 'queue-thumb');
    const previewUrl = URL.createObjectURL(file);
    if (isImage(resolveType(file))) {
      const img = new Image();
      img.alt = '';
      img.onerror = () => { img.remove(); thumb.textContent = '📄'; };
      img.src = previewUrl;
      thumb.appendChild(img);
    } else {
      thumb.textContent = '📄';
    }
    const body = el('div', 'queue-body');
    body.append(
      el('span', 'queue-name', file.name),
      el('span', 'queue-state', 'Na fila…')
    );
    const bar = el('span', 'queue-bar');
    const fill = el('i');
    bar.appendChild(fill);
    body.appendChild(bar);
    const icon = el('span', 'queue-icon', '·');
    li.append(thumb, body, icon);
    queueEl.appendChild(li);
    return { file, contentType: resolveType(file), li, state: body.querySelector('.queue-state'), fill, icon, previewUrl };
  }

  function setItem(item, cls, text) {
    item.li.classList.remove('is-uploading', 'is-done', 'is-failed');
    if (cls) item.li.classList.add(cls);
    item.state.textContent = text;
  }

  function clearFinished() {
    queueEl.querySelectorAll('.queue-item.is-done').forEach((li) => {
      const img = li.querySelector('img');
      if (img) URL.revokeObjectURL(img.src);
      li.remove();
    });
  }

  function updateSummary() {
    summaryEl.classList.remove('is-ok', 'is-error');
    const finished = batch.done + batch.failed;
    if (!batch.total) summaryEl.textContent = '';
    else if (finished < batch.total) {
      summaryEl.textContent = `Enviando ${finished + 1} de ${batch.total}…`;
    } else if (!batch.failed) {
      summaryEl.textContent = plural(batch.done, 'arquivo enviado', 'arquivos enviados') +
        ' · sync nas portas em segundo plano';
      summaryEl.classList.add('is-ok');
    } else {
      summaryEl.textContent =
        `${plural(batch.done, 'enviado', 'enviados')} · ${plural(batch.failed, 'falhou', 'falharam')}. Toque em Reenviar.`;
      summaryEl.classList.add('is-error');
    }
  }

  function enqueue(files) {
    if (active === 0 && pending.length === 0) {
      clearFinished();
      batch = { total: 0, done: 0, failed: 0 };
    }
    files.forEach((file) => {
      pending.push(createQueueItem(file));
      batch.total += 1;
    });
    updateSummary();
    pump();
  }

  function pump() {
    while (active < CONCURRENCY && pending.length) {
      const item = pending.shift();
      active += 1;
      uploadOne(item)
        .then(() => {
          batch.done += 1;
          setItem(item, 'is-done', 'Salvo');
          item.icon.textContent = '✓';
        })
        .catch((err) => handleFailure(item, err))
        .finally(() => {
          active -= 1;
          updateSummary();
          pump();
        });
    }
  }

  function handleFailure(item, err) {
    batch.failed += 1;
    setItem(item, 'is-failed', err.message || 'Falha');
    if (err.final) {
      item.icon.textContent = '×';
      return;
    }
    const retry = el('button', 'queue-retry', 'Reenviar');
    retry.type = 'button';
    retry.addEventListener('click', () => {
      batch.failed -= 1;
      retry.replaceWith(item.icon);
      item.icon.textContent = '·';
      setItem(item, null, 'Na fila…');
      pending.push(item);
      updateSummary();
      pump();
    });
    item.icon.replaceWith(retry);
  }

  function failure(message, { retry = false, final = false } = {}) {
    const err = new Error(message);
    err.retry = retry;
    err.final = final;
    return err;
  }

  function tooLarge() {
    return failure(`Arquivo maior que ${MAX_MB} MB`, { final: true });
  }

  async function withRetry(fn) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        if (!err.retry || attempt >= RETRY_ATTEMPTS) throw err;
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
  }

  function postJson(url, body) {
    return withRetry(async () => {
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (_) {
        throw failure('Conexão instável', { retry: true });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 413) throw tooLarge();
        throw failure(data.error || 'Não foi possível enviar', { retry: res.status >= 500 });
      }
      return data;
    });
  }

  function putFile(url, file, contentType, onProgress) {
    return withRetry(() => new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress((e.loaded / e.total) * 100);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else if (xhr.status === 413) reject(tooLarge());
        else reject(failure('Falha no envio', { retry: xhr.status >= 500 }));
      };
      xhr.onerror = () => reject(failure('Conexão instável', { retry: true }));
      xhr.send(file);
    }));
  }

  function makeThumb(item) {
    if (!isImage(item.contentType) || item.contentType === 'image/gif') return Promise.resolve(null);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, THUMB_MAX / Math.max(img.naturalWidth, img.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.8);
        } catch (_) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = item.previewUrl;
    });
  }

  async function uploadOne(item) {
    if (item.file.size > MAX_BYTES) throw tooLarge();
    setItem(item, 'is-uploading', 'Preparando…');
    item.fill.style.width = '0%';

    if (item.thumb === undefined) item.thumb = await makeThumb(item);

    const { uploadUrl, storageKey, thumbUploadUrl, thumbKey } = await postJson('/api/upload-url', {
      filename: item.file.name,
      contentType: item.contentType,
      owner_name: ownerName,
      thumb: Boolean(item.thumb),
      size: item.file.size,
    });

    setItem(item, 'is-uploading', 'Enviando…');
    await putFile(uploadUrl, item.file, item.contentType, (pct) => {
      item.fill.style.width = pct.toFixed(0) + '%';
    });

    let savedThumb;
    if (item.thumb && thumbUploadUrl) {
      try {
        await putFile(thumbUploadUrl, item.thumb, 'image/jpeg', () => {});
        savedThumb = thumbKey;
      } catch (_) {}
    }

    setItem(item, 'is-uploading', 'Confirmando…');
    const file = await postJson('/api/files', {
      owner_name: ownerName,
      storage_key: storageKey,
      filename: item.file.name,
      mime_type: item.contentType,
      size_bytes: item.file.size,
      thumb_key: savedThumb,
    });
    addOwnFile(file);
  }

  /* ---------- listagem ---------- */
  function newFeed(owner) {
    return { owner, files: [], ids: new Set(), hasMore: true, total: 0, loaded: false, loading: null };
  }

  const feeds = { all: newFeed(''), mine: newFeed(ownerKey(ownerName)) };
  let view = 'all';
  let myTotal = 0;
  let loadFailed = false;
  let sinceId = 0;
  let lbList = [];
  let current = -1;

  function fileIcon(mime, filename) {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    if (isImage(mime)) return '🖼';
    if (mime === 'application/pdf' || ext === 'pdf') return '📄';
    if ((mime || '').includes('zip') || ext === 'zip') return '🗜️';
    if ((mime || '').includes('sheet') || ext === 'xls' || ext === 'xlsx' || ext === 'csv') return '📊';
    if ((mime || '').includes('word') || ext === 'doc' || ext === 'docx') return '📝';
    if ((mime || '').startsWith('video/')) return '🎬';
    if ((mime || '').startsWith('audio/')) return '🎵';
    return '📁';
  }

  function buildCard(file) {
    const figure = el('figure', 'file-card');
    figure.dataset.fileId = String(file.id);
    const open = el('button', 'file-card__open');
    open.type = 'button';
    open.setAttribute('aria-label', 'Abrir ' + file.filename);

    if (file.thumb_url || isImage(file.mime_type)) {
      const img = el('img');
      img.src = file.thumb_url || file.url;
      img.alt = file.filename;
      img.loading = 'lazy';
      img.decoding = 'async';
      open.appendChild(img);
    } else {
      open.appendChild(el('span', 'file-card__icon', fileIcon(file.mime_type, file.filename)));
    }

    const cap = el('figcaption');
    cap.appendChild(el('span', 'file-card__name', file.filename));
    const meta = el('span', 'file-card__meta');
    meta.textContent = [file.owner_name, formatBytes(file.size_bytes), formatDate(file.uploaded_at)]
      .filter(Boolean).join(' · ');
    cap.appendChild(meta);
    figure.append(open, cap);
    open.addEventListener('click', () => openLightbox(file.id));
    return figure;
  }

  function matchesSearch(file) {
    if (!searchQ) return true;
    return (file.filename || '').toLowerCase().includes(searchQ)
      || (file.owner_name || '').toLowerCase().includes(searchQ);
  }

  function renderFeed() {
    const feed = feeds[view];
    const list = feed.files.filter(matchesSearch);
    grid.classList.toggle('is-list', layout === 'list');
    grid.innerHTML = '';
    list.forEach((f) => grid.appendChild(buildCard(f)));
    emptyEl.hidden = list.length > 0;
    if (!feed.loaded && !loadFailed) emptyEl.textContent = 'Carregando…';
    else if (loadFailed && !list.length) emptyEl.textContent = 'Não foi possível carregar.';
    else if (!list.length) emptyEl.textContent = searchQ ? 'Nenhum resultado.' : 'Nenhum arquivo ainda. Envie o primeiro.';
    countEl.textContent = feed.total ? plural(feed.total, 'arquivo', 'arquivos') : '';
    moreBtn.hidden = !feed.hasMore || view !== 'all' && view !== 'mine';
    if (myFolderBar) {
      const show = view === 'mine' && ownerName;
      myFolderBar.hidden = !show;
      if (show && myFolderDownload) {
        myFolderDownload.href = `/api/folders/${ownerKey(ownerName)}/download`;
      }
    }
    lbList = list.filter((f) => f.thumb_url || isImage(f.mime_type));
  }

  function addOwnFile(file) {
    [feeds.all, feeds.mine].forEach((feed) => {
      if (feed.ids.has(file.id)) return;
      if (feed.owner && file.owner_key !== feed.owner) return;
      feed.ids.add(file.id);
      feed.files.unshift(file);
      feed.total += 1;
    });
    myTotal = feeds.mine.total;
    if (tabMine) tabMine.textContent = myTotal ? `Minha pasta (${myTotal})` : 'Minha pasta';
    renderFeed();
  }

  function mergeFiles(feed, rows, { prepend } = {}) {
    const fresh = [];
    rows.forEach((f) => {
      if (feed.ids.has(f.id)) return;
      feed.ids.add(f.id);
      fresh.push(f);
      if (f.id > sinceId) sinceId = f.id;
    });
    if (prepend) feed.files = fresh.concat(feed.files);
    else feed.files = feed.files.concat(fresh);
  }

  async function fetchPage(feed, params) {
    const qs = new URLSearchParams(params);
    const res = await fetch(`/api/files?${qs}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('fail');
    return res.json();
  }

  async function loadMore(feedKey) {
    const feed = feeds[feedKey];
    if (feed.loading || !feed.hasMore) return;
    feed.loading = (async () => {
      try {
        const before = feed.files.length ? feed.files[feed.files.length - 1].id : undefined;
        const data = await fetchPage(feed, {
          limit: PAGE,
          owner: feed.owner || undefined,
          before: before || undefined,
          count_owner: ownerKey(ownerName) || undefined,
        });
        const rows = data.files || data.photos || [];
        mergeFiles(feed, rows);
        feed.total = data.total;
        feed.hasMore = Boolean(data.has_more);
        feed.loaded = true;
        loadFailed = false;
        if (data.owner_total != null) {
          myTotal = data.owner_total;
          feeds.mine.total = myTotal;
          if (tabMine) tabMine.textContent = myTotal ? `Minha pasta (${myTotal})` : 'Minha pasta';
        }
      } catch (_) {
        loadFailed = true;
      } finally {
        feed.loading = null;
        if (view === feedKey) renderFeed();
      }
    })();
    return feed.loading;
  }

  async function pollNew() {
    try {
      const data = await fetchPage(feeds.all, {
        after: sinceId || 0,
        count_owner: ownerKey(ownerName) || undefined,
      });
      const rows = data.files || data.photos || [];
      if (rows.length) {
        mergeFiles(feeds.all, rows, { prepend: true });
        if (ownerName) {
          const mine = rows.filter((f) => f.owner_key === ownerKey(ownerName));
          mergeFiles(feeds.mine, mine, { prepend: true });
        }
        feeds.all.total = data.total;
        if (data.owner_total != null) {
          myTotal = data.owner_total;
          feeds.mine.total = myTotal;
          if (tabMine) tabMine.textContent = myTotal ? `Minha pasta (${myTotal})` : 'Minha pasta';
        }
        renderFeed();
      }
    } catch (_) {}
    schedulePoll();
  }

  let pollTimer;
  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(pollNew, POLL_MS + Math.random() * POLL_JITTER_MS);
  }

  function resetMine() {
    feeds.mine = newFeed(ownerKey(ownerName));
    if (view === 'mine') {
      loadMore('mine');
    }
  }

  function setView(next) {
    view = next;
    document.querySelectorAll('.gallery-tab, .side-link[data-view]').forEach((btn) => {
      const active = btn.dataset.view === view;
      btn.classList.toggle('is-active', active);
      if (btn.getAttribute('role') === 'tab') btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const title = $('files-title');
    if (title) title.textContent = view === 'mine' ? 'Minha pasta' : 'Meu drive';
    if (!feeds[view].loaded) loadMore(view);
    else renderFeed();
  }

  document.querySelectorAll('.gallery-tab, .side-link[data-view]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      setView(btn.dataset.view);
    });
  });

  moreBtn.addEventListener('click', () => loadMore(view));

  document.querySelectorAll('.view-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      layout = btn.dataset.layout;
      document.querySelectorAll('.view-tab').forEach((b) => b.classList.toggle('is-active', b === btn));
      renderFeed();
    });
  });

  searchInput?.addEventListener('input', () => {
    searchQ = searchInput.value.trim().toLowerCase();
    renderFeed();
  });

  function openLightbox(id) {
    const idx = lbList.findIndex((f) => f.id === id);
    if (idx < 0) {
      const file = feeds[view].files.find((f) => f.id === id);
      if (file) window.open(file.url, '_blank');
      return;
    }
    current = idx;
    showLb();
    lightbox.showModal();
  }

  function showLb() {
    const file = lbList[current];
    if (!file) return;
    lbImg.src = file.url;
    lbName.textContent = file.filename;
    lbTime.textContent = formatDate(file.uploaded_at);
    lbCount.textContent = `${current + 1} / ${lbList.length}`;
    lbOpen.href = file.url;
  }

  lbPrev?.addEventListener('click', () => {
    if (!lbList.length) return;
    current = (current - 1 + lbList.length) % lbList.length;
    showLb();
  });
  lbNext?.addEventListener('click', () => {
    if (!lbList.length) return;
    current = (current + 1) % lbList.length;
    showLb();
  });

  if (ownerName) openUploadStep();
  else openOwnerForm();
  syncUserChip();
  loadMore('all').then(schedulePoll);
})();
