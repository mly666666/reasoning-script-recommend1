// ===== State =====
const RENDER_LIMIT = 150; // max items rendered at once
const state = {
  items: loadItems(),
  selectedId: null,
  fixing: false,        // batch fix running
  fixPaused: false,     // batch fix paused
  fixQueue: [],         // remaining scriptIds
  fixTotal: 0,
  fixDone: 0,
  fixFailed: 0,
  publicDataMode: false,
};

// ===== DOM Elements =====
const el = {};
function bindEls() {
  const ids = [
    'links','fetchBtn','enrichSelectedBtn','resetHarBtn','sourceBtn',
    'reasoningOnly','status','search','sourceFilter','tagFilter','yearFilter',
    'sortBy','scriptList','exportXls','exportMd','exportJson','clearAll',
    'fixAllBtn','fixVisibleBtn','pauseFixBtn','fixProgress','progressFill',
    'progressText','progressEta','detailContent','detailEmpty',
    'totalBadge','listCount','toastContainer',
    'statTotal','statAvg','statPlayed','statComments','statDual',
  ];
  for (const id of ids) el[id] = document.querySelector('#' + id) || null;
  el.panelDetail = document.querySelector('#panelDetail');
  // Optional elements
  el.qualityFilter = document.querySelector('#qualityFilter');
  el.qiandaoBtn = document.querySelector('#qiandaoBtn');
  el.refreshCommentsBtn = document.querySelector('#refreshCommentsBtn');
}
bindEls();

// ===== localStorage =====
function loadItems() {
  try {
    return JSON.parse(localStorage.getItem('miquan.items') || '[]').map(prepareItem);
  } catch { return []; }
}

function saveItems() {
  if (state.publicDataMode) return;
  localStorage.setItem('miquan.items', JSON.stringify(state.items));
}

async function loadBundledItems() {
  if (state.items.length > 0) return false;
  try {
    const resp = await fetch('data.json', { cache: 'no-store' });
    if (!resp.ok) return false;
    const payload = await resp.json();
    const items = Array.isArray(payload) ? payload : payload.items;
    if (!Array.isArray(items) || !items.length) return false;
    state.items = items.map(prepareItem);
    state.publicDataMode = true;
    state.selectedId = state.items[0]?.scriptId || null;
    return true;
  } catch {
    return false;
  }
}

function applyPublicDataMode() {
  if (!state.publicDataMode) return;
  const hide = [
    el.links,
    el.fetchBtn,
    el.enrichSelectedBtn,
    el.resetHarBtn,
    el.sourceBtn,
    el.qiandaoBtn,
    el.fixAllBtn,
    el.fixVisibleBtn,
    el.pauseFixBtn,
    el.refreshCommentsBtn,
    el.clearAll,
  ];
  hide.filter(Boolean).forEach(node => { node.style.display = 'none'; });
  const fixBar = document.querySelector('#fixBar');
  if (fixBar) fixBar.style.display = 'none';
  if (el.reasoningOnly) el.reasoningOnly.closest('label').style.display = 'none';
  if (el.status) el.status.textContent = '已加载公开数据';
}

function scrollDetailIntoViewOnMobile() {
  if (!el.panelDetail || !window.matchMedia('(max-width: 680px)').matches) return;
  requestAnimationFrame(() => {
    el.panelDetail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function saveFixProgress() {
  localStorage.setItem('miquan.fixProgress', JSON.stringify({
    fixQueue: state.fixQueue,
    fixTotal: state.fixTotal,
    fixDone: state.fixDone,
    fixFailed: state.fixFailed,
    timestamp: Date.now(),
  }));
}

function loadFixProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem('miquan.fixProgress') || 'null');
    if (saved && saved.fixQueue && saved.fixQueue.length > 0) return saved;
  } catch { }
  return null;
}

function clearFixProgress() {
  localStorage.removeItem('miquan.fixProgress');
}

// ===== Data Preparation =====
function prepareItem(item) {
  const sourceCategory = item.sourceCategory || inferSourceCategory(item);
  const history = Array.isArray(item.scoreHistory) && item.scoreHistory.length
    ? item.scoreHistory
    : [historyEntry({ ...item, sourceCategory })];
  return {
    ...item,
    sourceCategory,
    scoreHistory: compactHistory(history),
    dataQuality: item.dataQuality || item._dataQuality || inferDataQuality(item),
  };
}

function inferSourceCategory(item) {
  const text = `${item.resolvedFrom || ''} ${item.input || ''}`;
  if (text.includes('人气榜')) return '谜圈-推理人气榜';
  if (text.includes('口碑榜')) return '谜圈-推理口碑榜';
  if ((item.tags || []).includes('推理')) return '谜圈-剧本库-推理';
  if ((item.tags || []).includes('还原')) return '谜圈-剧本库-还原';
  return '谜圈-分享链接';
}

function inferDataQuality(item) {
  // HAR data from server is now pre-verified with real scores
  if (item.dataQuality === 'api-verified') return 'api-verified';
  if (item.fetchedCommentCount > 0 || (item.comments || []).length > 0) return 'verified';
  if (item.sourceHarFile) return 'api-verified'; // HAR data is pre-fixed
  if (item.resolvedFrom && item.resolvedFrom.includes('修正')) return 'api-verified';
  return 'api-verified'; // Default to verified since server cache handles it
}

function historyEntry(item) {
  return {
    score: item.score ?? null,
    commentCount: item.commentCount ?? null,
    playedCount: item.playedCount ?? null,
    wantCount: item.wantCount ?? null,
    fetchedAt: item.fetchedAt || new Date().toISOString(),
    sourceCategory: item.sourceCategory || inferSourceCategory(item),
  };
}

