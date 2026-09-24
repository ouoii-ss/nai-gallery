(function () {
  'use strict';
  const DISCORD_CLIENT_ID = window.__DC_ID_OVERRIDE || '1545126834310488145';  // Discord 应用 APP ID（已填）；留空=不启用登录墙
  const DC_ALLOW = ['1397145912081649685'];  // 白名单：只放这些 Discord 用户 ID 进；留空=任何 Discord 账号可进
  const PAGE = 24;
  const APP_VER = '20260924p8';
  console.log('[NAI 公开画廊] app 版本', APP_VER, '| 莫兰迪磨砂风 · 侧栏分类折叠子列表（与私有画廊同款） · 负向提示词搜索');
  const $ = (s) => document.querySelector(s);
  const esc = (s) => (s == null ? '' : String(s)).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const normPath = (p) => (p || '').replace(/^\//, '');   // 转相对路径，兼容子路径部署

  // —— 图片加载失败兜底：别让浏览器的破图图标看起来像「图被删了」——
  // 换成能看懂的提示图 + 点击重试（网络抖动、首次部署 CDN 还没就绪，都能这样救回来）
  const IMG_FAIL_SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">' +
    '<rect width="100%" height="100%" fill="#f7eef1"/>' +
    '<text x="50%" y="45%" font-family="sans-serif" font-size="15" fill="#b08b95" text-anchor="middle">图片没加载出来</text>' +
    '<text x="50%" y="54%" font-family="sans-serif" font-size="12" fill="#b08b95" text-anchor="middle">点一下重试</text>' +
    '<text x="50%" y="63%" font-family="sans-serif" font-size="11" fill="#c0a3ab" text-anchor="middle">网络慢时多等一会儿也会出来</text>' +
    '</svg>'
  );
  window.__imgFail = function (img) {
    if (!img || img.dataset.failed === '1') return;
    const real = img.getAttribute('src') || '';
    if (!real || real.indexOf('data:') === 0) { img.style.background = '#e9e6e1'; return; }
    img.dataset.failed = '1';
    img.dataset.real = real;
    img.src = IMG_FAIL_SVG;
    img.classList.add('img-broken');
  };
  window.__imgRetry = function (img) {
    let real = (img && img.dataset.real) || '';
    if (!real) return;
    real = real.replace(/[?&]_r=\d+/g, '');   // 别让重试参数越堆越多
    delete img.dataset.failed;
    img.classList.remove('img-broken');
    img.src = real + (real.indexOf('?') >= 0 ? '&' : '?') + '_r=' + Date.now();
  };
  // 点提示图 = 重试（带时间戳绕过缓存）；点图片以外的地方行为不变
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    const img = t && t.closest ? t.closest('img[data-failed="1"]') : null;
    if (!img) return;
    ev.preventDefault(); ev.stopPropagation();
    window.__imgRetry(img);
  }, true);

  // 画师词 / 提示词 的唯一判定：正面提示词里有没有画师标记
  // ① 显式 artist 关键字（V4 及以前）：artist: xxx / n::artist xxx::
  // ② V5 新格式：正面提示词开头就是权重条目 n::名字::（画师串习惯放最前面）
  // ③ 画师串藏在中间：V5 条目命中已知画师名库（与主站 n15 同口径）
  // —— 不读 artwork.artist 字段，绝不改写用户数据。
  const ARTISTLIKE_STOP = new Set([
    'masterpiece', 'best quality', 'amazing quality', 'good quality', 'normal quality', 'high quality', 'low quality',
    'very aesthetic', 'aesthetic', 'absurdres', 'highres', 'no text', 'official art', 'recent', 'newest',
    'chibi', 'chibi only', 'flat color', 'simple background', 'highly detailed', 'sharp focus',
    'light skin', 'pale skin', 'looking at viewer', 'depth of field', 'blushing', 'cowboy shot',
    'low saturation', 'low angle', 'white dragon', 'oriental dragon', 'wet hair', 'year 2024', 'year 2025',
    'year2024', 'year2025',
  ]);
  function looksLikeArtistName(inner) {
    const s = String(inner || '').trim();
    if (!s || s.length > 60) return false;
    if (/[,，\n]/.test(s)) return false;            // 含逗号 = 一串描述标签，不是画师
    if (ARTISTLIKE_STOP.has(s.toLowerCase())) return false;
    // 名字字符集：字母/数字/下划线/空格/括号/点/横线/撇号（如 jiemo_tuoxie、izumi 087、rizu (rizunm)）
    return /^[A-Za-z0-9_ ()\-.'\u2019]+$/.test(s);
  }
  // 画师名库：从全库提取（artist: 后的名字 / V5 开头条目 / artistChain 字段），最多 2 个词
  let _artistVocab = new Set();
  function rebuildArtistVocab() {
    _artistVocab = new Set();
    const isName = (t) => looksLikeArtistName(t) && t.split(/\s+/).filter(w => !/^\(?\d+\)?$/.test(w)).length <= 2;
    for (const a of ART) {
      const s = String(a.positive || '');
      let m; const reKw = /\bartist\s*[:：=]\s*([a-z0-9_ .\-]{2,50}?)(?=[,，\n]|::|$)/gi;
      while ((m = reKw.exec(s)) !== null) { const t = m[1].trim().toLowerCase(); if (isName(t)) _artistVocab.add(t); }
      const first = s.match(/^\s*-?\d+(?:\.\d+)?\s*::\s*([^:\n]+?)\s*::/);
      if (first && isName(first[1].trim().toLowerCase())) _artistVocab.add(first[1].trim().toLowerCase());
      for (const seg of String(a.artistChain || '').split(/[,\n]/)) {
        const t = seg.replace(/^[\s\d.]*::/, '').replace(/::\s*$/, '').trim().toLowerCase();
        if (t && isName(t)) _artistVocab.add(t);
      }
    }
  }
  function hasArtistMarker(p) {
    const s = String(p || '');
    if (/(?:\d*\.?\d*\s*::\s*artist)|(?:\bartist\s*[:：=])/i.test(s)) return true;
    const m = s.match(/^\s*-?\d+(?:\.\d+)?\s*::\s*([^:\n]+?)\s*::/);
    if (m && looksLikeArtistName(m[1])) return true;
    if (!_artistVocab.size) rebuildArtistVocab();
    const re = /-?\d+(?:\.\d+)?\s*::\s*([^:\n]+?)\s*::/g;
    let mm;
    while ((mm = re.exec(s)) !== null) {
      const t = mm[1].trim().toLowerCase();
      if (t && _artistVocab.has(t)) return true;
    }
    return false;
  }

  let ART = [], VIB = [];
  let view = 'gallery';
  const filters = { q: '', artist: '', promptArtist: '', batch: '', sort: 'new', cat: '' };  // cat: '' | 'streams'(画师词) | 'prompts'(提示词)；artist=画师词内钻取，promptArtist=提示词内按画师分组钻取
  let streamsOpen = false;   // 侧栏「画师词」子列表是否展开（与私有画廊同款）
  let promptsOpen = false;   // 侧栏「提示词」子列表是否展开

  let galleryPage = 0, galleryListCache = [];
  let lbList = [], lbIdx = 0;

  // 提示词搜索（整段粘贴权重串时启用）：只找词集合完全相等的（正/负向都查）
  let searchModeIsPrompt = false;   // 当前是否处于提示词搜索模式
  let searchSimMap = null;          // Map<artworkId, 'exact' | 'exact-neg'>，命中卡片显示角标

  // 去掉 NAI 加权括号语法：W::内容::  -> 内容（忽略权重数值差异）
  function stripPromptWeights(s) {
    if (!s) return '';
    return String(s)
      .replace(/-?\d*\.?\d+\s*::\s*([\s\S]*?)\s*::/g, '$1')
      .replace(/::\s*([\s\S]*?)\s*::/g, '$1');
  }
  // 提示词归一化：去权重 + 小写 + 逗号/空白/全角标点统一为逗号
  function normPrompt(s) {
    if (!s) return '';
    return stripPromptWeights(s)
      .toLowerCase()
      .replace(/[\s,，、;；]+/g, ',')
      .replace(/^,+/, '')
      .replace(/,+$/, '');
  }
  // 把归一化串拆成词袋（集合，去重，去单字噪声）
  function bagOf(normStr) {
    const m = new Map();
    if (!normStr) return m;
    normStr.split(',').forEach(tok => {
      tok = tok.trim();
      if (tok.length < 2) return;
      m.set(tok, 1);
    });
    return m;
  }
  // 判断用户是不是整段粘贴了提示词（而非普通关键词）
  function isPromptQuery(raw) {
    const q = (raw || '').trim();
    if (q.length < 60) return false;
    if (/::/.test(q)) return true;                         // NAI 加权串 0.6::artist x::
    const toks = q.split(/[,\n]+/).map(t => t.trim()).filter(Boolean);
    if (toks.length >= 10) return true;                   // 一长串标签词
    return false;
  }

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

  // 垃圾标签黑名单：vibe 强度数值被老迁移代码误写成标签 + 历史测试残留（与私有画廊同款，build_public 重新打包也不会再带回来）
  const _PG_JUNK_TAGS = new Set(['5', '4.5', '测试标签XYZ', '新增测试07477']);
  function _pgHealTags(list) {
    for (const a of list) {
      if (Array.isArray(a.tags) && a.tags.length) {
        const keep = a.tags.filter(t => !_PG_JUNK_TAGS.has(String(t).trim()));
        if (keep.length !== a.tags.length) a.tags = keep;
      }
    }
    return list;
  }

  async function load() {
    let data = null;
    try { const r = await fetch('data/index.json', { cache: 'no-store' }); if (r.ok) data = await r.json(); } catch (e) {}
    if (!data && window.__SEED) data = window.__SEED;
    if (!data || !data.artworks) { toast('数据加载失败：请用本地服务器打开或部署后访问'); return; }
    _pgHealTags(data.artworks);   // 垃圾标签自愈：加载即剥（防旧快照 / 重新打包写回）
    ART = (data.artworks || []).map(a => ({ ...a, thumb: normPath(a.thumb), full: normPath(a.full) }));
    VIB = (data.vibes || []).map(v => ({ ...v, thumbnail: normPath(v.thumbnail) }));
    boot();
  }

  function boot() {
    $('#stat').textContent = `${ART.length} 张画 · ${VIB.length} 个 Vibe`;
    const _hm = $('#heroMeta');
    if (_hm) _hm.textContent = `${ART.length} 画作 · ${VIB.length} Vibe`;
    // 画师下拉已移除（改为侧栏「画师词 → 按画师钻取」），这里无条件跳过；保留 guard 以防回退
    const fArtistEl = $('#fArtist');
    if (fArtistEl) fillSelect(fArtistEl, [...new Set(ART.map(a => a.artist).filter(Boolean))].sort());
    fillSelect($('#fBatch'), [...new Set(ART.map(a => a.batch).filter(Boolean))].sort());
    updateSidebarCats();   // 侧栏画师词 / 提示词 计数
    renderStreamsNav();   // 画师词子列表（折叠，点箭头展开）
    renderPromptsNav();   // 提示词子列表（折叠，点箭头展开）
    restoreUIState();
    wire();
    switchView('gallery');
  }

  // 恢复侧栏钉住 + 日/夜模式（持久化到 localStorage）
  function restoreUIState() {
    const pinned = localStorage.getItem('pg_sidebar_pinned') === '1';
    const sb = document.querySelector('.sidebar');
    if (sb && pinned) sb.classList.add('pinned');
    const pin = $('#sidebarPin');
    if (pin) pin.classList.toggle('on', pinned);

    const night = localStorage.getItem('pg_theme') === 'night';
    if (night) document.documentElement.classList.add('theme-night');
    const tt = $('#themeToggle .theme-text');
    if (tt) tt.textContent = night ? '夜间' : '日间';
  }

  function setSidebarPinned(p) {
    const sb = document.querySelector('.sidebar');
    if (sb) sb.classList.toggle('pinned', p);
    const pin = $('#sidebarPin');
    if (pin) pin.classList.toggle('on', p);
    localStorage.setItem('pg_sidebar_pinned', p ? '1' : '0');
  }
  function toggleTheme() {
    const html = document.documentElement;
    const night = !html.classList.contains('theme-night');
    html.classList.toggle('theme-night', night);
    const tt = $('#themeToggle .theme-text');
    if (tt) tt.textContent = night ? '夜间' : '日间';
    localStorage.setItem('pg_theme', night ? 'night' : 'day');
  }
  function openMobileDrawer() {
    const sb = document.querySelector('.sidebar'); if (sb) sb.classList.add('open');
    const bd = $('#navBackdrop'); if (bd) bd.classList.add('show');
  }
  function closeMobileDrawer() {
    const sb = document.querySelector('.sidebar'); if (sb) sb.classList.remove('open');
    const bd = $('#navBackdrop'); if (bd) bd.classList.remove('show');
  }

  function fillSelect(sel, items) {
    const cur = sel.value;
    sel.innerHTML = sel.id === 'fArtist' ? '<option value="">全部画师</option>' : '<option value="">全部批次</option>';
    items.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
    sel.value = cur;
  }

  function wire() {
    document.querySelectorAll('.top-pill, .nav-link').forEach(b => b.addEventListener('click', () => { if (!b.dataset || !b.dataset.view) return; closeMobileDrawer(); onTab(b.dataset.view); }));
    const _pin = $('#sidebarPin'); if (_pin) _pin.addEventListener('click', () => setSidebarPinned(!document.querySelector('.sidebar').classList.contains('pinned')));
    const _tt = $('#themeToggle'); if (_tt) _tt.addEventListener('click', toggleTheme);
    const _nt = $('#navToggle'); if (_nt) _nt.addEventListener('click', openMobileDrawer);
    const _bd = $('#navBackdrop'); if (_bd) _bd.addEventListener('click', closeMobileDrawer);
    $('#search').addEventListener('input', (e) => { filters.q = e.target.value.trim().toLowerCase(); resetGallery(); });
    const fArtistEl2 = $('#fArtist');
    if (fArtistEl2) fArtistEl2.addEventListener('change', (e) => { filters.artist = e.target.value; resetGallery(); });
    $('#fBatch').addEventListener('change', (e) => { filters.batch = e.target.value; resetGallery(); });
    $('#fSort').addEventListener('change', (e) => { filters.sort = e.target.value; resetGallery(); });
    // 侧栏分类：画师词 / 提示词（点按钮切过滤；点箭头只展开/收起子列表）
    const _sb = $('#streamsBtn'); if (_sb) _sb.addEventListener('click', () => toggleCat('streams'));
    const _pb = $('#promptsBtn'); if (_pb) _pb.addEventListener('click', () => toggleCat('prompts'));
    const _sc = $('#streamsCaret'); if (_sc) _sc.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); streamsOpen = !streamsOpen; updateSidebarCats(); });
    const _pc2 = $('#promptsCaret'); if (_pc2) _pc2.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); promptsOpen = !promptsOpen; updateSidebarCats(); });

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
  }

  function onTab(v) {
    switchView(v);
    if (v === 'vibe') renderVibe();
  }

  function switchView(v) {
    view = v;
    document.querySelectorAll('.view').forEach(s => s.classList.add('hidden'));
    $('#view-' + (v === 'gaca' ? 'gaca' : v)).classList.remove('hidden');
    syncNav(v);
    if (v === 'gallery') resetGallery();
  }

  // 顶部胶囊 + 侧栏圆形图标同步 active（单一来源：当前 view）
  function syncNav(v) {
    document.querySelectorAll('.top-pill, .nav-link').forEach(b => {
      b.classList.toggle('active', b.dataset.view === v);
    });
  }

  // —— 画廊 ——
  function visibleArt() {
    return ART;
  }
  function applyFilters() {
    if (!filters.q) { searchModeIsPrompt = false; searchSimMap = null; }  // 清空搜索时复位提示词模式
    let list = visibleArt();
    if (filters.artist) list = list.filter(a => a.artist === filters.artist);
    if (filters.batch) list = list.filter(a => a.batch === filters.batch);
    // 侧栏分类：画师词=正面提示词含 artist: 标记；提示词=不含
    if (filters.cat === 'streams') list = list.filter(a => hasArtistMarker(a.positive));
    else if (filters.cat === 'prompts') list = list.filter(a => !hasArtistMarker(a.positive));
    // 子列表钻取：画师词内按画师 / 提示词内按画师分组
    if (filters.cat === 'streams' && filters.artist) list = list.filter(a => (a.artist || '').trim() === filters.artist);
    if (filters.cat === 'prompts' && filters.promptArtist) list = list.filter(a => (a.artist || '').trim() === filters.promptArtist);
    if (filters.q) {
      const qRaw = filters.q;   // 已 .toLowerCase().trim()
      if (isPromptQuery(qRaw)) {
        // 提示词搜索：只找词集合完全相等的（权重/顺序/空格/全角逗号已被 normPrompt 抹平），正/负向都查
        searchModeIsPrompt = true;
        const qBag = bagOf(normPrompt(qRaw));
        const _bagEq = (bag, ref) => { if (bag.size !== ref.size) return false; for (const k of ref.keys()) if (!bag.has(k)) return false; return true; };
        const kindMap = new Map();   // id -> 'exact' | 'exact-neg'
        const out = [];
        for (const a of list) {
          if (_bagEq(bagOf(normPrompt(a.positive)), qBag)) { kindMap.set(a.id, 'exact'); out.push(a); continue; }
          if (_bagEq(bagOf(normPrompt(a.negative)), qBag)) { kindMap.set(a.id, 'exact-neg'); out.push(a); }
        }
        list = out;
        searchSimMap = out.length ? kindMap : null;
      } else {
        searchModeIsPrompt = false;
        searchSimMap = null;
        list = list.filter(a => {
          const hay = [a.title, a.artist, (a.tags || []).join(','), a.positive, a.negative, a.batch, a.note].join(' ').toLowerCase();
          return hay.includes(qRaw);
        });
      }
    }
    list.sort((a, b) => {
      if (filters.sort === 'artist') return (a.artist || '').localeCompare(b.artist || '') || (b.createdAt || 0) - (a.createdAt || 0);
      if (filters.sort === 'old') return (a.createdAt || 0) - (b.createdAt || 0);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    return list;
  }
  // 侧栏画师词 / 提示词 分类：切换过滤 + 刷新计数与高亮（与私有画廊同款交互）
  function toggleCat(c) {
    filters.cat = (filters.cat === c) ? '' : c;
    if (filters.cat !== 'streams') filters.artist = '';        // 离开画师词时清掉画师筛选，避免卡在隐藏状态
    if (filters.cat !== 'prompts') filters.promptArtist = '';  // 离开提示词时清掉画师分组筛选
    if (view !== 'gallery') switchView('gallery');   // 切到画廊并自动 resetGallery
    else resetGallery();
    updateSidebarCats();
    renderStreamsNav();
    renderPromptsNav();
  }
  function updateSidebarCats() {
    let streamsN = 0;
    for (const a of ART) if (hasArtistMarker(a.positive)) streamsN++;
    const promptsN = ART.length - streamsN;
    const sc = $('#streamsCount'), pc = $('#promptsCount');
    if (sc) sc.textContent = streamsN;
    if (pc) pc.textContent = promptsN;
    const sb = $('#streamsBtn'), pb = $('#promptsBtn');
    if (sb) sb.classList.toggle('active', filters.cat === 'streams');
    if (pb) pb.classList.toggle('active', filters.cat === 'prompts');
    const scaret = $('#streamsCaret'); if (scaret) scaret.textContent = streamsOpen ? '▾' : '▸';
    const pcaret = $('#promptsCaret'); if (pcaret) pcaret.textContent = promptsOpen ? '▾' : '▸';
    renderStreamsNav(); renderPromptsNav();   // 同步子列表折叠态 + 内容（与私有画廊一致）
  }
  // 画师词子分类：按画师列出（圆点 + 名称 + 计数，与私有画廊同款），点画师名只看该画师
  function renderStreamsNav() {
    const wrap = $('#streamsSeriesWrap'); if (!wrap) return;
    wrap.classList.toggle('collapsed', !streamsOpen);
    const items = $('#streamsSeriesItems'); if (!items) return;
    const map = new Map(); let uncat = 0;
    for (const a of ART) {
      if (!hasArtistMarker(a.positive)) continue;
      const n = (a.artist || '').trim();
      if (n) map.set(n, (map.get(n) || 0) + 1); else uncat++;
    }
    const names = [...map.keys()].sort((x, y) => x.localeCompare(y, 'zh'));
    const row = (key, label, n, active) =>
      `<button type="button" class="series-nav ${active ? 'active' : ''}" data-streams-artist="${esc(key)}">
         <span class="series-dot"></span><span class="series-name">${esc(label)}</span><span class="series-cnt">${n}</span>
       </button>`;
    let html = '';
    for (const s of names) html += row(s, s, map.get(s), filters.cat === 'streams' && filters.artist === s);
    if (uncat) html += row('', '未署名', uncat, filters.cat === 'streams' && filters.artist === '');
    items.innerHTML = html || '<div class="series-empty">画师词还没有画作</div>';
    items.querySelectorAll('[data-streams-artist]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.streamsArtist;
      const wasActive = filters.cat === 'streams' && filters.artist === k;
      filters.cat = 'streams';
      filters.artist = wasActive ? '' : k;
      streamsOpen = true;
      if (view !== 'gallery') switchView('gallery'); else resetGallery();
      updateSidebarCats(); renderStreamsNav();
    }));
  }
  // 提示词子分类：按画师名字自动分组（与画师词同款样式），点画师名只看该画师的无标记画作
  function renderPromptsNav() {
    const wrap = $('#promptsSeriesWrap'); if (!wrap) return;
    wrap.classList.toggle('collapsed', !promptsOpen);
    const items = $('#promptsSeriesItems'); if (!items) return;
    const map = new Map(); let noArtist = 0;
    for (const a of ART) {
      if (hasArtistMarker(a.positive)) continue;
      const n = (a.artist || '').trim();
      if (n) map.set(n, (map.get(n) || 0) + 1); else noArtist++;
    }
    const names = [...map.keys()].sort((x, y) => x.localeCompare(y, 'zh'));
    const row = (key, label, n, active) =>
      `<button type="button" class="series-nav ${active ? 'active' : ''}" data-prompt-artist="${esc(key)}">
         <span class="series-dot"></span><span class="series-name">${esc(label)}</span><span class="series-cnt">${n}</span>
       </button>`;
    let html = '';
    for (const s of names) html += row(s, s, map.get(s), filters.cat === 'prompts' && filters.promptArtist === s);
    if (noArtist) html += row('', '未署名', noArtist, filters.cat === 'prompts' && filters.promptArtist === '');
    items.innerHTML = html || '<div class="series-empty">提示词还没有画作</div>';
    items.querySelectorAll('[data-prompt-artist]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.promptArtist;
      const wasActive = filters.cat === 'prompts' && filters.promptArtist === k;
      filters.cat = 'prompts';
      filters.promptArtist = wasActive ? '' : k;
      promptsOpen = true;
      if (view !== 'gallery') switchView('gallery'); else resetGallery();
      updateSidebarCats(); renderPromptsNav();
    }));
  }
  // 搜索信息条：提示词搜索时如实显示正向/负向完全一致张数
  function updateSearchInfo() {
    const el = $('#searchInfo'); if (!el) return;
    if (searchModeIsPrompt && searchSimMap) {
      let pos = 0, neg = 0;
      searchSimMap.forEach(k => { if (k === 'exact-neg') neg++; else pos++; });
      const parts = [];
      if (pos) parts.push(`<b>${pos}</b> 张正向完全一致`);
      if (neg) parts.push(`<b>${neg}</b> 张负向完全一致`);
      el.innerHTML = '提示词词集合完全相等：' + parts.join(' · ');
      el.classList.remove('hidden');
    } else if (searchModeIsPrompt && !searchSimMap) {
      el.textContent = '没有提示词词集合完全相等的画作（可能多了/少了词，或有错别字）';
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }
  function resetGallery() {
    galleryPage = 0; galleryListCache = applyFilters();
    renderPage(); renderPager(); updateSearchInfo();
  }
  // 渲染当前页（每页 PAGE 张），不再无限滚动
  function renderPage() {
    const list = galleryListCache;
    const slice = list.slice(galleryPage * PAGE, (galleryPage + 1) * PAGE);
    const frag = document.createDocumentFragment();
    slice.forEach(a => frag.appendChild(artCard(a)));
    const grid = $('#grid');
    grid.innerHTML = ''; grid.appendChild(frag);
    $('#empty').classList.toggle('hidden', list.length > 0);
  }
  // 翻页控件：上一页 / 页码窗口 / 下一页 + 计数
  function renderPager() {
    const pager = $('#pager'); if (!pager) return;
    const total = galleryListCache.length;
    const pages = Math.max(1, Math.ceil(total / PAGE));
    const cur = galleryPage;
    if (pages <= 1) { pager.innerHTML = ''; return; }
    let html = `<button class="pg${cur <= 0 ? ' disabled' : ''}" data-pg="${cur - 1}">‹ 上一页</button>`;
    const win = 2; const nums = [];
    for (let i = 0; i < pages; i++) if (i === 0 || i === pages - 1 || Math.abs(i - cur) <= win) nums.push(i);
    let last = -1;
    for (const i of nums) {
      if (i - last > 1) html += `<span class="pg-gap">…</span>`;
      html += `<button class="pg num${i === cur ? ' active' : ''}" data-pg="${i}">${i + 1}</button>`;
      last = i;
    }
    html += `<button class="pg${cur >= pages - 1 ? ' disabled' : ''}" data-pg="${cur + 1}">下一页 ›</button>`;
    html += `<span class="pg-info">${total} 张 · 第 ${cur + 1}/${pages} 页</span>`;
    html += `<span class="pg-jump">跳至 <input id="pgJump" class="pg-input" type="number" min="1" max="${pages}" value="${cur + 1}"> 页 <button class="pg-jump-btn" id="pgJumpBtn">前往</button></span>`;
    pager.innerHTML = html;
    pager.querySelectorAll('.pg[data-pg]').forEach(b => b.addEventListener('click', () => {
      const p = +b.dataset.pg; if (p < 0 || p >= pages) return; navPage(p);
    }));
    const jump = () => {
      const v = parseInt($('#pgJump').value, 10);
      if (isNaN(v) || v < 1 || v > pages) { toast('请输入 1 ~ ' + pages + ' 之间的页码'); return; }
      navPage(v - 1);
    };
    $('#pgJumpBtn').addEventListener('click', jump);
    $('#pgJump').addEventListener('keydown', (e) => { if (e.key === 'Enter') jump(); });
  }
  function navPage(p) {
    const pages = Math.max(1, Math.ceil(galleryListCache.length / PAGE));
    galleryPage = Math.max(0, Math.min(p, pages - 1));
    renderPage(); renderPager();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function artCard(a) {
    const d = document.createElement('div');
    d.className = 'card';
    // 提示词搜索角标：命中的就是完全一致（正向绿 / 负向紫蓝）
    let simBadge = '';
    if (searchModeIsPrompt && searchSimMap && searchSimMap.has(a.id)) {
      const kind = searchSimMap.get(a.id);
      simBadge = kind === 'exact-neg'
        ? `<span class="sim-badge exact-neg" title="负向提示词词集合与粘贴内容完全相同（权重数值/顺序/空格差异已忽略）">负向完全一致</span>`
        : `<span class="sim-badge exact" title="提示词词集合与粘贴内容完全相同（权重数值/顺序/空格差异已忽略）">完全一致</span>`;
    }
    d.innerHTML = `
      <div class="c-img-wrap">
        ${a.batch ? `<div class="c-batch">${esc(a.batch)}</div>` : ''}
        <img loading="lazy" src="${esc(a.thumb || a.full)}" alt="" onerror="window.__imgFail(this)">
        ${simBadge}
      </div>
      <div class="c-body">
        <div class="c-title">${esc(a.title || '无题')}</div>
        <div class="c-artist">${esc(a.artist || '未知画师')}</div>
      </div>`;
    d.addEventListener('click', () => {
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
    const lb = $('#lbImg');
    // 原图缺失/太大拉不动时自动退回缩略图，再不行才显示提示图（而不是浏览器的破图图标）
    delete lb.dataset.failed; lb.dataset.tried = ''; lb.classList.remove('img-broken');
    lb.onerror = function () {
      const thumb = a.thumb || '';
      if (thumb && lb.getAttribute('src') !== thumb && lb.dataset.tried !== '1') {
        lb.dataset.tried = '1'; lb.src = thumb; return;
      }
      if (!lb.dataset.real) lb.dataset.real = thumb || lb.getAttribute('src') || '';
      window.__imgFail(lb);
    };
    lb.src = a.full || a.thumb;
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
  // 下载 Vibe 原文件：文件名原样还原（导入啥样导出啥样），内容来自 a.raw
  async function downloadCurrentVibe() {
    const a = lbList[lbIdx]; if (!a || !a.raw) return;
    try {
      const r = await fetch(a.raw); if (!r.ok) throw new Error('fetch ' + r.status);
      const text = await r.text();
      // 由内容 identifier 判定标准格式（bundle vs 单 vibe），仅在原文件名无标准扩展名时兜底
      let ext = '.naiv4vibe';
      try { const j = JSON.parse(text); if (j && j.identifier === 'novelai-vibe-bundle') ext = '.naiv4vibebundle'; } catch (_) {}
      const orig = a.originalFilename || '';
      let name;
      if (orig) {
        // bundle 文件名套到单个 vibe 上 NAI 打不开 → 降级为 NAI 名 + 标准单文件扩展名
        if (/\.naiv4vibebundle/i.test(orig)) name = safeName(a.title || 'vibe') + '.naiv4vibe';
        else name = orig;   // 原样：导入叫 xxx.json，下载就叫 xxx.json
      } else {
        name = safeName(a.title || 'vibe') + ext;   // 无原始文件名（粘贴/手工）兜底
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
            <img src="${esc(a.thumb || a.full)}" alt="" onerror="window.__imgFail(this)">
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
        <div class="c-img-wrap">
          ${img ? `<img loading="lazy" src="${esc(img)}" alt="" onerror="window.__imgFail(this)">` : `<img src="" alt="" style="background:#e9e6e1">`}
        </div>
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

  init();
})();
