const CHARTS = {};

const state = {
  surfData: null,
  theme: 'light',
  chartRange: '7d',
  currency: 'usd',
  graphRaw: null,
  graphFetchedAt: 0,
  analyticsData: null,
  activityPage: 0,
  activityPageSize: 50,
  activityPerPage: 50,
  activityTotal: 0,
  holderSort: { col: 'balance', dir: 'desc' },
  positionSort: { col: 'collateral', dir: 'desc' },
  poolSort: { col: 'supplied', dir: 'desc' },
  filterAddr: '',
  filterPool: '',
  filterStatus: '',
  filterActivityType: '',
  filterActivityAddr: '',
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// Thousands separators, matching the accrued-interest column (1,574.337140).
function groupNum(v, decimals) {
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtUSD(v) {
  if (v == null || isNaN(v)) return '$0.00';
  return '$' + groupNum(v, Math.abs(v) >= 1e3 ? 0 : 2);
}

function fmtADA(v) {
  if (v == null || isNaN(v)) return '0 ADA';
  return groupNum(v, 2) + ' ADA';
}

// Chart axes keep the compact K/M/B forms: a grouped tick label crowds the plot.
function fmtUSDAxis(v) {
  if (v == null || isNaN(v)) return '$0';
  if (Math.abs(v) >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + v.toFixed(0);
}

function fmtADAAxis(v) {
  if (v == null || isNaN(v)) return '0';
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(0);
}

function fmtNumAxis(v) {
  if (v == null || isNaN(v)) return '0';
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(Math.round(v));
}

function fmtPct(v) {
  if (v == null || isNaN(v)) return '0%';
  return v.toFixed(2) + '%';
}

// API values are USD; convert to ADA for the currency toggle.
function fmtMoney(usdValue) {
  const adaPrice = state.surfData?.summary?.adaPrice || 0;
  if (state.currency === 'ada' && adaPrice > 0) return fmtADA(usdValue / adaPrice);
  return fmtUSD(usdValue);
}

// API ratios (0.1538) to percent
function fmtRatio(ratio) {
  if (ratio == null || isNaN(ratio)) return '—';
  return (ratio * 100).toFixed(2) + '%';
}

// Full numbers with thousands separators (fmtShort is for truncating address
// strings, not values).
function fmtNum(v) {
  if (v == null || isNaN(v)) return '0';
  const n = Number(v);
  return Number.isInteger(n) ? groupNum(n, 0) : groupNum(n, 2);
}

/* ---------- Loan health ---------- */

function poolFor(poolId) {
  return (state.surfData?.pools || []).find(p => p.poolId === poolId) || null;
}

// The liquidation threshold is what makes 1.0 the liquidation point. This
// reproduces surflending.org's own figure: 4,929 SURF collateral against 1,574 ADA
// of debt -> liquidation threshold 0.50 / LTV 0.9835 = 0.51 on both sites.
function liquidationThreshold(pos) {
  const pool = poolFor(pos.poolId);
  if (!pool) return 0;
  if (pos.collateralPolicyId) {
    const c = (pool.collateralAssets || []).find(x =>
      x.policyId === pos.collateralPolicyId && (x.assetName || '') === (pos.collateralAssetName || ''));
    return c?.liquidationThresholdLTV || c?.maxBorrowLTV || 0;
  }
  return pool.liquidationThresholdLTV || pool.maxBorrowLTV || 0;
}

function accruedInterestUsd(pos) {
  const decimals = pos.principalDecimals || 6;
  return ((pos.accruedInterest || 0) / Math.pow(10, decimals)) * (pos.principalPriceUSD || 0);
}

function fmtAdaPrecise(v) {
  if (v == null || isNaN(v)) return '0.000000 ADA';
  return groupNum(v, 6) + ' ADA';
}

// Accrued interest is reported in ADA, independent of the USD/ADA toggle.
function accruedInterestAda(pos) {
  const adaPrice = state.surfData?.summary?.adaPrice || 0;
  const usd = accruedInterestUsd(pos);
  return adaPrice > 0 ? usd / adaPrice : 0;
}

// LTV = Borrowed Value / Collateral Value. Principal only — accrued interest is
// reported on its own row. Null when there is no collateral to divide by.
function positionLtv(pos) {
  const collateral = pos.collateralValueUSD || 0;
  if (!(collateral > 0)) return null;
  return (pos.principalValueUSD || 0) / collateral;
}

// Health = Liquidation Threshold / LTV. Above 1 is safe; at or below 1 is the
// liquidation zone.
function positionHealth(pos) {
  const threshold = liquidationThreshold(pos);
  const ltv = positionLtv(pos);
  if (ltv == null || !(ltv > 0) || !(threshold > 0)) return null;
  return threshold / ltv;
}

function healthClass(health) {
  if (health == null) return '';
  if (health >= 1.5) return 'health-good';
  if (health >= 1.15) return 'health-ok';
  if (health >= 1) return 'health-warn';
  return 'health-bad';
}

function fmtShort(s, n = 8) {
  if (!s || s.length <= n * 2 + 3) return s || '';
  return s.slice(0, n) + '...' + s.slice(-n);
}

function shorten(s, n = 6) {
  return fmtShort(s, n);
}

function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast ' + type + ' show';
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3500);
}

const handleCache = new Map();

async function prefetchHandles(addresses) {
  const uncached = [...new Set(addresses.filter(a => a && (a.startsWith('addr') || a.startsWith('stake')) && !handleCache.has(a)))];
  if (uncached.length === 0) return;

  // 100 addresses is ~10 KB of query string, which proxies reject (414), so ask
  // in small batches and merge the maps.
  const BATCH = 25;
  const batches = [];
  for (let i = 0; i < uncached.length; i += BATCH) batches.push(uncached.slice(i, i + BATCH));

  await Promise.all(batches.map(async (batch) => {
    try {
      const res = await fetch('/api/resolve-handles?addresses=' + encodeURIComponent(batch.join(',')));
      if (!res.ok) return;
      const map = await res.json();
      for (const [addr, h] of Object.entries(map)) handleCache.set(addr, h);
    } catch {}
  }));
}

function displayAddr(address, fallback) {
  if (!address) return fallback || '';
  const h = handleCache.get(address);
  if (h) return h;
  return fallback || shorten(address, 6);
}

const ADA_LOGO = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#0033ad"/><text x="16" y="23" font-size="18" text-anchor="middle" fill="#fff" font-family="sans-serif">₳</text></svg>');

const tokenIconCache = new Map();

// Cardano Token Registry: /metadata/<policyId><assetName> returns a base64 logo.
async function fetchTokenIcon(policyId, assetName) {
  if (!policyId || !assetName) return null;
  const subject = policyId + assetName;
  if (tokenIconCache.has(subject)) return tokenIconCache.get(subject);
  try {
    const res = await fetch('https://tokens.cardano.org/metadata/' + subject);
    if (!res.ok) throw new Error('not found');
    const data = await res.json();
    const raw = data?.logo?.value || null;
    const icon = raw ? 'data:image/png;base64,' + raw : null;
    tokenIconCache.set(subject, icon);
    return icon;
  } catch {
    tokenIconCache.set(subject, null);
    return null;
  }
}

function tokenIcon(policyId, assetName) {
  if (!policyId) return ADA_LOGO;
  return tokenIconCache.get(policyId + (assetName || '')) || null;
}

async function prefetchTokenIcons(assets) {
  const unique = new Map();
  for (const a of assets) {
    if (a && a.policyId && a.assetName) unique.set(a.policyId + a.assetName, a);
  }
  await Promise.all([...unique.values()].map(a => fetchTokenIcon(a.policyId, a.assetName)));
}

/* ---------- Theme ---------- */

function toggleTheme() {
  const html = document.documentElement;
  html.classList.add('transitioning');
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  localStorage.setItem('surf_theme', isDark ? 'light' : 'dark');
  $('#themeBtn').textContent = isDark ? '☀' : '☾';
  state.theme = isDark ? 'light' : 'dark';
  setTimeout(() => html.classList.remove('transitioning'), 850);
}

function initTheme() {
  const saved = localStorage.getItem('surf_theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  if (!saved) localStorage.setItem('surf_theme', theme);
  $('#themeBtn').textContent = theme === 'dark' ? '☀' : '☾';
  state.theme = theme;
}

/* ---------- Data Fetching ---------- */

async function fetchSurfDashboard() {
  try {
    const params = new URLSearchParams();
    if (state.filterAddr) params.set('filterAddr', state.filterAddr);
    if (state.filterPool) params.set('filterPool', state.filterPool);
    if (state.filterStatus) params.set('filterStatus', state.filterStatus);
    params.set('range', state.chartRange);
    params.set('currency', state.currency);
    const res = await fetch('/api/surf-dashboard?' + params.toString());
    if (!res.ok) throw new Error('Failed to fetch SURF dashboard');
    state.surfData = await res.json();
    renderSurfSummary();
    renderSurfPoolFilter();
    renderSurfPositions();
    renderSurfPoolApys();
    renderPoolTable();
    renderAnalytics();
    renderSurfTokenStats();

    const assets = [];
    for (const p of state.surfData.pools || []) {
      assets.push(p.asset);
      for (const c of p.collateralAssets || []) assets.push(c);
    }
    for (const p of state.surfData.positions || []) {
      assets.push({ policyId: p.principalPolicyId, assetName: p.principalAssetName });
      assets.push({ policyId: p.collateralPolicyId, assetName: p.collateralAssetName });
    }
    const addrs = (state.surfData.positions || []).slice(0, 100).map(p => p.address).filter(Boolean);
    Promise.all([
      prefetchTokenIcons(assets).then(() => {
        renderSurfPoolApys();
        renderPoolTable();
        renderSurfPositions();
      }),
      prefetchHandles(addrs).then(() => renderSurfPositions()),
    ]);
  } catch (e) {
    console.error(e);
    $('#surfSummary').innerHTML = '<div class="empty-state"><strong>Could not load dashboard</strong><p>' + escHtml(e.message) + '</p></div>';
  }
}

/* ---------- Positions ---------- */

function renderSurfSummary() {
  const container = $('#surfSummary');
  const d = state.surfData;
  if (!d) { container.innerHTML = ''; return; }
  const s = d.summary || {};
  const atRisk = (d.positions || []).filter(p => positionStatus(p) === 'at_risk').length;
  const label = state.currency === 'usd' ? 'USD' : 'ADA';
  container.innerHTML = `
    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-label">Total Value Locked</div>
        <div class="summary-value">${fmtMoney(s.totalTVLUSD)}</div>
        <div class="summary-sub">${label}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Total Supplied</div>
        <div class="summary-value">${fmtMoney(s.totalSuppliedUSD)}</div>
        <div class="summary-sub">${(s.totalPools || 0) + ' pools'}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Total Borrowed</div>
        <div class="summary-value">${fmtMoney(s.totalBorrowedUSD)}</div>
        <div class="summary-sub">${label}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Total Collateral</div>
        <div class="summary-value">${fmtMoney(s.totalCollateralUSD)}</div>
        <div class="summary-sub">${label}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Active Positions</div>
        <div class="summary-value">${s.totalPositions || 0}</div>
        <div class="summary-sub">${atRisk + ' at risk (LTV ≥ 75%)'}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">SURF Price</div>
        <div class="summary-value">${fmtUSD(s.surfPriceUSD)}</div>
        <div class="summary-sub">${fmtADA(s.surfPrice || 0)}</div>
      </div>
    </div>`;
}

function renderSurfPoolFilter() {
  const sel = $('#poolFilter');
  const pools = state.surfData?.pools || [];
  const prev = sel.value;
  sel.innerHTML = '<option value="">All Pools</option>' +
    pools.map(p => `<option value="${escHtml(p.poolId)}">${escHtml((p.asset?.ticker || '?') + ' · ' + p.poolId.slice(0, 8))}</option>`).join('');
  sel.value = pools.some(p => p.poolId === prev) ? prev : '';
}

const HEALTH_WARN = 1.15;

// One source of truth for every colour in the row: the health score. Tinting rows
// from LTV instead made two positions with identical health look different,
// because the liquidation threshold varies by collateral asset.
function positionStatus(p) {
  const health = positionHealth(p);
  return health != null && health <= HEALTH_WARN ? 'at_risk' : 'active';
}

function positionRowClass(p) {
  const health = positionHealth(p);
  if (health == null) return '';
  if (health <= 1) return 'row-danger';
  if (health <= HEALTH_WARN) return 'row-warning';
  return '';
}

const POSITION_SORTS = {
  address: p => p.address || '',
  collateral: p => p.collateralValueUSD || 0,
  borrowed: p => p.principalValueUSD || 0,
  accrued: p => accruedInterestAda(p),
  ltv: p => positionLtv(p) ?? 0,
  health: p => positionHealth(p) ?? 999,
  rate: p => p.interestRate || 0,
  status: p => positionStatus(p),
};

function renderSurfPositions() {
  const container = $('#surfTableWrap');
  const d = state.surfData;
  if (!d || !d.positions) { container.innerHTML = ''; return; }

  let positions = [...d.positions];
  const { filterAddr, filterPool, filterStatus, positionSort } = state;

  if (filterAddr) {
    const q = filterAddr.toLowerCase();
    positions = positions.filter(p => (p.address || '').toLowerCase().includes(q));
  }
  if (filterPool) positions = positions.filter(p => p.poolId === filterPool);
  if (filterStatus) positions = positions.filter(p => positionStatus(p) === filterStatus);

  const { col, dir } = positionSort;
  const keyOf = POSITION_SORTS[col] || POSITION_SORTS.collateral;
  positions.sort((a, b) => {
    const av = keyOf(a), bv = keyOf(b);
    if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return dir === 'asc' ? av - bv : bv - av;
  });

  if (positions.length === 0) {
    container.innerHTML = '<div class="empty-state"><strong>No positions found</strong></div>';
    return;
  }

  const sortArrow = (key) => {
    if (positionSort.col === key) return positionSort.dir === 'asc' ? ' ▲' : ' ▼';
    return '';
  };

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th data-sort="address">Address<span class="sort-arrow">${sortArrow('address')}</span></th>
          <th data-sort="collateral">Collateral<span class="sort-arrow">${sortArrow('collateral')}</span></th>
          <th data-sort="borrowed">Debt<span class="sort-arrow">${sortArrow('borrowed')}</span></th>
          <th data-sort="accrued">Accrued (ADA)<span class="sort-arrow">${sortArrow('accrued')}</span></th>
          <th data-sort="ltv" title="LTV = Borrowed value ÷ Collateral value">LTV<span class="sort-arrow">${sortArrow('ltv')}</span></th>
          <th data-sort="health">Health<span class="sort-arrow">${sortArrow('health')}</span></th>
          <th data-sort="rate">Rate<span class="sort-arrow">${sortArrow('rate')}</span></th>
          <th data-sort="status">Status<span class="sort-arrow">${sortArrow('status')}</span></th>
        </tr>
      </thead>
      <tbody>
        ${positions.map(p => {
          const ltv = positionLtv(p);
          const status = positionStatus(p);
          const health = positionHealth(p);
          const threshold = liquidationThreshold(p);
          const rowClass = positionRowClass(p);
          const healthTitle = health == null
            ? 'Liquidation threshold unavailable for this pool'
            : `Health = Liquidation threshold (${fmtRatio(threshold)}) / LTV (${fmtRatio(ltv)})`;
          return `
            <tr class="${rowClass}">
              <td>${escHtml(displayAddr(p.address, shorten(p.address || '', 8)))}</td>
              <td>${fmtMoney(p.collateralValueUSD)} ${tokenCell(p.collateralPolicyId, p.collateralAssetName, p.collateralTicker)}</td>
              <td>${fmtMoney(p.principalValueUSD)} ${tokenCell(p.principalPolicyId, p.principalAssetName, p.principalTicker)}</td>
              <td class="txt-muted">${fmtAdaPrecise(accruedInterestAda(p))}</td>
              <td title="LTV = Borrowed value ÷ Collateral value">${ltv == null ? '—' : fmtRatio(ltv)}</td>
              <td><span class="health ${healthClass(health)}" title="${escHtml(healthTitle)}">${health == null ? '—' : health.toFixed(2)}</span></td>
              <td>${fmtRatio(p.interestRate)}</td>
              <td><span class="status-badge status-${status}">${escHtml(status.replace('_', ' '))}</span></td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div class="table-note">LTV = Borrowed value ÷ Collateral value · Health = Liquidation threshold ÷ LTV · above 1 is safe, at or below 1 is the liquidation zone.</div>`;

  container.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.positionSort.col === key) {
        state.positionSort.dir = state.positionSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.positionSort.col = key;
        state.positionSort.dir = 'desc';
      }
      renderSurfPositions();
    });
  });
}