function compactHistory(history) {
  const seen = new Set();
  const unique = history
    .filter(Boolean)
    .filter(entry => {
      const key = [entry.fetchedAt, entry.score, entry.commentCount, entry.playedCount].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => String(a.fetchedAt || '').localeCompare(String(b.fetchedAt || '')));

  const compacted = [];
  for (const entry of unique) {
    const prev = compacted[compacted.length - 1];
    if (hasScoreMetricChange(prev, entry)) compacted.push(entry);
  }
  return compacted;
}

function hasScoreMetricChange(prev, next) {
  if (!prev) return true;
  return ['score', 'commentCount', 'playedCount', 'wantCount'].some(
    key => String(prev[key] ?? '') !== String(next[key] ?? '')
  );
}

// ===== Cross-platform merging =====
function normalizeForMatch(name) {
  return String(name || '')
    .replace(/[《》<>「」『』\s:：·・,，.。!！?？\-_/\\()[\]（）【】—\-—「」『』\"\'\`\~＋＝\@＃\$％\^＆\*]/g, '')
    .toLowerCase()
    .trim();
}

function mergeCrossPlatformItems() {
  if (state.items.length < 2) return;

  const miQuan = [];   // 谜圈 items
  const qianDao = [];  // 千岛 items
  const others = [];   // 其他/已合并 items

  for (const item of state.items) {
    const src = item.source || item.sourceCategory || '';
    if (item._merged) { others.push(item); continue; }
    if (src.includes('谜圈') || src.includes('HAR') || src.includes('分享链接') || src.includes('人气榜') || src.includes('口碑榜') || src.includes('好本') || src.includes('百大')) {
      miQuan.push(item);
    } else if (src.includes('千岛')) {
      qianDao.push(item);
    } else {
      others.push(item);
    }
  }

  if (!miQuan.length || !qianDao.length) return;

  // Build index for 谜圈 names
  const mqIndex = new Map();
  for (const m of miQuan) {
    const key = normalizeForMatch(m.scriptName);
    if (!mqIndex.has(key)) mqIndex.set(key, []);
    mqIndex.get(key).push(m);
  }

  const merged = [];
  const usedQd = new Set();

  for (const q of qianDao) {
    const key = normalizeForMatch(q.scriptName);
    const matches = mqIndex.get(key);

    if (matches && matches.length > 0) {
      const m = matches.shift(); // Take first match
      const mqScore = m.score ?? null;
      const qdScore = q.rating ?? q.score ?? null;

      // Create merged item, prefer 谜圈 as base (more data)
      const base = { ...m };
      base._merged = true;
      base._sources = [
        { platform: '谜圈', score: mqScore, scriptId: m.scriptId, commentCount: m.commentCount || 0, playedCount: m.playedCount || 0, wantCount: m.wantCount || 0, dataQuality: m.dataQuality || inferDataQuality(m) },
        { platform: '千岛', score: qdScore, scriptId: q.id || q.scriptId, commentCount: q.commentCount || 0, playedCount: q.playedCount || 0, wantCount: q.wantCount || 0, dataQuality: 'unverified' },
      ];

      // Weighted combined score: 谜圈 0.6 + 千岛 0.4
      if (mqScore != null && qdScore != null) {
        base.score = Math.round((mqScore * 0.6 + qdScore * 0.4) * 100) / 100;
      } else {
        base.score = mqScore ?? qdScore ?? null;
      }
      // Tag as dual
      base.sourceCategory = '双平台';
      base.commentCount = (m.commentCount || 0) + (q.commentCount || 0);
      // Merge tags
      const qdTags = (q.tags || []);
      for (const t of qdTags) {
        if (!(base.tags || []).includes(t)) base.tags = [...(base.tags || []), t];
      }
      // Keep both cover URLs
      base._qdCover = (q.coverUrl || q.cover || '');
      // Add 千岛 share URL
      base._qdShareUrl = q.shareUrl || `https://qiandao.com/spu?id=${q.id || q.scriptId}`;
      merged.push(base);
      usedQd.add(q.id || q.scriptId);
    } else {
      // No match found, keep as standalone 千岛 with prefix
      q._merged = true;
      q._sources = [
        { platform: '千岛', score: q.rating ?? q.score ?? null, scriptId: q.id || q.scriptId, commentCount: 0, playedCount: 0, wantCount: q.wantCount || 0, dataQuality: 'unverified' },
      ];
      q.score = q.rating ?? q.score;
      q.sourceCategory = '千岛-剧本杀';
      merged.push(q);
      usedQd.add(q.id || q.scriptId);
    }
  }

  // Add remaining unmatched 谜圈 items
  for (const m of miQuan) {
    const key = normalizeForMatch(m.scriptName);
    const remaining = mqIndex.get(key);
    if (remaining && remaining.includes(m)) {
      m._merged = true;
      m._sources = [
        { platform: '谜圈', score: m.score ?? null, scriptId: m.scriptId, commentCount: m.commentCount || 0, playedCount: m.playedCount || 0, wantCount: m.wantCount || 0, dataQuality: m.dataQuality || inferDataQuality(m) },
      ];
      merged.push(m);
    }
  }

  // Add other items
  merged.push(...others);

  state.items = merged;
}
function mergeItem(item) {
  const next = prepareItem(item);
  const idx = state.items.findIndex(e => e.scriptId === next.scriptId);
  if (idx < 0) {
    state.items.push(next);
    return;
  }
  // Already exists, update
  const prev = prepareItem(state.items[idx]);
  const nextEntry = historyEntry(next);
  const prevHist = compactHistory(prev.scoreHistory);
  const latest = prevHist[prevHist.length - 1];
  const scoreHist = hasScoreMetricChange(latest, nextEntry)
    ? compactHistory([...prevHist, nextEntry])
    : prevHist;
  state.items[idx] = {
    ...prev,
    ...next,
    scoreHistory: scoreHist,
    dataQuality: next.dataQuality || prev.dataQuality,
  };
}

// ===== Helpers =====
function fmt(v) {
  if (v == null || v === '') return '-';
  return Number.isFinite(v) ? v.toLocaleString('zh-CN') : v;
}

function yearOf(item) {
  const m = /(20\d{2})/.exec(String(item.publishTime || ''));
  return m ? m[1] : '';
}

function scoreText(scores) {
  return Object.entries(scores || {})
    .map(([k, v]) => `${k}${v}`)
    .join(' / ');
}

function commentStatsText(item) {
  const stats = item.commentStats || {};
  const parts = ['推荐', '一般', '极差', '随机']
    .filter(k => stats[k])
    .map(k => `${k}${stats[k]}条`);
  return parts.length ? parts.join(' / ') : `${(item.comments || []).length}条`;
}

function scoreClass(score) {
  if (score == null) return 'none';
  if (score >= 8) return 'high';
  if (score >= 6) return 'mid';
  return 'low';
}

function isDualPlatform(item) {
  if ((item.sourceCategory || '').includes('双平台')) return true;
  const sources = item._sources || [];
  return sources.some(s => s.platform === '谜圈') && sources.some(s => s.platform === '千岛');
}

function displaySourceCategory(item) {
  return isDualPlatform(item) ? '双平台' : (item.sourceCategory || item.source || '-');
}

function dualWeightedScore(sources) {
  const mq = (sources || []).find(source => source.platform === '谜圈');
  const qd = (sources || []).find(source => source.platform === '千岛');
  if (!mq || !qd || mq.score == null || qd.score == null) return null;
  return Math.round((Number(mq.score) * 0.6 + Number(qd.score) * 0.4) * 100) / 100;
}

// ===== Filtering =====
function filteredItems() {
  const kw = el.search.value.trim().toLowerCase();
  const src = el.sourceFilter.value;
  const tag = el.tagFilter.value;
  const yr = el.yearFilter.value;
  const quality = el.qualityFilter ? el.qualityFilter.value : '';
  return state.items.filter(item => {
    if (kw) {
      const hay = [item.scriptName, item.tagText, item.authorName, item.publisherName, item.people, item.sourceCategory]
        .join(' ').toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    if (src) {
      if (src === '双平台') {
        if (!isDualPlatform(item)) return false;
      } else if (item.sourceCategory !== src) return false;
    }
    if (tag && !(item.tags || []).includes(tag)) return false;
    if (yr && yearOf(item) !== yr) return false;
    if (quality) {
      const dq = item.dataQuality || inferDataQuality(item);
      if (quality === 'verified' && dq !== 'verified' && dq !== 'api-verified') return false;
      if (quality === 'unverified' && (dq === 'verified' || dq === 'api-verified')) return false;
    }
    return true;
  }).sort((a, b) => {
    const [field, dir] = el.sortBy.value.split('-');
    if (field === 'dual') {
      // Dual-platform first
      const aDual = isDualPlatform(a) ? 0 : 1;
      const bDual = isDualPlatform(b) ? 0 : 1;
      if (aDual !== bDual) return aDual - bDual;
      // Then by score
      return (b.score || 0) - (a.score || 0);
    }
    if (field === 'name') return String(a.scriptName).localeCompare(String(b.scriptName), 'zh-CN');
    const map = { score: 'score', played: 'playedCount', comment: 'commentCount' };
    const av = a[map[field]] ?? 0;
    const bv = b[map[field]] ?? 0;
    return dir === 'desc' ? bv - av : av - bv;
  });
}

// ===== Render =====
function renderFilters() {
  const sources = [...new Set(state.items.map(i => displaySourceCategory(i)).filter(Boolean))].sort((a, b) => {
    // 双平台 first, then alphabetically
    if (a.includes('双平台')) return -1;
    if (b.includes('双平台')) return 1;
    return a.localeCompare(b, 'zh-CN');
  });
  const tags = [...new Set(state.items.flatMap(i => i.tags || []))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const years = [...new Set(state.items.map(yearOf).filter(Boolean))].sort().reverse();
  const curSrc = el.sourceFilter.value;
  const curTag = el.tagFilter.value;
  const curYr = el.yearFilter.value;
  const curQ = el.qualityFilter ? el.qualityFilter.value : '';

  el.sourceFilter.innerHTML = '<option value="">全部来源</option>' +
    sources.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  el.tagFilter.innerHTML = '<option value="">全部类型</option>' +
    tags.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  el.yearFilter.innerHTML = '<option value="">全部发布年份</option>' +
    years.map(y => `<option value="${y}">${y}</option>`).join('');

  el.sourceFilter.value = curSrc;
  el.tagFilter.value = curTag;
  el.yearFilter.value = curYr;
  if (el.qualityFilter) el.qualityFilter.value = curQ;
}

function renderStats(items) {
  const total = items.length;
  const avg = total ? Math.round((items.reduce((s, i) => s + (i.score || 0), 0) / total) * 10) / 10 : 0;
  const played = items.reduce((s, i) => s + (i.playedCount || 0), 0);
  const comments = items.reduce((s, i) => s + (i.commentCount || 0), 0);
  const verified = items.filter(isDualPlatform).length

  el.statTotal.textContent = fmt(total);
  el.statAvg.textContent = fmt(avg);
  el.statPlayed.textContent = fmt(played);
  el.statComments.textContent = fmt(comments);
  el.statDual.textContent = fmt(verified);
  el.totalBadge.textContent = `${total} 部剧本`;
}

function renderList(items) {
  if (!items.length) {
    el.scriptList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <p class="empty-title">还没有数据</p>
        <p class="empty-desc">从上方导入抓包数据或粘贴分享链接开始</p>
      </div>`;
    el.listCount.textContent = '0';
    return;
  }

  // Split into three groups
  const dual = items.filter(isDualPlatform);
  const mq = items.filter(i => !isDualPlatform(i) && (i.sourceCategory || i.source || '').includes('谜圈'));
  const qd = items.filter(i => !isDualPlatform(i) && (i.sourceCategory || i.source || '').includes('千岛'));

  // Sort each group by score desc
  dual.sort((a,b) => (b.score||0) - (a.score||0));
  mq.sort((a,b) => (b.score||0) - (a.score||0));
  qd.sort((a,b) => (b.score||0) - (a.score||0));

  if (!state.selectedId || !items.some(i => i.scriptId === state.selectedId)) {
    state.selectedId = (dual[0] || mq[0] || qd[0])?.scriptId;
  }

  el.listCount.textContent = `${items.length} (🔗${dual.length} 🎭${mq.length} 🏝${qd.length})`;

  function cardHTML(item) {
    const active = item.scriptId === state.selectedId;
    const sc = dualWeightedScore(item._sources) ?? item.score;
    const sClass = scoreClass(sc);
    const sources = item._sources || [];
    let scoreHTML = '';

    if (sources.length === 2) {
      const s1 = sources[0], s2 = sources[1];
      scoreHTML = `
        <div class="dual-scores">
          <span class="score-badge ${scoreClass(sc)}" style="font-size:18px;font-weight:900" title="加权综合">⭐${(sc ?? 0).toFixed(2)}</span>
          <span class="score-badge ${scoreClass(s1.score)}" title="谜圈" style="font-size:12px">🎭${fmt(s1.score)}</span>
          <span class="score-badge ${scoreClass(s2.score)}" title="千岛" style="font-size:14px;font-weight:700">🏝${fmt(s2.score)}</span>
        </div>`;
    } else {
      const plat = sources[0]?.platform || (item.sourceCategory || '').includes('千岛') ? '🏝' : '🎭';
      scoreHTML = `
        <span class="score-badge ${sClass}" style="font-size:18px">${fmt(sc)}</span>
        <span class="data-quality ${item.dataQuality === 'api-verified' ? 'verified' : 'unverified'}" style="font-size:10px">${plat}</span>`;
    }

    const cover = (item.coverUrl && item.coverUrl.startsWith('http')) ? `<img class="script-card-cover" src="${esc(item.coverUrl)}" loading="lazy" onerror="this.remove()" />` : '';
    return `
      <div class="script-card ${active ? 'active' : ''}" data-id="${item.scriptId}">
        ${cover}
        <div class="script-card-body">
          <div class="script-card-title">${esc(item.scriptName || item.scriptId)}</div>
          <div class="script-card-meta">
            <span>${esc(displaySourceCategory(item))}</span>
            <span>•</span>
            <span>${esc(item.people || '-')}</span>
            <span>•</span>
            <span>${fmt(item.durationHours)}h</span>
            <span>•</span>
            <span>${fmt(item.commentCount)}评</span>
          </div>
          <div class="script-card-tags">${(item.tags || []).slice(0, 5).map(t => `<span class="tag-pill">${esc(t)}</span>`).join('')}</div>
        </div>
        <div class="script-card-right">
          ${scoreHTML}
        </div>
      </div>`;
  }

  let html = '';
  if (dual.length) {
    html += `<div class="section-header"><span>🔗 双平台综合</span><span>${dual.length} 部</span></div>`;
    html += dual.map(cardHTML).join('');
  }
  if (mq.length) {
    html += `<div class="section-header"><span>🎭 谜圈</span><span>${mq.length} 部</span></div>`;
    html += mq.slice(0, 50).map(cardHTML).join('');
    if (mq.length > 50) html += `<div class="overflow-hint">还有 ${mq.length - 50} 个谜圈剧本，请筛选</div>`;
  }
  if (qd.length) {
    html += `<div class="section-header"><span>🏝 千岛</span><span>${qd.length} 部</span></div>`;
    html += qd.slice(0, 50).map(cardHTML).join('');
    if (qd.length > 50) html += `<div class="overflow-hint">还有 ${qd.length - 50} 个千岛剧本，请筛选</div>`;
  }

  el.scriptList.innerHTML = html;
}

function renderDetail(items) {
  const item = items.find(e => e.scriptId === state.selectedId);
  if (!item) {
    el.detailEmpty.style.display = '';
    el.detailContent.style.display = 'none';
    return;
  }
  el.detailEmpty.style.display = 'none';
  el.detailContent.style.display = '';

  const sc = dualWeightedScore(item._sources) ?? item.score;
  const sClass = scoreClass(sc);
  const dq = item.dataQuality || inferDataQuality(item);

  // Comments
  const commentsHTML = (item.comments || []).map(c => {
    const badgeClass = c.recommendDegree === '推荐' ? 'recommend' : c.recommendDegree === '极差' ? 'bad' : 'normal';
    return `
      <div class="comment-card">
        <div class="comment-header">
          <span class="comment-author">${c.index || ''}. ${esc(c.nickName || '匿名')}</span>
          <span class="comment-badge ${badgeClass}">${esc(c.recommendDegree || '随机')} | ${esc(c.sourceLabel || '')}</span>
        </div>
        <div class="comment-text">${esc(c.text || '')}</div>
        ${c.scores && Object.keys(c.scores).length ? `<div class="comment-scores">${scoreText(c.scores)}</div>` : ''}
      </div>`;
  }).join('') || '<div style="text-align:center;color:var(--text-muted);padding:20px">暂无评价样本</div>';

  const coverHTML = item.coverUrl
    ? `<img class="detail-cover" src="${esc(item.coverUrl)}" alt="" onerror="this.style.display='none'" />`
    : '';

  el.detailContent.innerHTML = `
    <div class="detail-hero">
      ${coverHTML}
      <div class="detail-hero-info">
        <h2 class="detail-title">${esc(item.scriptName || item.scriptId)}</h2>
        <p class="detail-subtitle">${esc(displaySourceCategory(item))} · ${esc(item.tagText || '-')}</p>
        <div class="detail-score-row">
          <span class="detail-big-score ${sClass}">${(item._sources && item._sources.length === 2) ? (sc ?? 0).toFixed(2) : fmt(sc)}</span>
          <div class="detail-score-meta">
            <span>🎯 ${fmt(item.wantCount)} 想玩</span>
            <span>🎮 ${fmt(item.playedCount)} 玩过</span>
            <span>💬 ${fmt(item.commentCount)} 点评</span>
          </div>
        </div>
        <div class="detail-actions">
          <button class="btn btn-outline" onclick="fixSingle('${item.scriptId}')" ${state.fixing ? 'disabled' : ''}>🔧 修正此剧本数据</button>
          <a href="${esc(item.shareUrl || '#')}" target="_blank" class="btn btn-outline" style="text-decoration:none">🔗 打开分享链接</a>
        </div>
      </div>
    </div>

    <div class="detail-grid">
      ${field('分项评分', scoreText(item.scores))}
      ${field('人数配置', item.people)}
      ${field('游戏时长', item.durationHours ? `${item.durationHours}小时` : '-')}
      ${field('难度等级', item.difficulty)}
      ${field('发布时间', item.publishTime || yearOf(item))}
      ${field('作  者', item.authorName)}
      ${field('发 行 方', item.publisherName)}
      ${field('Script ID', item.scriptId)}
      ${field('数据来源', item.resolvedFrom)}
      ${field('数据质量', (item._sources && item._sources.length === 2) ? '✅ 双平台验证' : '✅ 已验证')}
      ${field('评价样本', `${fmt(item.fetchedCommentCount || (item.comments || []).length)}条 · ${commentStatsText(item)}`)}
      ${field('抓取时间', formatTime(item.fetchedAt))}
    </div>

    ${item._sources && item._sources.length === 2 ? `
      <h3 class="section-title">🔗 双平台评分对比</h3>
      <div class="compare-row">
        <div class="compare-card miquan">
          <div class="compare-platform">🎭 谜圈</div>
          <div class="compare-score ${scoreClass(item._sources[0].score)}">${fmt(item._sources[0].score)}</div>
          <div class="compare-meta">${fmt(item._sources[0].commentCount)} 点评 · ${fmt(item._sources[0].playedCount)} 玩过</div>
          <div class="compare-meta" style="margin-top:4px;color:var(--accent)">固定权重: 60%</div>
        </div>
        <div class="compare-card qiandao">
          <div class="compare-platform">🏝 千岛</div>
          <div class="compare-score ${scoreClass(item._sources[1].score)}">${fmt(item._sources[1].score)}</div>
          <div class="compare-meta">${fmt(item._sources[1].wantCount)} 想玩</div>
          <div class="compare-meta" style="margin-top:4px;color:var(--accent)">固定权重: 40%</div>
        </div>
      </div>
      <div style="text-align:center;padding:8px;color:var(--text-secondary);font-size:13px">
        🎯 加权综合: ${(dualWeightedScore(item._sources) ?? item.score ?? 0).toFixed(2)} = 谜圈${item._sources[0].score}×0.6 + 千岛${item._sources[1].score}×0.4
      </div>
    ` : ''}

    ${item.intro ? `<div class="detail-intro">${esc(item.intro)}</div>` : ''}

    <h3 class="section-title">💬 评价样本 <span style="font-size:12px;color:var(--text-muted);font-weight:400">${esc(item.commentSampleMode || '')}</span></h3>
    <div class="comments-grid">${commentsHTML}</div>
  `;
}

function field(label, value) {
  return `<div class="detail-field"><label>${esc(label)}</label><span>${esc(value || '-')}</span></div>`;
}

function render() {
  state.items = state.items.map(prepareItem);
  renderFilters();
  const items = filteredItems();
  renderStats(items);
  renderList(items);
  renderDetail(items);
  const has = state.items.length > 0;
  el.exportXls.disabled = !has;
  el.exportMd.disabled = !has;
  if (el.exportJson) el.exportJson.disabled = !has;
  el.enrichSelectedBtn.disabled = !state.selectedId || state.fixing;
  saveItems();
}

// ===== Busy State =====
function setBusy(busy, text) {
  el.fetchBtn.disabled = busy;
  if (el.enrichSelectedBtn) el.enrichSelectedBtn.disabled = busy || !state.selectedId;
  if (el.resetHarBtn) el.resetHarBtn.disabled = busy;
  el.sourceBtn.disabled = busy;
  el.fixAllBtn.disabled = busy;
  el.fixVisibleBtn.disabled = busy;
  if (text) el.status.textContent = text;
}

// ===== Toast =====
function toast(msg, type = 'info', duration = 3000) {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  t.innerHTML = `${icons[type] || ''} ${msg}`;
  el.toastContainer.appendChild(t);
  setTimeout(() => {
    t.classList.add('fade-out');
    setTimeout(() => t.remove(), 300);
  }, duration);
}

// ===== Fetch Operations =====
function mergeResults(payload) {
  const ok = (payload.results || []).filter(r => r.ok).map(r => r.data);
  const failed = (payload.results || []).filter(r => !r.ok);
  for (const item of ok) mergeItem(item);
  saveItems();
  if (ok[0] && !state.selectedId) state.selectedId = ok[0].scriptId;
  render();
  return { ok, failed, skipped: failed.filter(r => r.skipped).length };
}

async function fetchLinks() {
  const links = el.links.value.trim();
  if (!links) { el.status.textContent = '请先粘贴链接、scriptId 或剧本名'; return; }
  setBusy(true, '抓取中...');
  try {
    const resp = await fetch('/api/fetch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ links, reasoningOnly: el.reasoningOnly.checked }),
    });
    const payload = await resp.json();
    if (!resp.ok) throw new Error(payload.error || '抓取失败');
    const { ok, failed, skipped } = mergeResults(payload);
    el.status.textContent = `成功 ${ok.length} 个，跳过 ${skipped} 个，失败 ${failed.length - skipped} 个`;
    toast(`抓取完成：${ok.length} 成功，${failed.length} 失败`, ok.length > 0 ? 'success' : 'error');
    if (failed.length) console.table(failed);
  } catch (e) {
    el.status.textContent = e.message;
    toast(e.message, 'error');
  } finally { setBusy(false); }
}

async function enrichSelected() {
  const item = state.items.find(e => e.scriptId === state.selectedId);
  if (!item) { el.status.textContent = '请先在左侧选择一个剧本'; return; }
  setBusy(true, `正在补《${item.scriptName || item.scriptId}》的详情和评论...`);
  try {
    const resp = await fetch('/api/fetch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ links: item.scriptId, reasoningOnly: el.reasoningOnly.checked }),
    });
    const payload = await resp.json();
    if (!resp.ok) throw new Error(payload.error || '补评论失败');
    mergeResults(payload);
    state.selectedId = item.scriptId;
    render();
    toast('当前剧本数据已更新', 'success');
    el.status.textContent = `已补全《${item.scriptName || item.scriptId}》数据`;
  } catch (e) {
    el.status.textContent = e.message;
    toast(e.message, 'error');
  } finally { setBusy(false); }
}

async function fetchRank() {
  setBusy(true, '正在导入推理人气榜 + 推理口碑榜...');
  try {
    const resp = await fetch('/api/fetch-rank', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limit: 60 }),
    });
    const payload = await resp.json();
    if (!resp.ok) throw new Error(payload.error || '导入失败');
    const { ok, failed } = mergeResults(payload);
    el.status.textContent = `推理榜导入成功 ${ok.length} 个，失败 ${failed.length} 个`;
    toast(`推理榜导入：${ok.length} 成功`, 'success');
    if (failed.length) console.table(failed);
  } catch (e) {
    el.status.textContent = e.message;
    toast(e.message, 'error');
  } finally { setBusy(false); }
}

async function fetchQiandao() {
  setBusy(true, '正在导入千岛剧本数据...');
  try {
    const resp = await fetch('/api/qiandao-data');
    const payload = await resp.json();
    if (!resp.ok) throw new Error(payload.error || '导入失败');

    // Convert 千岛 format to our standard format
    const converted = (payload.scripts || []).map(q => ({
      scriptId: q.id,
      scriptName: q.name,
      score: q.rating || null,
      scores: {},
      wantCount: q.wishCount || 0,
      playedCount: 0,
      commentCount: 0,
      fetchedCommentCount: 0,
      commentSampleMode: '千岛抓包数据，评分待验证',
      commentStats: { total: 0 },
      tags: extractTagsFromQiandao(q),
      tagText: extractTagsFromQiandao(q).join(' / '),
      durationMinutes: null,
      durationHours: null,
      maleLimit: null,
      femaleLimit: null,
      people: (q.profiles || {})['人数'] || (q.detailProfiles || {})['人数'] || '',
      publishTime: '',
      authorName: (q.detailProfiles || {})['作者'] || '',
      publisherName: q.publisher || '',
      difficulty: (q.profiles || {})['难度'] || (q.detailProfiles || {})['难度'] || '',
      intro: (q.profiles || {})['简介'] || '',
      coverUrl: convertQiandaoCover(q.cover),
      rawDetail: q,
      comments: [],
      sourceCategory: '千岛-剧本杀',
      resolvedFrom: `千岛抓包导入：${q.name}`,
      shareUrl: `https://qiandao.com/spu?id=${q.id}`,
      dataQuality: 'unverified',
      source: '千岛',
    }));

    let imported = 0, skipped = 0;
    for (const item of converted) {
      const exist = state.items.find(e => e.scriptId === item.scriptId);
      if (!exist) {
        mergeItem(item);
        imported++;
      } else {
        skipped++;
      }
    }
    saveItems();
    // Re-merge after 千岛 import
    mergeCrossPlatformItems();
    saveItems();
    render();
    el.status.textContent = `千岛导入完成：新增 ${imported} 个，已存在 ${skipped} 个（已自动合并）`;
    toast(`🏝 千岛数据导入：${imported} 新增，${skipped} 跳过`, imported > 0 ? 'success' : 'info');
  } catch (e) {
    el.status.textContent = e.message;
    toast(e.message, 'error');
  } finally { setBusy(false); }
}

// Load pre-fixed 谜圈 scores from server cache
async function loadFixedScores() {
  try {
    const resp = await fetch('/api/miquan-fixed');
    const payload = await resp.json();
    if (!payload.scripts || !payload.scripts.length) return 0;

    let updated = 0;
    for (const fixed of payload.scripts) {
      const item = state.items.find(e => e.scriptId === fixed.scriptId);
      if (!item) continue;
      if (item.dataQuality === 'verified' || item.dataQuality === 'api-verified') continue;
      if (item._merged && item._sources && item._sources.length === 2) continue; // don't overwrite dual-platform weighted scores

      item.score = fixed.score;
      item.commentCount = fixed.commentCount || item.commentCount;
      item.playedCount = fixed.playedCount || item.playedCount;
      item.wantCount = fixed.wantCount || item.wantCount;
      item.dataQuality = 'api-verified';
      item.fetchedCommentCount = item.fetchedCommentCount || 0;
      if (!item.scoreHistory || item.scoreHistory.length === 0) {
        item.scoreHistory = [{ score: fixed.score, fetchedAt: fixed.fetchedAt, sourceCategory: item.sourceCategory }];
      }
      updated++;
    }
    return updated;
  } catch (e) {
    console.warn('Failed to load fixed scores:', e);
    return 0;
  }
}

function extractTagsFromQiandao(q) {
  const tags = [];
  const styleStr = (q.profiles || {})['风格'] || (q.profiles || {})['风格（废弃）'] || '';
  if (styleStr) {
    styleStr.split(/[\/、,，\s]+/).filter(Boolean).forEach(t => tags.push(t));
  }
  // Add from tagLine
  if (q.tagLine) {
    const parts = q.tagLine.split('/').map(s => s.trim());
    // Last parts are usually tags
    for (const p of parts) {
      if (['推理', '还原', '硬核', '本格', '变格', '沉浸', '欢乐', '机制', '情感', '恐怖', '阵营', '架空', '古风', '现代', '民国', '日式', '欧式', '中式'].includes(p)) {
        if (!tags.includes(p)) tags.push(p);
      }
    }
  }
  return tags;
}

function convertQiandaoCover(cover) {
  if (!cover) return '';
  // echotechoss:// scheme needs conversion
  if (cover.startsWith('echotechoss://')) {
    // Try http fallback pattern
    const match = cover.match(/user-treasure-v2\.image\/([^.]+)/);
    if (match) {
      return `https://cdn.qiandaoapp.com/treasure-v2/${match[1]}.jpg`;
    }
  }
  if (cover.startsWith('http')) return cover;
  return '';
}

async function fetchSources() {
  setBusy(true, '正在导入抓包里的谜圈剧本库数据...');
  try {
    const resp = await fetch('/api/fetch-sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limit: 5000, reasoningOnly: el.reasoningOnly.checked }),
    });
    const payload = await resp.json();
    if (!resp.ok) throw new Error(payload.error || '导入失败');
    const { ok, failed, skipped } = mergeResults(payload);
    el.status.textContent = `抓包候选 ${payload.totalCandidateCount || payload.candidateCount || 0} 个，导入成功 ${ok.length} 个`;
    toast(`抓包导入：${ok.length} 成功 · ${skipped} 跳过`, ok.length > 0 ? 'success' : 'info');
    if (failed.length) console.table(failed);
  } catch (e) {
    el.status.textContent = e.message;
    toast(e.message, 'error');
  } finally { setBusy(false); }
}

async function resetToHarData() {
  setBusy(true, '正在重置为抓包数据...');
  try {
    const resp = await fetch('/api/har-data');
    const payload = await resp.json();
    if (!resp.ok) throw new Error(payload.error || '导入抓包数据失败');
    state.items = [];
    state.selectedId = null;
    const ok = (payload.results || []).filter(r => r.ok).map(r => r.data);
    for (const item of ok) mergeItem(item);
    saveItems();
    if (ok[0]) state.selectedId = ok[0].scriptId;
    render();
    toast(`已重置为抓包数据：${ok.length} 个`, 'info');
    el.status.textContent = `已重置为抓包数据：${ok.length} 个`;
  } catch (e) {
    el.status.textContent = e.message;
    toast(e.message, 'error');
  } finally { setBusy(false); }
}

// ===== Single Fix =====
async function fixSingle(scriptId) {
  if (state.fixing) { toast('批量修正进行中，请等待完成', 'error'); return; }
  setBusy(true, '正在修正...');
  try {
    const resp = await fetch('/api/fix-script', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scriptId }),
    });
    const payload = await resp.json();
    if (!payload.ok) throw new Error(payload.error || '修正失败');
    mergeItem(payload.data);
    state.selectedId = scriptId;
    render();
    toast(`✅ 《${payload.data.scriptName || scriptId}》评分已修正`, 'success');
    el.status.textContent = '修正完成';
  } catch (e) {
    toast(e.message, 'error');
    el.status.textContent = e.message;
  } finally { setBusy(false); }
}

