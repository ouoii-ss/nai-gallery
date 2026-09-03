(function () {
  'use strict';
  const ADMIN_PASS = 'nai';           // 管理口令（本地策展用，改这里即可）
  const DISCORD_CLIENT_ID = window.__DC_ID_OVERRIDE || '1545126834310488145';  // Discord 应用 APP ID（已填）；留空=不启用登录墙
  const DC_ALLOW = ['1397145912081649685'];  // 白名单：只放这些 Discord 用户 ID 进；留空=任何 Discord 账号可进
  const PAGE = 48;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => (s == null ? '' : String(s)).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const normPath = (p) => (p || '').replace(/^\//, '');   // 转相对路径，兼容子路径部署

  let ART = [], VIB = [];
  let view = 'gallery';
  const filters = { q: '', artist: '', batch: '', sort: 'new' };
  let galleryPage = 0, galleryListCache = [];
  let lbList = [], lbIdx = 0;
  const hidden = new Set(JSON.parse(localStorage.getItem('pg_hidden') || '[]'));
  let admin = localStorage.getItem('pg_admin') === '1';
  let showHidden = false;

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ============ Discord 登录墙（纯前端 PKCE，无需后端） ============
  let dcUser = (() => { try { return JSON.parse(localStorage.getItem('pg_dc') || 'null'); } catch (e) { return null; } })();

  function b64url(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function randStr(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); }
  async function pkceChallenge(verifier) {
    const d = new TextEncoder().encode(verifier);
    const h = await crypto.subtle.digest('SHA-256', d);
    return b64url(h);
  }
  function discordRedirectUri() { return location.origin + location.pathname; }

  function startDiscordLogin() {
    if (!DISCORD_CLIENT_ID) { toast('请先在 app.js 顶部填 DISCORD_CLIENT_ID'); return; }
    const verifier = randStr(32), state = randStr(16);
    // 用 localStorage（非 sessionStorage）：手机上 Discord 会跳外部 App/浏览器再跳回，sessionStorage 会丢失导致 state 不匹配
    localStorage.setItem('pg_dc_v', verifier);
    localStorage.setItem('pg_dc_s', state);
    pkceChallenge(verifier).then(challenge => {
      const p = new URLSearchParams({
        response_type: 'code', client_id: DISCORD_CLIENT_ID, scope: 'identify',
        state, redirect_uri: discordRedirectUri(), code_challenge: challenge, code_challenge_method: 'S256'
      });
      location.href = 'https://discord.com/api/oauth2/authorize?' + p.toString();
    });
  }

  async function handleDiscordCallback() {
    const url = new URL(location.href);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code) return false;
    const verifier = localStorage.getItem('pg_dc_v');
    const savedState = localStorage.getItem('pg_dc_s');
    localStorage.removeItem('pg_dc_v'); localStorage.removeItem('pg_dc_s'); // 一次性用完即清，避免旧 state 被复用
    history.replaceState({}, document.title, location.pathname); // 清掉 URL 里的 code，避免刷新重复兑换
    if (state !== savedState || !verifier) { toast('Discord 回调解码失败（state 不匹配）'); return false; }
    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri: discordRedirectUri(),
        client_id: DISCORD_CLIENT_ID, code_verifier: verifier
      });
      const r = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
      });
      if (!r.ok) { toast('Discord 换 token 失败'); return false; }
      const tok = await r.json();
      const me = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: 'Bearer ' + tok.access_token } });
      if (!me.ok) { toast('获取 Discord 资料失败'); return false; }
      const u = await me.json();
      if (DC_ALLOW.length && !DC_ALLOW.includes(u.id)) { toast('该 Discord 账号不在白名单，禁止访问'); return false; }
      dcUser = { id: u.id, name: u.global_name || u.username, username: u.username, disc: u.discriminator, avatar: u.avatar };
      localStorage.setItem('pg_dc', JSON.stringify(dcUser));
      return true;
    } catch (e) { toast('Discord 登录出错'); return false; }
  }

  function discordAvatar(u) {
    if (!u || !u.avatar) return '';
    const ext = u.avatar.startsWith('a_') ? '.gif' : '.png';
    return 'https://cdn.discordapp.com/avatars/' + u.id + '/' + u.avatar + ext;
  }
  function renderUserChip() {
    const chip = $('#userChip');
    if (!dcUser) { chip.classList.add('hidden'); return; }
    const av = discordAvatar(dcUser);
    const name = dcUser.name || dcUser.username;
    chip.innerHTML = (av ? `<img class="uc-av" src="${av}" alt="">` : `<span class="uc-av uc-noav">${esc((name || '?')[0])}</span>`) +
      `<span class="uc-name">${esc(name)}</span><button class="uc-out" id="dcOut">退出</button>`;
    chip.classList.remove('hidden');
    $('#dcOut').addEventListener('click', logoutDiscord);
  }
  function logoutDiscord() { localStorage.removeItem('pg_dc'); dcUser = null; location.reload(); }
  function showLoginWall(msg) { if (msg) $('#loginMsg').textContent = msg; $('#loginWall').classList.remove('hidden'); }
  function hideLoginWall() { $('#loginWall').classList.add('hidden'); }

  // 入口：先过 Discord 登录墙，再加载画廊
  function init() {
    $('#loginBtn').addEventListener('click', startDiscordLogin);
    if (new URL(location.href).searchParams.get('code')) {
      handleDiscordCallback().then(ok => {
        if (ok) { hideLoginWall(); renderUserChip(); load(); }
        else if (DISCORD_CLIENT_ID) showLoginWall('登录失败，请重试'); else load();
      });
      return;
    }
    if (dcUser) { hideLoginWall(); renderUserChip(); load(); return; }
    if (DISCORD_CLIENT_ID) { showLoginWall(); return; } // 已配置但没登录 → 墙
    // 没配置 Client ID：不拦，给提示，方便本地先预览（任何人可看）
    const b = document.createElement('div');
    b.className = 'dc-banner';
    b.textContent = '⚠️ 未配置 Discord Client ID：登录墙未启用（任何人可看）。在 app.js 顶部填入后即变私人画廊。';
    document.body.appendChild(b);
    load();
  }

  async function load() {
    let data = null;
    try { const r = await fetch('data/index.json', { cache: 'no-store' }); if (r.ok) data = await r.json(); } catch (e) {}
    if (!data && window.__SEED) data = window.__SEED;
    if (!data || !data.artworks) { toast('数据加载失败：请用本地服务器打开或部署后访问'); return; }
    ART = (data.artworks || []).map(a => ({ ...a, thumb: normPath(a.thumb), full: normPath(a.full) }));
    VIB = (data.vibes || []).map(v => ({ ...v, thumbnail: normPath(v.thumbnail) }));
    boot();
  }

  function boot() {
    $('#stat').textContent = `${ART.length} 张画 · ${VIB.length} 个 Vibe`;
    fillSelect($('#fArtist'), [...new Set(ART.map(a => a.artist).filter(Boolean))].sort());
    fillSelect($('#fBatch'), [...new Set(ART.map(a => a.batch).filter(Boolean))].sort());
    if (admin) $('#manageTab').style.display = '';
    wire();
    switchView('gallery');
  }

  function fillSelect(sel, items) {
    const cur = sel.value;
    sel.innerHTML = sel.id === 'fArtist' ? '<option value="">全部画师</option>' : '<option value="">全部批次</option>';
    items.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
    sel.value = cur;
  }

  function wire() {
    document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => onTab(b.dataset.view)));
    $('#search').addEventListener('input', (e) => { filters.q = e.target.value.trim().toLowerCase(); resetGallery(); });
    $('#fArtist').addEventListener('change', (e) => { filters.artist = e.target.value; resetGallery(); });
    $('#fBatch').addEventListener('change', (e) => { filters.batch = e.target.value; resetGallery(); });
    $('#fSort').addEventListener('change', (e) => { filters.sort = e.target.value; resetGallery(); });
    $('#showHidden').addEventListener('change', (e) => { showHidden = e.target.checked; resetGallery(); if (view === 'manage') renderManage(); });

    // 灯箱
    $('#lbX').addEventListener('click', closeLightbox);
    $('#lbBack').addEventListener('click', closeLightbox);
    $('#lbPrev').addEventListener('click', () => navLb(-1));
    $('#lbNext').addEventListener('click', () => navLb(1));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
    document.querySelectorAll('.copyBtn').forEach(b => b.addEventListener('click', () => copyText($('#' + b.dataset.copy).value)));
    $('#lbDlImg').addEventListener('click', downloadCurrentImage);
    $('#lbDlTxt').addEventListener('click', downloadCurrentPrompt);
    $('#lbDlVibe').addEventListener('click', downloadCurrentVibe);

    // 抽卡
    $('#draw1').addEventListener('click', () => draw(1));
    $('#draw3').addEventListener('click', () => draw(3));
    $('#drawReset').addEventListener('click', () => { $('#gacaStage').innerHTML = ''; });

    // 无限滚动
    const io = new IntersectionObserver((ents) => { if (ents[0].isIntersecting) loadMore(); }, { rootMargin: '400px' });
    io.observe($('#sentinel'));
  }

  function onTab(v) {
    if (v === 'manage') {
      if (!admin) {
        const p = prompt('管理口令（本地策展用）：');
        if (p === ADMIN_PASS) { admin = true; localStorage.setItem('pg_admin', '1'); $('#manageTab').style.display = ''; }
        else if (p !== null) { toast('口令不对'); return; }
      }
      switchView('manage'); renderManage(); return;
    }
    switchView(v);
    if (v === 'vibe') renderVibe();
  }

  function switchView(v) {
    view = v;
    document.querySelectorAll('.view').forEach(s => s.classList.add('hidden'));
    $('#view-' + (v === 'gaca' ? 'gaca' : v)).classList.remove('hidden');
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    $('#hideToggleWrap').style.display = (admin && v === 'gallery') ? '' : 'none';
    if (v === 'gallery') resetGallery();
  }

  // —— 画廊 ——
  function visibleArt() {
    return ART.filter(a => showHidden || !hidden.has(a.id));
  }
  function applyFilters() {
    let list = visibleArt();
    if (filters.artist) list = list.filter(a => a.artist === filters.artist);
    if (filters.batch) list = list.filter(a => a.batch === filters.batch);
    if (filters.q) {
      const q = filters.q;
      list = list.filter(a => {
        const hay = [a.title, a.artist, (a.tags || []).join(','), a.positive, a.negative, a.batch, a.note].join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    list.sort((a, b) => {
      if (filters.sort === 'artist') return (a.artist || '').localeCompare(b.artist || '') || (b.createdAt || 0) - (a.createdAt || 0);
      if (filters.sort === 'old') return (a.createdAt || 0) - (b.createdAt || 0);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    return list;
  }
  function resetGallery() {
    galleryPage = 0; galleryListCache = applyFilters();
    $('#grid').innerHTML = '';
    $('#empty').classList.toggle('hidden', galleryListCache.length > 0);
    loadMore();
  }
  function loadMore() {
    const list = galleryListCache;
    const slice = list.slice(galleryPage * PAGE, (galleryPage + 1) * PAGE);
    const frag = document.createDocumentFragment();
    slice.forEach(a => frag.appendChild(artCard(a)));
    $('#grid').appendChild(frag);
    galleryPage++;
    $('#sentinel').style.display = galleryPage * PAGE < list.length ? '' : 'none';
  }
  function artCard(a) {
    const d = document.createElement('div');
    d.className = 'card' + (hidden.has(a.id) ? ' hidden-mark' : '');
    d.innerHTML = `
      ${a.batch ? `<div class="c-batch">${esc(a.batch)}</div>` : ''}
      <img loading="lazy" src="${esc(a.thumb || a.full)}" alt="" onerror="this.style.background='var(--pink-3)'">
      <div class="c-body">
        <div class="c-title">${esc(a.title || '无题')}</div>
        <div class="c-artist">${esc(a.artist || '未知画师')}</div>
      </div>`;
    d.addEventListener('click', () => {
      if (admin && view === 'manage') { toggleHidden(a.id); return; }
      openLightbox(galleryListCache, galleryListCache.indexOf(a));
    });
    return d;
  }

  // —— 灯箱 ——
  function openLightbox(list, idx) {
    lbList = list; lbIdx = idx; renderLb();
    $('#lightbox').classList.remove('hidden');
  }
  function renderLb() {
    const a = lbList[lbIdx]; if (!a) return;
    $('#lbImg').src = a.full || a.thumb;
    $('#lbTitle').textContent = a.title || '无题';
    $('#lbArtist').textContent = '画师：' + (a.artist || '未知');
    $('#lbPos').value = a.positive || '';
    $('#lbNeg').value = a.negative || '';
    const tags = (a.tags || []).filter(Boolean);
    $('#lbTags').innerHTML = tags.length ? tags.map(t => `<span class="t">#${esc(t)}</span>`).join('') : '';
    $('#lbDlVibe').style.display = (a && a.raw) ? '' : 'none';
  }
  function navLb(d) { lbIdx = (lbIdx + d + lbList.length) % lbList.length; renderLb(); }
  function closeLightbox() { $('#lightbox').classList.add('hidden'); }

  function copyText(t) {
    if (!t) return;
    const done = () => toast('已复制 ✓');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done).catch(() => fallbackCopy(t, done));
    else fallbackCopy(t, done);
  }
  function fallbackCopy(t, done) {
    const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败'); }
    document.body.removeChild(ta);
  }
  function safeName(s) { return (s || 'nai').replace(/[^\w.\-一-鿿＀-￯]/g, '_'); }
  async function downloadCurrentImage() {
    const src = $('#lbImg').src;
    if (!src) return;
    const name = safeName($('#lbTitle').textContent) + '.png';
    try {
      const r = await fetch(src); if (!r.ok) throw new Error('fetch ' + r.status);
      const b = await r.blob(); const u = URL.createObjectURL(b);
      const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(u); toast('已开始下载图片');
    } catch (e) { toast('下载图片失败（跨域或网络问题）'); }
  }
  function downloadCurrentPrompt() {
    const p = $('#lbPos').value || '', n = $('#lbNeg').value || '';
    const txt = 'Title: ' + ($('#lbTitle').textContent || '') + '\nArtist: ' + ($('#lbArtist').textContent || '') +
      '\n\nPositive:\n' + p + '\n\nNegative:\n' + n + '\n';
    const b = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const u = URL.createObjectURL(b);
    const a = document.createElement('a'); a.href = u; a.download = safeName($('#lbTitle').textContent) + '.txt';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u); toast('已下载提示词 ✓');
  }
  // 下载 Vibe 原文件：按真实格式命名（单个 .naiv4vibe / 打包 .naiv4vibebundle），内容来自 vibes-raw/<id>.json
  async function downloadCurrentVibe() {
    const a = lbList[lbIdx]; if (!a || !a.raw) return;
    try {
      const r = await fetch(a.raw); if (!r.ok) throw new Error('fetch ' + r.status);
      const text = await r.text();
      // 由内容 identifier 判定真实格式：bundle → .naiv4vibebundle，否则 .naiv4vibe
      let ext = '.naiv4vibe';
      try { const j = JSON.parse(text); if (j && j.identifier === 'novelai-vibe-bundle') ext = '.naiv4vibebundle'; } catch (_) {}
      const orig = a.originalFilename || '';
      let name;
      if (/\.naiv4vibebundle$/i.test(orig)) name = safeName(orig);
      else if (/\.naiv4vibe$/i.test(orig)) name = safeName(orig);
      else {
        // 无后缀或带 .json 的（如「折枝.naiv4vibe.json」）：去掉已知后缀后按内容补正确扩展名
        const base = orig.replace(/(\.naiv4vibe|\.naiv4vibebundle|\.json)+$/i, '') || (a.title || 'vibe');
        name = safeName(base + ext);
      }
      const b = new Blob([text], { type: 'application/json;charset=utf-8' });
      const u = URL.createObjectURL(b);
      const link = document.createElement('a'); link.href = u; link.download = name; document.body.appendChild(link); link.click(); link.remove();
      URL.revokeObjectURL(u); toast('已下载 Vibe 原文件 ✓');
    } catch (e) { toast('下载 Vibe 失败（网络/跨域）'); }
  }

  // —— 抽卡 / 塔罗 ——
  function draw(n) {
    const pool = visibleArt();
    if (!pool.length) { toast('没有可抽的画'); return; }
    const stage = $('#gacaStage'); stage.innerHTML = '';
    const picks = [];
    const copy = pool.slice();
    for (let i = 0; i < n; i++) { if (!copy.length) break; const k = Math.floor(Math.random() * copy.length); picks.push(copy.splice(k, 1)[0]); }
    picks.forEach((a, i) => {
      const flip = document.createElement('div');
      flip.className = 'flip';
      flip.innerHTML = `
        <div class="flip-inner">
          <div class="flip-face flip-back"><div>🔮</div><div class="hint">点我翻牌</div></div>
          <div class="flip-face flip-front">
            <img src="${esc(a.thumb || a.full)}" alt="" onerror="this.style.background='var(--pink-3)'">
            <div class="f-cap">${esc(a.title || '无题')}</div>
            <div class="f-art">${esc(a.artist || '未知画师')}</div>
          </div>
        </div>`;
      flip.addEventListener('click', () => flip.classList.toggle('flipped'));
      stage.appendChild(flip);
      setTimeout(() => flip.classList.add('flipped'), 350 + i * 250);
    });
  }

  // —— Vibe 专区 ——
  function renderVibe() {
    const grid = $('#vibeGrid'); grid.innerHTML = '';
    if (!VIB.length) { grid.innerHTML = '<p class="muted">还没有 Vibe</p>'; return; }
    VIB.forEach(v => {
      const d = document.createElement('div');
      d.className = 'card vibe-card';
      const img = v.thumbnail || '';
      d.innerHTML = `
        ${img ? `<img loading="lazy" src="${esc(img)}" alt="" onerror="this.style.background='var(--pink-3)';this.remove()">` : `<img src="" alt="" style="background:var(--pink-3)">`}
        <div class="c-body">
          <div class="c-title">${esc(v.name || 'Vibe')}</div>
          <div class="c-artist">${esc(v.artist || (v.tags || []).join(' ') || '')}</div>
          <div class="c-note">${esc(v.note || (v.positive || '').slice(0, 60) || '')}</div>
        </div>`;
      d.addEventListener('click', () => openVibe(v));
      grid.appendChild(d);
    });
  }
  function openVibe(v) {
    const a = { id: v.id, title: v.name, artist: v.artist || '', positive: v.positive || '', negative: v.negative || '', tags: v.tags || [], thumb: v.thumbnail, full: v.thumbnail, batch: v.batch || '', raw: v.raw ? normPath(v.raw) : '', originalFilename: v.originalFilename || '' };
    lbList = [a]; lbIdx = 0; renderLb(); $('#lightbox').classList.remove('hidden');
  }

  // —— 管理（本地策展：隐藏/取消隐藏）——
  function toggleHidden(id) {
    if (hidden.has(id)) hidden.delete(id); else hidden.add(id);
    localStorage.setItem('pg_hidden', JSON.stringify([...hidden]));
    renderManage();
    if (view === 'gallery') resetGallery();
    toast(hidden.has(id) ? '已隐藏（仅本机）' : '已取消隐藏');
  }
  function renderManage() {
    const grid = $('#gridManage'); grid.innerHTML = '';
    const list = showHidden ? ART : ART.filter(a => !hidden.has(a.id));
    const hiddenCount = hidden.size;
    $('#manageHint').textContent = `当前已隐藏 ${hiddenCount} 张（仅本机浏览器，公开访客看不到）。点图切换隐藏状态。`;
    list.forEach(a => grid.appendChild(artCard(a)));
    $('#empty').classList.add('hidden');
  }

  init();
})();