function renderSurfPoolApys() {
  const container = $('#surfPoolApys');
  const pools = [...(state.surfData?.pools || [])]
    .filter(p => (p.totalSupplied || 0) > 0)
    .sort((a, b) => (b.supplyApyTotal || 0) - (a.supplyApyTotal || 0))
    .slice(0, 12);
  if (pools.length === 0) { container.innerHTML = ''; return; }

  container.innerHTML = `
    <div class="apy-grid">
      ${pools.map(p => {
        const icon = assetIcon(p.asset);
        return `
          <div class="apy-card">
            <div class="apy-card-title">${icon ? `<img class="token-icon-sm" src="${escHtml(icon)}" alt="">` : ''}${escHtml(p.asset?.ticker || '?')}</div>
            <div class="apy-row">
              <span class="apy-label">Supply APY</span>
              <span class="apy-value pos">${fmtRatio(p.supplyApyTotal)}</span>
            </div>
            <div class="apy-row">
              <span class="apy-label">Borrow APR</span>
              <span class="apy-value">${fmtRatio(p.borrowApr)}</span>
            </div>
            <div class="apy-row">
              <span class="apy-label">Utilization</span>
              <span class="apy-value">${fmtRatio(p.utilizationRate)}</span>
            </div>
            <div class="apy-row">
              <span class="apy-label">Max LTV</span>
              <span class="apy-value">${fmtRatio(p.maxBorrowLTV)}</span>
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

/* ---------- Pools ---------- */

function assetIcon(asset) {
  if (!asset || !asset.policyId) return ADA_LOGO;
  return tokenIcon(asset.policyId, asset.assetName);
}

function tokenCell(policyId, assetName, ticker) {
  const icon = tokenIcon(policyId, assetName);
  return (icon ? `<img class="token-icon-sm" src="${escHtml(icon)}" alt="">` : '') + escHtml(ticker || '');
}

function poolLabel(p) {
  const base = p.asset?.ticker || '?';
  const colls = (p.collateralAssets || []).map(c => c.ticker).filter(Boolean);
  if (colls.length === 0) return base;
  return base + '/' + colls.slice(0, 2).join('+') + (colls.length > 2 ? '…' : '');
}

function poolIconPile(p) {
  const icons = [assetIcon(p.asset)];
  for (const c of (p.collateralAssets || []).slice(0, 2)) icons.push(assetIcon(c));
  const imgs = icons.filter(Boolean).map(src => `<img class="pool-icon" src="${escHtml(src)}" alt="">`);
  if (imgs.length === 0) {
    return `<div class="pool-icon-pile"><div class="pool-icon" style="display:flex;align-items:center;justify-content:center;font-size:0.6rem;background:var(--surface2)">${escHtml((p.asset?.ticker || '?').slice(0, 4))}</div></div>`;
  }
  return `<span class="pool-icon-pile">${imgs.join('')}</span>`;
}

const POOL_SORTS = {
  pool: p => (p.asset?.ticker || '') + p.poolId,
  collateral: p => (p.collateralAssets || []).map(c => c.ticker).join(','),
  supplied: p => p.totalSuppliedUSD || 0,
  borrowed: p => p.totalBorrowedUSD || 0,
  utilization: p => p.utilizationRate || 0,
  supplyApy: p => p.supplyApyTotal || 0,
  borrowApr: p => p.borrowApr || 0,
  maxLtv: p => p.maxBorrowLTV || 0,
};

function renderPoolTable() {
  const container = $('#poolTableWrap');
  if (!container) return;
  const pools = [...(state.surfData?.pools || [])];
  if (pools.length === 0) {
    container.innerHTML = '<div class="empty-state"><strong>No pool data</strong></div>';
    return;
  }

  const { col, dir } = state.poolSort;
  const keyOf = POOL_SORTS[col] || POOL_SORTS.supplied;
  pools.sort((a, b) => {
    const av = keyOf(a), bv = keyOf(b);
    if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return dir === 'asc' ? av - bv : bv - av;
  });
  const sortArrow = (key) => (state.poolSort.col === key ? (state.poolSort.dir === 'asc' ? ' ▲' : ' ▼') : '');

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th data-sort="pool">Pool<span class="sort-arrow">${sortArrow('pool')}</span></th>
          <th data-sort="collateral">Collateral<span class="sort-arrow">${sortArrow('collateral')}</span></th>
          <th data-sort="supplied">Supplied<span class="sort-arrow">${sortArrow('supplied')}</span></th>
          <th data-sort="borrowed">Borrowed<span class="sort-arrow">${sortArrow('borrowed')}</span></th>
          <th data-sort="utilization">Utilization<span class="sort-arrow">${sortArrow('utilization')}</span></th>
          <th data-sort="supplyApy">Supply APY<span class="sort-arrow">${sortArrow('supplyApy')}</span></th>
          <th data-sort="borrowApr">Borrow APR<span class="sort-arrow">${sortArrow('borrowApr')}</span></th>
          <th data-sort="maxLtv">Max LTV<span class="sort-arrow">${sortArrow('maxLtv')}</span></th>
        </tr>
      </thead>
      <tbody>
        ${pools.map(p => `
            <tr>
              <td><span class="pool-cell">${poolIconPile(p)}${escHtml(poolLabel(p))}</span></td>
              <td><span class="coll-tags">${(p.collateralAssets || []).map(c => {
                const icon = assetIcon(c);
                return `<span class="coll-tag">${icon ? `<img class="token-icon-sm" src="${escHtml(icon)}" alt="">` : ''}${escHtml(c.ticker || '?')}</span>`;
              }).join('') || '<span class="txt-muted">—</span>'}</span></td>
              <td>${fmtMoney(p.totalSuppliedUSD)}</td>
              <td>${fmtMoney(p.totalBorrowedUSD)}</td>
              <td>${fmtRatio(p.utilizationRate)}</td>
              <td class="txt-success">${fmtRatio(p.supplyApyTotal)}</td>
              <td>${fmtRatio(p.borrowApr)}</td>
              <td>${fmtRatio(p.maxBorrowLTV)} <span class="txt-muted" style="font-size:0.65rem">liq ${fmtRatio(p.liquidationThresholdLTV)}</span></td>
            </tr>`).join('')}
      </tbody>
    </table>`;

  container.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.poolSort.col === key) {
        state.poolSort.dir = state.poolSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.poolSort.col = key;
        state.poolSort.dir = 'desc';
      }
      renderPoolTable();
    });
  });
}

/* ---------- Analytics ---------- */

async function loadGraphData() {
  const FRESH_MS = 5 * 60 * 1000;
  if (state.graphRaw && Date.now() - state.graphFetchedAt < FRESH_MS) return state.graphRaw;
  let snapshots = [];
  let poolSnapshots = [];
  try {
    const [protoRes, poolRes] = await Promise.all([
      fetch('/api/graph?type=protocol'),
      fetch('/api/graph?type=pools'),
    ]);
    if (protoRes.ok) {
      const proto = await protoRes.json();
      snapshots = Array.isArray(proto?.snapshots) ? proto.snapshots : [];
    }
    if (poolRes.ok) {
      const pools = await poolRes.json();
      poolSnapshots = Array.isArray(pools) ? pools : [];
    }
  } catch {}
  state.graphRaw = { snapshots, poolSnapshots };
  state.graphFetchedAt = Date.now();
  return state.graphRaw;
}

function rangeCutoff() {
  const now = Date.now();
  if (state.chartRange === '24h') return now - 864e5;
  if (state.chartRange === '7d') return now - 7 * 864e5;
  if (state.chartRange === '30d') return now - 30 * 864e5;
  return 0;
}

function snapshotLabel(iso) {
  const dt = new Date(iso);
  if (state.chartRange === '24h' || state.chartRange === '7d') {
    return dt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' });
  }
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Reshape /api/graph rows into the series the chart renderers expect.
function buildAnalytics(raw) {
  const adaPrice = state.surfData?.summary?.adaPrice || 0;
  const scale = (usd) => (state.currency === 'ada' && adaPrice > 0 ? (usd || 0) / adaPrice : (usd || 0));
  const cutoff = rangeCutoff();
  const rows = (raw.snapshots || [])
    .filter(r => new Date(r.snapshot_at).getTime() >= cutoff)
    .sort((a, b) => new Date(a.snapshot_at) - new Date(b.snapshot_at));
  if (rows.length === 0) return null;

  const labels = rows.map(r => snapshotLabel(r.snapshot_at));
  const first = rows[0];
  const last = rows[rows.length - 1];
  const tvlOf = (r) => scale((r.total_supplied_usd || 0) + (r.total_collateral_usd || 0) - (r.total_borrowed_usd || 0));
  const firstTvl = tvlOf(first);
  const lastTvl = tvlOf(last);

  // latest snapshot per pool, for the composition charts
  const latestPerPool = new Map();
  for (const r of raw.poolSnapshots || []) {
    const t = new Date(r.snapshot_at).getTime();
    if (Number.isNaN(t) || t < cutoff) continue;
    const prev = latestPerPool.get(r.pool_id);
    if (!prev || t > prev.t) latestPerPool.set(r.pool_id, { t, row: r });
  }
  const byTicker = new Map();
  for (const { row } of latestPerPool.values()) {
    const ticker = row.ticker || '?';
    const agg = byTicker.get(ticker) || { supply: 0, borrow: 0 };
    agg.supply += scale(row.total_supplied_usd);
    agg.borrow += scale(row.total_borrowed_usd);
    byTicker.set(ticker, agg);
  }
  const ranked = [...byTicker.entries()].sort((a, b) => b[1].supply - a[1].supply);
  const top = ranked.slice(0, 7);
  const rest = ranked.slice(7);
  const compLabels = top.map(([ticker]) => ticker);
  const compValues = top.map(([, v]) => v.supply);
  if (rest.length > 0) {
    compLabels.push('Other');
    compValues.push(rest.reduce((s, [, v]) => s + v.supply, 0));
  }

  return {
    summary: {
      tvl: lastTvl,
      totalSupplied: scale(last.total_supplied_usd),
      totalBorrowed: scale(last.total_borrowed_usd),
      activeLoans: last.total_positions || 0,
      avgLtv: (last.avg_ltv || 0) * 100,
      avgApr: (last.avg_borrow_apr || 0) * 100,
      tvlChange: firstTvl > 0 ? ((lastTvl - firstTvl) / firstTvl) * 100 : 0,
    },
    tvlHistory: { labels, values: rows.map(tvlOf) },
    tvlComposition: { labels: compLabels, values: compValues },
    borrowSupplyHistory: {
      labels,
      supplied: rows.map(r => scale(r.total_supplied_usd)),
      borrowed: rows.map(r => scale(r.total_borrowed_usd)),
    },
    ltvAprHistory: {
      labels,
      ltv: rows.map(r => (r.avg_ltv || 0) * 100),
      apr: rows.map(r => (r.avg_borrow_apr || 0) * 100),
    },
    marketComposition: {
      labels: compLabels,
      supply: compValues,
      borrow: top.map(([, v]) => v.borrow).concat(
        rest.length > 0 ? [rest.reduce((s, [, v]) => s + v.borrow, 0)] : []
      ),
    },
    revenueHistory: {
      labels,
      interest: rows.map(r => scale(r.total_unpaid_interest_usd)),
      liquidation: rows.map(() => 0),
      fees: rows.map(r => scale(r.total_reserve_usd)),
    },
    stakingHistory: null,
  };
}

async function renderAnalytics() {
  state.analyticsData = buildAnalytics(await loadGraphData());
  Object.keys(CHARTS).forEach(id => { CHARTS[id].destroy(); delete CHARTS[id]; });
  if (!state.analyticsData) {
    $('#analyticsSummary').innerHTML = '<div class="empty-state"><strong>No history yet</strong><p>Charts build up once the hourly snapshot cron runs against the database.</p></div>';
    return;
  }
  renderAnalyticsSummary();
  renderTvlChart();
  renderTvlCompChart();
  renderBorrowSupplyChart();
  renderLtvAprChart();
  renderMarketCompChart();
  renderRevenueChart();
  renderStakingChart();
  const stakingCard = $('#stakingChartCard');
  if (stakingCard) stakingCard.style.display = state.analyticsData.stakingHistory ? '' : 'none';
}

function renderAnalyticsSummary() {
  const container = $('#analyticsSummary');
  const d = state.analyticsData;
  if (!d) { container.innerHTML = ''; return; }
  const a = d.summary || d;
  const usd = state.currency === 'usd';
  const fmt = usd ? fmtUSD : fmtADA;
  container.innerHTML = `
    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-label">Total Value Locked</div>
        <div class="summary-value">${fmt(a.tvl)}</div>
        <div class="summary-sub">${a.tvlChange != null ? (a.tvlChange >= 0 ? '+' : '') + fmtPct(a.tvlChange) : ''}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Total Supplied</div>
        <div class="summary-value">${fmt(a.totalSupplied)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Total Borrowed</div>
        <div class="summary-value">${fmt(a.totalBorrowed)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Active Loans</div>
        <div class="summary-value">${a.activeLoans || 0}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Avg LTV</div>
        <div class="summary-value">${fmtPct(a.avgLtv)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Avg APR</div>
        <div class="summary-value">${fmtPct(a.avgApr)}</div>
      </div>
    </div>`;
}

function getChartCtx(id) {
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  if (CHARTS[id]) { CHARTS[id].destroy(); delete CHARTS[id]; }
  return canvas.getContext('2d');
}

const chartColors = {
  primary: '#0891b2',
  secondary: '#22d3ee',
  green: '#22c55e',
  red: '#ef4444',
  yellow: '#f59e0b',
  purple: '#8b5cf6',
  pink: '#ec4899',
  blue: '#3b82f6',
  orange: '#f97316',
  teal: '#14b8a6',
};

function chartTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    grid: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)',
    text: isDark ? '#a3a3a3' : '#737373',
  };
}

function renderTvlChart() {
  const ctx = getChartCtx('tvlChart');
  if (!ctx) return;
  const data = state.analyticsData?.tvlHistory;
  if (!data) return;
  const t = chartTheme();
  CHARTS.tvlChart = new Chart(ctx, {
    type: 'line',
    data: { labels: data.labels, datasets: [{ label: 'TVL', data: data.values, borderColor: chartColors.primary, backgroundColor: chartColors.primary + '20', fill: true, tension: 0.3, pointRadius: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: t.grid }, ticks: { color: t.text, maxTicksLimit: 8 } }, y: { grid: { color: t.grid }, ticks: { color: t.text, callback: v => state.currency === 'usd' ? fmtUSDAxis(v) : fmtADAAxis(v) } } } },
  });
}

// One colour per slice, sized to the label count, with the aggregated "Other"
// bucket always grey so it stays visible in the legend.
const COMP_COLORS = ['#0891b2', '#22d3ee', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#3b82f6', '#f97316', '#14b8a6'];

function compositionColors(labels) {
  let i = 0;
  return labels.map(l => (l === 'Other' ? '#a3a3a3' : COMP_COLORS[i++ % COMP_COLORS.length]));
}

function renderTvlCompChart() {
  const ctx = getChartCtx('tvlCompChart');
  if (!ctx) return;
  const data = state.analyticsData?.tvlComposition;
  if (!data) return;
  CHARTS.tvlCompChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: data.labels, datasets: [{ data: data.values, backgroundColor: compositionColors(data.labels), borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: chartTheme().text, boxWidth: 10, padding: 8, font: { size: 10 } } } } },
  });
}

function renderBorrowSupplyChart() {
  const ctx = getChartCtx('borrowSupplyChart');
  if (!ctx) return;
  const data = state.analyticsData?.borrowSupplyHistory;
  if (!data) return;
  const t = chartTheme();
  CHARTS.borrowSupplyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.labels,
      datasets: [
        { label: 'Supplied', data: data.supplied, borderColor: chartColors.green, backgroundColor: chartColors.green + '20', fill: true, tension: 0.3, pointRadius: 0 },
        { label: 'Borrowed', data: data.borrowed, borderColor: chartColors.red, backgroundColor: chartColors.red + '20', fill: true, tension: 0.3, pointRadius: 0 },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: t.text, boxWidth: 10, padding: 8, font: { size: 10 } } } }, scales: { x: { grid: { color: t.grid }, ticks: { color: t.text, maxTicksLimit: 8 } }, y: { grid: { color: t.grid }, ticks: { color: t.text, callback: v => state.currency === 'usd' ? fmtUSDAxis(v) : fmtADAAxis(v) } } } },
  });
}

function renderLtvAprChart() {
  const ctx = getChartCtx('ltvAprChart');
  if (!ctx) return;
  const data = state.analyticsData?.ltvAprHistory;
  if (!data) return;
  const t = chartTheme();
  CHARTS.ltvAprChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.labels,
      datasets: [
        { label: 'Avg LTV', data: data.ltv, borderColor: chartColors.yellow, tension: 0.3, pointRadius: 0, yAxisID: 'y' },
        { label: 'Avg APR', data: data.apr, borderColor: chartColors.primary, tension: 0.3, pointRadius: 0, yAxisID: 'y1' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: t.text, boxWidth: 10, padding: 8, font: { size: 10 } } } },
      scales: {
        x: { grid: { color: t.grid }, ticks: { color: t.text, maxTicksLimit: 8 } },
        y: { position: 'left', grid: { color: t.grid }, ticks: { color: t.text, callback: v => v.toFixed(1) + '%' }, title: { display: true, text: 'LTV', color: t.text, font: { size: 10 } } },
        y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: t.text, callback: v => v.toFixed(1) + '%' }, title: { display: true, text: 'APR', color: t.text, font: { size: 10 } } },
      },
    },
  });
}

function renderMarketCompChart() {
  const ctx = getChartCtx('marketCompChart');
  if (!ctx) return;
  const data = state.analyticsData?.marketComposition;
  if (!data) return;
  const colors = compositionColors(data.labels);
  CHARTS.marketCompChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: [
        { label: 'Supply', data: data.supply, backgroundColor: colors.map(c => c + '80'), borderColor: colors, borderWidth: 1 },
        { label: 'Borrow', data: data.borrow, backgroundColor: colors.map(c => c + '40'), borderColor: colors, borderWidth: 1 },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: chartTheme().text, boxWidth: 10, padding: 8, font: { size: 10 } } } }, scales: { x: { grid: { color: chartTheme().grid }, ticks: { color: chartTheme().text } }, y: { grid: { color: chartTheme().grid }, ticks: { color: chartTheme().text, callback: v => state.currency === 'usd' ? fmtUSDAxis(v) : fmtADAAxis(v) } } } },
  });
}

function renderRevenueChart() {
  const ctx = getChartCtx('revenueChart');
  if (!ctx) return;
  const data = state.analyticsData?.revenueHistory;
  if (!data) return;
  const t = chartTheme();
  CHARTS.revenueChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: [
        { label: 'Interest', data: data.interest, backgroundColor: chartColors.primary + '80', borderColor: chartColors.primary, borderWidth: 1 },
        { label: 'Liquidation', data: data.liquidation, backgroundColor: chartColors.red + '80', borderColor: chartColors.red, borderWidth: 1 },
        { label: 'Fees', data: data.fees, backgroundColor: chartColors.green + '80', borderColor: chartColors.green, borderWidth: 1 },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: t.text, boxWidth: 10, padding: 8, font: { size: 10 } } } }, scales: { x: { stacked: true, grid: { color: t.grid }, ticks: { color: t.text, maxTicksLimit: 8 } }, y: { stacked: true, grid: { color: t.grid }, ticks: { color: t.text, callback: v => state.currency === 'usd' ? fmtUSDAxis(v) : fmtADAAxis(v) } } } },
  });
}

function renderStakingChart() {
  const ctx = getChartCtx('stakingChart');
  if (!ctx) return;
  const data = state.analyticsData?.stakingHistory;
  if (!data) return;
  const t = chartTheme();
  CHARTS.stakingChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.labels,
      datasets: [
        { label: 'SURF Staked', data: data.staked, borderColor: chartColors.purple, backgroundColor: chartColors.purple + '20', fill: true, tension: 0.3, pointRadius: 0 },
        { label: 'Stakers', data: data.stakers, borderColor: chartColors.primary, backgroundColor: chartColors.primary + '20', fill: true, tension: 0.3, pointRadius: 0, yAxisID: 'y1' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: t.text, boxWidth: 10, padding: 8, font: { size: 10 } } } },
      scales: {
        x: { grid: { color: t.grid }, ticks: { color: t.text, maxTicksLimit: 8 } },
        y: { position: 'left', grid: { color: t.grid }, ticks: { color: t.text, callback: v => fmtNumAxis(v) }, title: { display: true, text: 'SURF', color: t.text, font: { size: 10 } } },
        y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: t.text } },
      },
    },
  });
}

/* ---------- Activity ---------- */

const ACTIVITY_TYPE_CLASSES = {
  'deposit': 'act-deposit',
  'withdraw': 'act-withdraw',
  'borrow': 'act-borrow',
  'repay': 'act-repay',
  'repay with collateral': 'act-repaycoll',
  'leveraged borrow': 'act-leverage',
  'add collateral': 'act-collateral',
  'remove collateral': 'act-collateral',
  'liquidate': 'act-liquidate',
  'liquidation': 'act-liquidate',
};

function activityTypeClass(type) {
  return ACTIVITY_TYPE_CLASSES[(type || '').toLowerCase()] || 'act-other';
}

// Activity rows carry the asset subject (policyId + assetName hex); '' means ADA.
function subjectIcon(subject) {
  if (!subject || subject.length <= 56) return ADA_LOGO;
  return tokenIcon(subject.slice(0, 56), subject.slice(56)) || null;
}

function activityAssets(items) {
  const out = [];
  for (const a of items) {
    for (const subject of [a.asset, a.collateral_asset]) {
      if (subject && subject.length > 56) {
        out.push({ policyId: subject.slice(0, 56), assetName: subject.slice(56) });
      }
    }
  }
  return out;
}

async function fetchActivity(page = 0) {
  try {
    const params = new URLSearchParams();
    params.set('page', page + 1);
    params.set('per_page', state.activityPageSize);
    if (state.filterActivityType) params.set('type', state.filterActivityType);
    if (state.filterActivityAddr) params.set('address', state.filterActivityAddr);
    const res = await fetch('/api/activity?' + params.toString());
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to fetch activity');
    }
    const payload = await res.json();
    state.activityPage = page;
    state.activityTotal = payload.total || 0;
    state.activityPerPage = payload.per_page || state.activityPageSize;
    const items = payload.data || [];
    renderActivity(items);
    Promise.all([
      prefetchTokenIcons(activityAssets(items)),
      prefetchHandles(items.map(a => a.address).filter(Boolean).slice(0, 100)),
    ]).then(() => renderActivity(items));
    renderActivityPagination();
  } catch (e) {
    $('#activityList').innerHTML = '<div class="empty-state"><strong>Could not load activity</strong><p>' + escHtml(e.message) + '</p></div>';
    $('#activityPagination').innerHTML = '';
  }
}

function renderActivity(items) {
  const container = $('#activityList');
  if (!items || items.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No activity found.</p></div>';
    return;
  }
  container.innerHTML = items.map(a => {
    const type = a.activity_type || '?';
    const amountIcon = subjectIcon(a.asset);
    const collIcon = subjectIcon(a.collateral_asset);
    const hasCollateral = Number(a.collateral_amount) > 0 && a.collateral_ticker;
    const amountText = Number(a.amount) > 0 ? `${a.amount_fmt} ${a.asset_ticker || ''}`.trim() : '';
    const collText = hasCollateral ? `${a.collateral_fmt} ${a.collateral_ticker}`.trim() : '';
    const link = a.tx_hash ? 'https://cardanoscan.io/transaction/' + a.tx_hash : '';
    return `
      <div class="activity-row">
        <span class="act-type ${activityTypeClass(type)}" title="${escHtml(type)}">${escHtml(type)}</span>
        <span class="act-user" title="${escHtml(a.address || '')}">${escHtml(displayAddr(a.address, a.address_short || shorten(a.address || '', 6)))}</span>
        <span class="act-amount">${amountIcon ? `<img class="token-icon" src="${escHtml(amountIcon)}" alt="">` : ''}${escHtml(amountText || '—')}</span>
        <span class="act-collateral">${collText ? (collIcon ? `<img class="token-icon" src="${escHtml(collIcon)}" alt="">` : '') + escHtml(collText) : '<span class="txt-muted">—</span>'}</span>
        <span class="act-time">${escHtml(a.time_ago || '')}</span>
        <span class="act-link">${link ? `<a href="${link}" target="_blank" rel="noopener">View</a>` : '<span class="txt-muted">—</span>'}</span>
      </div>`;
  }).join('');
}

function renderActivityPagination() {
  const container = $('#activityPagination');
  const perPage = state.activityPerPage || state.activityPageSize;
  const totalPages = Math.ceil(state.activityTotal / perPage);
  const current = state.activityPage;
  if (totalPages <= 1) { container.innerHTML = ''; return; }
  const pages = [];
  const start = Math.max(0, current - 2);
  const end = Math.min(totalPages - 1, current + 2);
  for (let i = start; i <= end; i++) pages.push(i);
  container.innerHTML = `
    <button class="btn btn-sm" ${current === 0 ? 'disabled' : ''} id="prevPage">← Prev</button>
    ${pages.map(p => `<button class="btn btn-sm ${p === current ? 'active' : ''}" data-page="${p}">${p + 1}</button>`).join('')}
    <button class="btn btn-sm" ${current >= totalPages - 1 ? 'disabled' : ''} id="nextPage">Next →</button>`;
  container.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => fetchActivity(parseInt(btn.dataset.page)));
  });
  $('#prevPage')?.addEventListener('click', () => fetchActivity(current - 1));
  $('#nextPage')?.addEventListener('click', () => fetchActivity(current + 1));
}

/* ---------- SURF Token ---------- */

function renderSurfTokenStats() {
  const d = state.surfData?.token;
  renderSurfTokenSummary(d);
  renderSurfTokenDetails(d);
  const holders = d?.topHolders || [];
  renderTokenHolders(holders);
  renderTokenDistChart(holders);
  prefetchHandles(holders.map(h => h.address)).then(() => {
    renderTokenHolders(holders);
    renderTokenDistChart(holders);
  });
}

function renderSurfTokenSummary(d) {
  const container = $('#surfTokenSummary');
  const s = state.surfData?.summary || {};
  const staking = state.surfData?.staking?.info || {};
  const staked = (staking.totalLiveStake || 0) / 1e6;
  const supply = d?.totalSupply || 0;
  container.innerHTML = `
    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-label">SURF Price</div>
        <div class="summary-value">${fmtUSD(s.surfPriceUSD)}</div>
        <div class="summary-sub">${fmtADA(s.surfPrice || 0)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Market Cap</div>
        <div class="summary-value">${supply ? fmtUSD((s.surfPriceUSD || 0) * supply) : '—'}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Total Supply</div>
        <div class="summary-value">${supply ? fmtNum(supply) : '—'}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Staked</div>
        <div class="summary-value">${fmtNum(staked)}</div>
        <div class="summary-sub">${supply ? fmtPct((staked / supply) * 100) + ' of supply' : 'live stake'}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Holders</div>
        <div class="summary-value">${d?.holders != null ? (d.truncated ? fmtNum(d.holders) + '+' : d.holders) : '—'}</div>
      </div>
    </div>`;
}

function renderSurfTokenDetails(d) {
  const container = $('#surfTokenDetails');
  const t = d || {};
  const s = state.surfData?.summary || {};
  container.innerHTML = `
    <div class="token-detail-grid">
      <div class="token-detail-card">
        <div class="token-detail-label">Token</div>
        <div class="token-detail-value">${escHtml(t.name || 'SURF')}</div>
      </div>
      <div class="token-detail-card">
        <div class="token-detail-label">Ticker</div>
        <div class="token-detail-value">${escHtml(t.ticker || 'SURF')}</div>
      </div>
      <div class="token-detail-card">
        <div class="token-detail-label">Decimals</div>
        <div class="token-detail-value">${t.decimals != null ? t.decimals : 6}</div>
      </div>
      <div class="token-detail-card">
        <div class="token-detail-label">Policy ID</div>
        <div class="token-detail-value" style="font-size:0.7rem">${escHtml(shorten(t.policyId || '', 12))}</div>
      </div>
      <div class="token-detail-card">
        <div class="token-detail-label">ADA Price</div>
        <div class="token-detail-value">${fmtADA(s.surfPrice || 0)}</div>
      </div>
      <div class="token-detail-card">
        <div class="token-detail-label">Staking Period</div>
        <div class="token-detail-value">${(state.surfData?.staking?.info?.stakingPeriodInDays || 0) + ' days'}</div>
      </div>
    </div>`;
}

function renderTokenHolders(holders) {
  const container = $('#holderTableWrap');
  if (!holders || holders.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No holder data available.</p></div>';
    return;
  }
  const { col, dir } = state.holderSort;
  const sorted = [...holders].sort((a, b) => {
    let av = a[col], bv = b[col];
    if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    av = Number(av) || 0; bv = Number(bv) || 0;
    return dir === 'asc' ? av - bv : bv - av;
  });
  const total = sorted.reduce((s, h) => s + (Number(h.balance) || 0), 0);
  const sortArrow = (key) => {
    if (state.holderSort.col === key) return state.holderSort.dir === 'asc' ? ' ▲' : ' ▼';
    return '';
  };
  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th data-sort="address">Address<span class="sort-arrow">${sortArrow('address')}</span></th>
          <th data-sort="balance">Balance<span class="sort-arrow">${sortArrow('balance')}</span></th>
          <th data-sort="balance">Share<span class="sort-arrow">${sortArrow('balance')}</span></th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map((h, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${escHtml(displayAddr(h.address, shorten(h.address, 10)))}</td>
            <td>${fmtNum(h.balance)}</td>
            <td>${fmtPct((Number(h.balance) / total) * 100)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  container.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.holderSort.col === key) {
        state.holderSort.dir = state.holderSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.holderSort.col = key;
        state.holderSort.dir = 'desc';
      }
      renderTokenHolders(holders);
    });
  });
}

function renderTokenDistChart(holders) {
  const ctx = getChartCtx('distChart');
  if (!ctx) return;
  if (!holders || holders.length === 0) return;
  const top10 = holders.slice(0, 10);
  const otherBalance = holders.slice(10).reduce((s, h) => s + (Number(h.balance) || 0), 0);
  const labels = [...top10.map(h => displayAddr(h.address, shorten(h.address, 6))), 'Others'];
  const values = [...top10.map(h => Number(h.balance) || 0), otherBalance];
  const colors = ['#0891b2', '#22d3ee', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#3b82f6', '#f97316', '#14b8a6', '#ef4444', '#a3a3a3'];
  CHARTS.distChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors.slice(0, labels.length), borderWidth: 1, borderColor: 'var(--surface)' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: chartTheme().text, boxWidth: 10, padding: 8, font: { size: 9 } } } } },
  });
}

/* ---------- Tab Switching ---------- */

$$('.tab').forEach(tab => {
  tab.addEventListener('click', async () => {
    $$('.tab').forEach(t => t.classList.remove('tab-active'));
    tab.classList.add('tab-active');
    const view = tab.dataset.view;
    ['positions', 'analytics', 'pools', 'activity', 'surf'].forEach(v => {
      $(`#${v}View`).style.display = v === view ? '' : 'none';
    });
    if (view === 'activity') {
      fetchActivity(0);
    }
    if (view === 'analytics' || view === 'pools' || view === 'surf' || view === 'positions') {
      if (state.surfData) {
        if (view === 'positions') renderSurfPositions();
        if (view === 'pools') renderPoolTable();
        if (view === 'analytics') renderAnalytics();
        if (view === 'surf') renderSurfTokenStats();
      }
    }
    if (view === 'analytics' && typeof Chart !== 'undefined') {
      renderAnalytics();
    }
  });
});

/* ---------- Init ---------- */

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  fetchSurfDashboard();
  $('#themeBtn')?.addEventListener('click', toggleTheme);

  $('#addrFilter')?.addEventListener('input', (e) => {
    state.filterAddr = e.target.value;
    fetchSurfDashboard();
  });
  $('#poolFilter')?.addEventListener('change', (e) => {
    state.filterPool = e.target.value;
    fetchSurfDashboard();
  });
  $('#statusFilter')?.addEventListener('change', (e) => {
    state.filterStatus = e.target.value;
    fetchSurfDashboard();
  });

  $$('.range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.chartRange = btn.dataset.range;
      fetchSurfDashboard();
    });
  });

  $$('.curr-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.curr-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currency = btn.dataset.curr;
      fetchSurfDashboard();
    });
  });

  $('#activityTypeFilter')?.addEventListener('change', (e) => {
    state.filterActivityType = e.target.value;
    fetchActivity(0);
  });
  $('#activityAddrFilter')?.addEventListener('input', (e) => {
    state.filterActivityAddr = e.target.value;
    fetchActivity(0);
  });

});