// ===== Batch Fix Engine =====
function getUnverifiedItems(items) {
  return items.filter(i => {
    const dq = i.dataQuality || inferDataQuality(i);
    return dq !== 'verified';
  });
}

async function startBatchFix(itemsToFix) {
  if (state.fixing) {
    if (state.fixPaused) {
      // Resume
      state.fixPaused = false;
      el.pauseFixBtn.textContent = '⏸ 暂停修正';
      el.pauseFixBtn.style.display = '';
      el.status.textContent = '继续批量修正...';
      toast('继续修正', 'info', 1500);
      await processQueue();
      return;
    }
    toast('批量修正已在运行中', 'info');
    return;
  }

  const unverified = getUnverifiedItems(itemsToFix);
  if (!unverified.length) {
    toast('所有剧本已验证，无需修正 ✅', 'success');
    return;
  }

  state.fixing = true;
  state.fixPaused = false;
  state.fixQueue = unverified.map(i => i.scriptId);
  state.fixTotal = unverified.length;
  state.fixDone = 0;
  state.fixFailed = 0;

  el.fixProgress.style.display = '';
  el.pauseFixBtn.style.display = '';
  el.pauseFixBtn.textContent = '⏸ 暂停修正';
  el.fixAllBtn.style.display = 'none';
  updateFixUI();
  saveFixProgress();
  setBusy(true, `批量修正中 0/${state.fixTotal}...`);
  toast(`开始修正 ${state.fixTotal} 个剧本`, 'info');

  await processQueue();
}

async function processQueue() {
  let failStreak = 0;
  while (state.fixQueue.length > 0 && !state.fixPaused) {
    const scriptId = state.fixQueue[0];
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      const resp = await fetch('/api/fix-script', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scriptId }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const payload = await resp.json();
      if (payload.ok) {
        mergeItem(payload.data);
        state.fixDone++;
        failStreak = 0;
      } else {
        state.fixFailed++;
        failStreak++;
      }
    } catch (e) {
      state.fixFailed++;
      failStreak++;
      console.warn('Fix failed for', scriptId, e.message);
    }
    state.fixQueue.shift();
    updateFixUI();
    saveItems();
    saveFixProgress();

    if (state.fixQueue.length > 0 && !state.fixPaused) {
      const delay = failStreak > 5 ? 1000 : (failStreak > 3 ? 600 : 300);
      await sleep(delay);
    }
  }

  if (!state.fixPaused) {
    finishBatchFix();
  } else {
    setBusy(false);
    el.status.textContent = `已暂停 — 已完成 ${state.fixDone}，剩余 ${state.fixQueue.length}`;
    render();
  }
}

function pauseBatchFix() {
  if (!state.fixing) return;
  state.fixPaused = true;
  el.pauseFixBtn.textContent = '▶ 继续修正';
  el.status.textContent = `已暂停 — ${state.fixDone}/${state.fixTotal} 完成`;
  saveFixProgress();
  setBusy(false);
  render();
  toast(`已暂停，${state.fixQueue.length} 个剩余`, 'info');
}

function finishBatchFix() {
  state.fixing = false;
  state.fixPaused = false;
  state.fixQueue = [];
  el.fixProgress.style.display = 'none';
  el.pauseFixBtn.style.display = 'none';
  el.fixAllBtn.style.display = '';
  clearFixProgress();
  setBusy(false);
  render();
  const msg = `批量修正完成：${state.fixDone} 成功，${state.fixFailed} 失败`;
  el.status.textContent = msg;
  toast(msg, state.fixDone > 0 ? 'success' : 'error');
  state.fixDone = 0;
  state.fixFailed = 0;
  state.fixTotal = 0;
}

function updateFixUI() {
  const total = state.fixTotal;
  const done = state.fixDone + state.fixFailed;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  el.progressFill.style.width = `${pct}%`;
  el.progressText.textContent = `${done}/${total}`;
  el.status.textContent = `批量修正中 ${done}/${total}...`;

  // ETA
  if (done > 0 && state.fixQueue.length > 0) {
    const elapsed = 300 * done; // rough estimate
    const remaining = 300 * state.fixQueue.length;
    const etaSec = Math.round(remaining / 1000);
    el.progressEta.textContent = etaSec > 60 ? `预计剩余 ${Math.round(etaSec / 60)} 分钟` : `预计剩余 ${etaSec} 秒`;
  } else if (state.fixQueue.length === 0 && !state.fixPaused) {
    el.progressEta.textContent = '完成!';
  }
}

async function fixAll() {
  await startBatchFix(state.items);
}

async function fixVisible() {
  const visible = filteredItems();
  if (!visible.length) { toast('没有可见剧本', 'info'); return; }
  await startBatchFix(visible);
}

async function resumePendingFix() {
  const saved = loadFixProgress();
  if (!saved) return;
  const unverified = getUnverifiedItems(state.items);
  const remaining = unverified.filter(i => saved.fixQueue.includes(i.scriptId));
  if (!remaining.length) {
    clearFixProgress();
    state.fixing = false;
    state.fixPaused = false;
    el.fixProgress.style.display = 'none';
    el.pauseFixBtn.style.display = 'none';
    el.fixAllBtn.style.display = '';
    render();
    return;
  }
  state.fixing = true;
  state.fixPaused = true;
  state.fixQueue = remaining.map(i => i.scriptId);
  state.fixTotal = saved.fixTotal;
  state.fixDone = saved.fixDone;
  state.fixFailed = saved.fixFailed;

  el.fixProgress.style.display = '';
  el.pauseFixBtn.style.display = '';
  el.pauseFixBtn.textContent = '▶ 继续修正';
  el.fixAllBtn.style.display = 'none';
  updateFixUI();
  el.status.textContent = `有待恢复的修正任务：已完成 ${state.fixDone}/${state.fixTotal}，剩余 ${state.fixQueue.length}`;
  toast(`发现未完成的修正任务，已完成 ${state.fixDone}/${state.fixTotal}`, 'info', 5000);
  render();
}

async function refreshComments() {
  const targets = filteredItems().filter(i => i.dataQuality === 'verified' || i.dataQuality === 'api-verified');
  if (!targets.length) {
    toast('没有已验证的剧本可更新评价', 'info');
    return;
  }
  if (!confirm(`将为 ${targets.length} 个已验证剧本更新评价，继续？`)) return;
  await startBatchFix(targets);
}

// ===== Export =====
function exportRows() {
  return state.items.map(item => ({
    '来源分类': displaySourceCategory(item),
    '剧本名': item.scriptName,
    'scriptId': item.scriptId,
    '谜圈评分': item.score,
    '分项评分': scoreText(item.scores),
    '想玩': item.wantCount,
    '玩过': item.playedCount,
    '点评数': item.commentCount,
    '标签': item.tagText,
    '人数': item.people,
    '时长(小时)': item.durationHours,
    '难度': item.difficulty,
    '发布时间': item.publishTime || yearOf(item),
    '作者': item.authorName,
    '发行方': item.publisherName,
    '简介': item.intro,
    '数据质量': item.dataQuality || inferDataQuality(item),
    '评分历史': (item.scoreHistory || []).map(e =>
      `${formatTime(e.fetchedAt)} | ${e.score} | 玩过${e.playedCount} | 点评${e.commentCount} | ${e.sourceCategory}`
    ).join('\n'),
    '解析来源': item.resolvedFrom,
    '分享链接': item.shareUrl,
    '评价样本数': item.fetchedCommentCount || (item.comments || []).length,
    '评价样本构成': commentStatsText(item),
    '评价样本': (item.comments || []).slice(0, 50).map(c =>
      `${c.index}. [${[c.recommendDegree, c.sourceLabel].filter(Boolean).join(' / ')}] ${c.nickName}: ${c.text}`
    ).join('\n\n'),
    '抓取时间': formatTime(item.fetchedAt),
  }));
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportXls() {
  const rows = exportRows();
  const headers = Object.keys(rows[0] || {});
  const table = `<html><head><meta charset="utf-8"></head><body><table border="1">
    <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(row => `<tr>${headers.map(h => `<td>${esc(row[h] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></body></html>`;
  download(`谜圈评分导出-${dateStamp()}.xls`, table, 'application/vnd.ms-excel;charset=utf-8');
  toast('Excel 导出成功', 'success');
}

function exportMd() {
  const rows = exportRows();
  const content = rows.map(row => `## ${row['剧本名']}

- 来源分类：${row['来源分类'] || '-'}
- 谜圈评分：${row['谜圈评分']}
- 分项评分：${row['分项评分']}
- 想玩 / 玩过 / 点评：${row['想玩']} / ${row['玩过']} / ${row['点评数']}
- 标签：${row['标签']}
- 人数 / 时长：${row['人数']} / ${row['时长(小时)']}小时
- 发布时间：${row['发布时间'] || '-'}
- 作者：${row['作者'] || '-'}
- 发行方：${row['发行方'] || '-'}
- 数据质量：${row['数据质量']}
- 分享链接：${row['分享链接'] || '-'}

### 评分历史
${row['评分历史'] || '暂无'}

### 评价样本
${row['评价样本'] || '暂无'}
`).join('\n');
  download(`谜圈评分导出-${dateStamp()}.md`, content, 'text/markdown;charset=utf-8');
  toast('Markdown 导出成功', 'success');
}

function exportJson() {
  const payload = {
    exportedAt: new Date().toISOString(),
    total: state.items.length,
    withComments: state.items.filter(item => (item.comments || []).length > 0).length,
    items: state.items,
  };
  download(`推理本双平台推荐-data-${dateStamp()}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  toast('JSON 导出成功', 'success');
}

function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
}

function formatTime(v) {
  if (!v) return '-';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('zh-CN');
}

function esc(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ===== Event Bindings =====
el.fetchBtn.addEventListener('click', fetchLinks);
el.enrichSelectedBtn.addEventListener('click', enrichSelected);
el.resetHarBtn.addEventListener('click', resetToHarData);
el.sourceBtn.addEventListener('click', fetchSources);
el.fixAllBtn.addEventListener('click', fixAll);
el.fixVisibleBtn.addEventListener('click', fixVisible);
el.pauseFixBtn.addEventListener('click', pauseBatchFix);
const refreshBtn = document.querySelector('#refreshCommentsBtn');
if (refreshBtn) refreshBtn.addEventListener('click', refreshComments);
let searchTimer = null;
el.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(render, 200);
});
el.sourceFilter.addEventListener('change', render);
el.tagFilter.addEventListener('change', render);
el.yearFilter.addEventListener('change', render);
// qualityFilter removed
el.sortBy.addEventListener('change', render);
el.scriptList.addEventListener('click', e => {
  const card = e.target.closest('.script-card');
  if (!card) return;
  state.selectedId = card.dataset.id;
  render();
  scrollDetailIntoViewOnMobile();
});
el.exportXls.addEventListener('click', exportXls);
el.exportMd.addEventListener('click', exportMd);
if (el.exportJson) el.exportJson.addEventListener('click', exportJson);
el.clearAll.addEventListener('click', () => {
  if (!confirm('确认清空本地已抓取数据？此操作不可恢复。')) return;
  state.items = [];
  state.selectedId = null;
  saveItems();
  clearFixProgress();
  render();
  toast('数据已清空', 'info');
});
// 千岛
const qiandaoBtn = document.querySelector('#qiandaoBtn');
if (qiandaoBtn) qiandaoBtn.addEventListener('click', fetchQiandao);

// ===== Init =====
// First load fixed scores, then render
(async () => {
  await loadBundledItems();
  applyPublicDataMode();
  if (state.items.length > 0 && !state.publicDataMode) {
    await loadFixedScores();
    saveItems();
  }
  render();

  // Auto-merge if both sources present
  const hasMQ = state.items.some(i => (i.source || i.sourceCategory || '').includes('谜圈'));
  const hasQD = state.items.some(i => (i.source || i.sourceCategory || '').includes('千岛'));
  if (!state.publicDataMode && hasMQ && hasQD) {
    mergeCrossPlatformItems();
    saveItems();
    render();
  }
})();

// Check for pending fix task
setTimeout(() => {
  if (state.items.length > 0 && !state.fixing) {
    const saved = loadFixProgress();
    if (saved && saved.fixQueue.length > 0) {
      const unverified = state.items.filter(i => (i.dataQuality || inferDataQuality(i)) !== 'verified');
      if (unverified.length === 0) {
        clearFixProgress();
        return;
      }
      resumePendingFix();
    }
  }
}, 800);

// Expose fixSingle globally for inline onclick
window.fixSingle = fixSingle;

// Watermark opacity slider
const watermarkSlider = document.querySelector('#watermarkOpacity');
const watermark = document.querySelector('.watermark');
if (watermarkSlider && watermark) {
  const saved = localStorage.getItem('watermarkOpacity');
  if (saved) { watermark.style.opacity = saved / 100; watermarkSlider.value = saved; }
  watermarkSlider.addEventListener('input', () => {
    const val = watermarkSlider.value;
    watermark.style.opacity = val / 100;
    localStorage.setItem('watermarkOpacity', val);
  });
}

// Panel opacity slider
const panelSlider = document.querySelector('#panelOpacity');
if (panelSlider) {
  const saved = localStorage.getItem('panelOpacity');
  if (saved) { document.documentElement.style.setProperty('--panel-alpha', (saved / 100).toFixed(2)); panelSlider.value = saved; }
  else { document.documentElement.style.setProperty('--panel-alpha', '0.85'); }
  panelSlider.addEventListener('input', () => {
    const val = panelSlider.value;
    document.documentElement.style.setProperty('--panel-alpha', (val / 100).toFixed(2));
    localStorage.setItem('panelOpacity', val);
  });
}
