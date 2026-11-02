import { bech32 } from 'bech32';

const WALLET_LOGOS = {
  eternl: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#7c3aed"/><text x="16" y="22" font-size="16" text-anchor="middle" fill="white" font-weight="bold">E</text></svg>'),
  nami: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#f7931a"/><text x="16" y="22" font-size="16" text-anchor="middle" fill="white" font-weight="bold">N</text></svg>'),
  lace: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#00b4d8"/><text x="16" y="22" font-size="16" text-anchor="middle" fill="white" font-weight="bold">L</text></svg>'),
  flint: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#f43f5e"/><text x="16" y="22" font-size="16" text-anchor="middle" fill="white" font-weight="bold">F</text></svg>'),
  gerowallet: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#10b981"/><text x="16" y="22" font-size="16" text-anchor="middle" fill="white" font-weight="bold">G</text></svg>'),
  typhoncip30: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#6366f1"/><text x="16" y="22" font-size="16" text-anchor="middle" fill="white" font-weight="bold">T</text></svg>'),
  vespr: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#8b5cf6"/><text x="16" y="22" font-size="16" text-anchor="middle" fill="white" font-weight="bold">V</text></svg>'),
  begin: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#f59e0b"/><text x="16" y="22" font-size="16" text-anchor="middle" fill="white" font-weight="bold">B</text></svg>'),
};

const KNOWN_WALLETS = [
  { id: 'eternl', name: 'Eternl' },
  { id: 'nami', name: 'Nami' },
  { id: 'lace', name: 'Lace' },
  { id: 'flint', name: 'Flint' },
  { id: 'gerowallet', name: 'Gero' },
  { id: 'typhoncip30', name: 'Typhon' },
  { id: 'vespr', name: 'Vespr' },
  { id: 'begin', name: 'Begin' },
];

const CHARTS = {};

const state = {
  wallet: null,
  api: null,
  address: null,
  addresses: [],
  stakeAddresses: [],
  hexAddress: null,
  surfData: null,
  theme: 'light',
  chartRange: '7d',
  currency: 'usd',
  activityPage: 0,
  activityPageSize: 20,
  activityTotal: 0,
  holderSort: { col: 'balance', dir: 'desc' },
  positionSort: { col: 'collateral', dir: 'desc' },
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

function fmtUSD(v) {
  if (v == null || isNaN(v)) return '$0.00';
  if (Math.abs(v) >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return '$' + (v / 1e3).toFixed(2) + 'K';
  return '$' + v.toFixed(2);
}

function fmtADA(v) {
  if (v == null || isNaN(v)) return '0 ADA';
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(2) + 'B ADA';
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + 'M ADA';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(2) + 'K ADA';
  return v.toFixed(2) + ' ADA';
}

function fmtPct(v) {
  if (v == null || isNaN(v)) return '0%';
  return v.toFixed(2) + '%';
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
  try {
    const res = await fetch('/api/resolve-handles?addresses=' + encodeURIComponent(uncached.join(',')));
    if (!res.ok) return;
    const map = await res.json();
    for (const [addr, h] of Object.entries(map)) handleCache.set(addr, h);
  } catch {}
}

function displayAddr(address, fallback) {
  if (!address) return fallback || '';
  const h = handleCache.get(address);
  if (h) return h;
  return fallback || shorten(address, 6);
}

const tokenIconCache = new Map();

async function fetchTokenIcon(policyId, assetName) {
  const key = (policyId || '') + (assetName || '');
  if (tokenIconCache.has(key)) return tokenIconCache.get(key);
  try {
    const url = 'https://tokens.cardano.org/api/asset/' + policyId + (assetName ? '.' + assetName : '');
    const res = await fetch(url);
    if (!res.ok) throw new Error('not found');
    const data = await res.json();
    const icon = data.logo || data.icon || null;
    tokenIconCache.set(key, icon);
    return icon;
  } catch {
    tokenIconCache.set(key, null);
    return null;
  }
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

/* ---------- Wallet ---------- */

function getAvailableWallets() {
  const available = [];
  const cardano = window.cardano || {};
  for (const w of KNOWN_WALLETS) {
    const ext = cardano[w.id];
    if (ext && typeof ext.enable === 'function') {
      available.push({ ...w, icon: ext.icon || w.icon, version: ext.apiVersion });
    }
  }
  return available;
}

function openWalletModal() {
  const list = $('#walletList');
  const availableIds = new Set(window.cardano ? KNOWN_WALLETS.filter(w => window.cardano[w.id]).map(w => w.id) : []);
  list.innerHTML = KNOWN_WALLETS.map(w => {
    const avail = availableIds.has(w.id);
    return `
      <button class="wallet-btn ${avail ? '' : 'wallet-btn-unavail'}" data-wallet="${w.id}" ${avail ? '' : 'disabled'}>
        <img class="wallet-logo ${avail ? '' : 'wallet-logo-dim'}" src="${WALLET_LOGOS[w.id] || ''}" alt="">
        ${w.name}
        ${avail ? '' : '<span class="wallet-unavail-tag">unavailable</span>'}
      </button>`;
  }).join('');
  list.querySelectorAll('.wallet-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', async () => await connectWallet(btn.dataset.wallet));
  });
  $('#walletModal').classList.add('open');
}

async function connectWallet(walletId) {
  try {
    const ext = window.cardano[walletId];
    if (!ext) throw new Error('Wallet not found');
    const api = await ext.enable();
    const usedAddrs = await api.getUsedAddresses();
    let allHex = [...usedAddrs];
    try {
      const unusedAddrs = await api.getUnusedAddresses();
      if (Array.isArray(unusedAddrs)) allHex = [...usedAddrs, ...unusedAddrs];
    } catch {}
    if (allHex.length === 0) throw new Error('No address returned by wallet');
    const rewardAddrs = await api.getRewardAddresses();
    state.wallet = walletId;
    state.api = api;
    state.addresses = allHex.map(h => hexToBech32(h));
    state.address = state.addresses[0];
    state.hexAddress = allHex[0];
    state.stakeAddresses = rewardAddrs.map(h => hexToBech32(h));
    updateWalletUI();
    prefetchHandles(state.addresses).then(() => updateWalletUI());
    toast('Connected: ' + displayAddr(state.address, shorten(state.address, 8)), 'success');
    $('#walletModal').classList.remove('open');
    fetchSurfDashboard();
  } catch (e) {
    toast('Connection failed: ' + e.message, 'error');
  }
}

function hexToBech32(hex) {
  if (!hex || hex.length < 2) throw new Error('Invalid hex address');
  const pairs = hex.match(/.{1,2}/g);
  if (!pairs) throw new Error('Invalid hex address');
  const bytes = new Uint8Array(pairs.map(b => parseInt(b, 16)));
  const header = bytes[0];
  const typeBits = (header >> 4) & 0x07;
  const networkBit = header & 0x01;
  const isStake = typeBits >= 6;
  const basePrefix = isStake ? 'stake' : 'addr';
  const prefix = networkBit ? basePrefix : basePrefix + '_test';
  return bech32.encode(prefix, bech32.toWords(bytes), 200);
}

function updateWalletUI() {
  const area = $('#walletArea');
  if (state.address) {
    area.innerHTML = `
      <span class="tooltip" style="margin-right:0.1rem;font-size:0.7rem">${escHtml(displayAddr(state.address, shorten(state.address, 5)))}</span>
      <button class="btn btn-sm" id="disconnectBtn">Disconnect</button>`;
    $('#disconnectBtn').addEventListener('click', disconnectWallet);
  } else {
    area.innerHTML = `<button class="btn btn-sm btn-primary" id="connectBtn">Connect Wallet</button>`;
    $('#connectBtn').addEventListener('click', openWalletModal);
  }
}

function disconnectWallet() {
  state.wallet = null;
  state.api = null;
  state.address = null;
  state.addresses = [];
  state.stakeAddresses = [];
  state.hexAddress = null;
  updateWalletUI();
  toast('Disconnected');
}

/* ---------- Data Fetching ---------- */

async function fetchSurfDashboard() {
  try {
    const params = new URLSearchParams();
    if (state.address) params.set('address', state.address);
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
    renderPoolDeepDive();
    renderAnalytics();
    renderSurfTokenStats();
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
  const stats = d.summary || {};
  const usd = state.currency === 'usd';
  const fmt = usd ? fmtUSD : fmtADA;
  const label = usd ? 'USD' : 'ADA';
  container.innerHTML = `
    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-label">Total Value Locked</div>
        <div class="summary-value">${fmt(stats.tvl)}</div>
        <div class="summary-sub">${label}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Total Borrowed</div>
        <div class="summary-value">${fmt(stats.totalBorrowed)}</div>
        <div class="summary-sub">${label}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Available to Borrow</div>
        <div class="summary-value">${fmt(stats.availableBorrow)}</div>
        <div class="summary-sub">${label}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Active Positions</div>
        <div class="summary-value">${stats.activePositions || 0}</div>
        <div class="summary-sub">${(stats.atRiskPositions || 0) + ' at risk'}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">SURF Staked</div>
        <div class="summary-value">${stats.surfStaked ? fmtShort(stats.surfStaked) : '0'}</div>
        <div class="summary-sub">${(stats.stakers || 0) + ' stakers'}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Total Revenue</div>
        <div class="summary-value">${fmt(stats.totalRevenue)}</div>
        <div class="summary-sub">All time ${label}</div>
      </div>
    </div>`;
}

function renderSurfPoolFilter() {
  const sel = $('#poolFilter');
  const pools = state.surfData?.pools || [];
  sel.innerHTML = '<option value="">All Pools</option>' +
    pools.map(p => `<option value="${escHtml(p.id || p.name)}">${escHtml(p.name || p.id)}</option>`).join('');
}

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
  if (filterPool) positions = positions.filter(p => (p.poolId === filterPool || p.poolName === filterPool));
  if (filterStatus) positions = positions.filter(p => p.status === filterStatus);

  const { col, dir } = positionSort;
  positions.sort((a, b) => {
    let av = a[col], bv = b[col];
    if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    av = Number(av) || 0; bv = Number(bv) || 0;
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
          <th data-sort="poolName">Pool<span class="sort-arrow">${sortArrow('poolName')}</span></th>
          <th data-sort="collateral">Collateral<span class="sort-arrow">${sortArrow('collateral')}</span></th>
          <th data-sort="borrowed">Borrowed<span class="sort-arrow">${sortArrow('borrowed')}</span></th>
          <th data-sort="ltv">LTV<span class="sort-arrow">${sortArrow('ltv')}</span></th>
          <th data-sort="apy">APY<span class="sort-arrow">${sortArrow('apy')}</span></th>
          <th data-sort="status">Status<span class="sort-arrow">${sortArrow('status')}</span></th>
        </tr>
      </thead>
      <tbody>
        ${positions.map(p => {
          const ltv = p.ltv != null ? p.ltv : (p.borrowed && p.collateral ? (p.borrowed / p.collateral) * 100 : 0);
          const isAtRisk = p.status === 'at_risk' || ltv > 75;
          const isBad = p.status === 'liquidated' || p.status === 'closed' || ltv > 90;
          const rowClass = isBad ? 'row-danger' : isAtRisk ? 'row-warning' : '';
          const statusClass = isBad ? 'status-liquidated' : isAtRisk ? 'status-at_risk' : 'status-active';
          const statusLabel = p.status || (isAtRisk ? 'at_risk' : 'active');
          return `
            <tr class="${rowClass}">
              <td>${escHtml(shorten(p.address, 8))}</td>
              <td>${escHtml(p.poolName || p.poolId || '-')}</td>
              <td>${fmtUSD(p.collateral)}</td>
              <td>${fmtUSD(p.borrowed)}</td>
              <td>${fmtPct(ltv)}</td>
              <td>${p.apy != null ? fmtPct(p.apy) : '-'}</td>
              <td><span class="status-badge ${statusClass}">${escHtml(statusLabel)}</span></td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;

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
  const pools = state.surfData?.poolApys || state.surfData?.pools || [];
  if (!pools || pools.length === 0) { container.innerHTML = ''; return; }

  container.innerHTML = `
    <div class="apy-grid">
      ${pools.map(p => {
        const apyParts = p.apyBreakdown || [];
        const totalApy = p.totalApy || p.apy || 0;
        return `
          <div class="apy-card">
            <div class="apy-card-title">${escHtml(p.name || p.id || 'Pool')}</div>
            <div class="apy-row">
              <span class="apy-label">Total APY</span>
              <span class="apy-value pos">${fmtPct(totalApy)}</span>
            </div>
            ${apyParts.map(part => `
              <div class="apy-row">
                <span class="apy-label">${escHtml(part.label)}</span>
                <span class="apy-value ${(part.value || 0) >= 0 ? 'pos' : 'neg'}">${fmtPct(part.value)}</span>
              </div>
            `).join('')}
            ${p.supplyApy != null ? `
              <div class="apy-row">
                <span class="apy-label">Supply APY</span>
                <span class="apy-value pos">${fmtPct(p.supplyApy)}</span>
              </div>` : ''}
            ${p.borrowApy != null ? `
              <div class="apy-row">
                <span class="apy-label">Borrow APY</span>
                <span class="apy-value pos">${fmtPct(p.borrowApy)}</span>
              </div>` : ''}
            ${p.rewardApy != null ? `
              <div class="apy-row">
                <span class="apy-label">Reward APY</span>
                <span class="apy-value pos">${fmtPct(p.rewardApy)}</span>
              </div>` : ''}
          </div>`;
      }).join('')}
    </div>`;
}

/* ---------- Pools ---------- */

function renderPoolDeepDive() {
  const container = $('#poolDeepDive');
  const pools = state.surfData?.pools || [];
  if (!pools || pools.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No pool data available.</p></div>';
    return;
  }
  container.innerHTML = pools.map(p => `
    <div class="pool-card">
      <div class="pool-card-header">
        <div class="pool-icon-pile">
          ${(p.icons || []).slice(0, 2).map(icon => `<img class="pool-icon" src="${escHtml(icon)}" alt="">`).join('') || '<div class="pool-icon" style="background:var(--surface2)"></div>'}
        </div>
        <span class="pool-card-title">${escHtml(p.name || p.id || 'Pool')}</span>
        <span class="pool-metric-val">${fmtPct(p.apy || 0)}</span>
      </div>
      <div class="pool-card-body">
        <div class="pool-metric">
          <span class="pool-metric-label">TVL</span>
          <span class="pool-metric-val">${fmtUSD(p.tvl)}</span>
          <span class="pool-metric-sub">${fmtADA(p.tvlAda || 0)}</span>
        </div>
        <div class="pool-metric">
          <span class="pool-metric-label">Supplied</span>
          <span class="pool-metric-val">${fmtUSD(p.supplied)}</span>
        </div>
        <div class="pool-metric">
          <span class="pool-metric-label">Borrowed</span>
          <span class="pool-metric-val">${fmtUSD(p.borrowed)}</span>
        </div>
        <div class="pool-metric">
          <span class="pool-metric-label">Utilization</span>
          <span class="pool-metric-val">${fmtPct(p.utilization)}</span>
        </div>
        <div class="pool-metric">
          <span class="pool-metric-label">LTV</span>
          <span class="pool-metric-val">${fmtPct(p.maxLtv)}</span>
          <span class="pool-metric-sub">Max</span>
        </div>
        ${p.liquidationThreshold != null ? `
        <div class="pool-metric">
          <span class="pool-metric-label">Liquidation</span>
          <span class="pool-metric-val">${fmtPct(p.liquidationThreshold)}</span>
          <span class="pool-metric-sub">Threshold</span>
        </div>` : ''}
        ${p.reserveFactor != null ? `
        <div class="pool-metric">
          <span class="pool-metric-label">Reserve</span>
          <span class="pool-metric-val">${fmtPct(p.reserveFactor)}</span>
          <span class="pool-metric-sub">Factor</span>
        </div>` : ''}
      </div>
    </div>`).join('');
}

/* ---------- Analytics ---------- */

function renderAnalytics() {
  renderAnalyticsSummary();
  renderTvlChart();
  renderTvlCompChart();
  renderBorrowSupplyChart();
  renderLtvAprChart();
  renderMarketCompChart();
  renderRevenueChart();
  renderStakingChart();
}

function renderAnalyticsSummary() {
  const container = $('#analyticsSummary');
  const d = state.surfData?.analytics;
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
  const data = state.surfData?.analytics?.tvlHistory;
  if (!data) return;
  const t = chartTheme();
  CHARTS.tvlChart = new Chart(ctx, {
    type: 'line',
    data: { labels: data.labels, datasets: [{ label: 'TVL', data: data.values, borderColor: chartColors.primary, backgroundColor: chartColors.primary + '20', fill: true, tension: 0.3, pointRadius: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: t.grid }, ticks: { color: t.text, maxTicksLimit: 8 } }, y: { grid: { color: t.grid }, ticks: { color: t.text, callback: v => state.currency === 'usd' ? fmtUSD(v) : fmtADA(v) } } } },
  });
}

function renderTvlCompChart() {
  const ctx = getChartCtx('tvlCompChart');
  if (!ctx) return;
  const data = state.surfData?.analytics?.tvlComposition;
  if (!data) return;
  const colors = [chartColors.primary, chartColors.secondary, chartColors.green, chartColors.yellow, chartColors.purple, chartColors.pink, chartColors.blue];
  CHARTS.tvlCompChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: data.labels, datasets: [{ data: data.values, backgroundColor: colors.slice(0, data.labels.length), borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: chartTheme().text, boxWidth: 10, padding: 8, font: { size: 10 } } } } },
  });
}

function renderBorrowSupplyChart() {
  const ctx = getChartCtx('borrowSupplyChart');
  if (!ctx) return;
  const data = state.surfData?.analytics?.borrowSupplyHistory;
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
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: t.text, boxWidth: 10, padding: 8, font: { size: 10 } } } }, scales: { x: { grid: { color: t.grid }, ticks: { color: t.text, maxTicksLimit: 8 } }, y: { grid: { color: t.grid }, ticks: { color: t.text, callback: v => state.currency === 'usd' ? fmtUSD(v) : fmtADA(v) } } } },
  });
}

function renderLtvAprChart() {
  const ctx = getChartCtx('ltvAprChart');
  if (!ctx) return;
  const data = state.surfData?.analytics?.ltvAprHistory;
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
  const data = state.surfData?.analytics?.marketComposition;
  if (!data) return;
  const colors = [chartColors.primary, chartColors.secondary, chartColors.green, chartColors.yellow, chartColors.purple, chartColors.pink, chartColors.blue, chartColors.orange];
  CHARTS.marketCompChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: [
        { label: 'Supply', data: data.supply, backgroundColor: colors.map(c => c + '80'), borderColor: colors, borderWidth: 1 },
        { label: 'Borrow', data: data.borrow, backgroundColor: colors.map(c => c + '40'), borderColor: colors, borderWidth: 1 },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: chartTheme().text, boxWidth: 10, padding: 8, font: { size: 10 } } } }, scales: { x: { grid: { color: chartTheme().grid }, ticks: { color: chartTheme().text } }, y: { grid: { color: chartTheme().grid }, ticks: { color: chartTheme().text, callback: v => state.currency === 'usd' ? fmtUSD(v) : fmtADA(v) } } } },
  });
}

function renderRevenueChart() {
  const ctx = getChartCtx('revenueChart');
  if (!ctx) return;
  const data = state.surfData?.analytics?.revenueHistory;
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
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: t.text, boxWidth: 10, padding: 8, font: { size: 10 } } } }, scales: { x: { stacked: true, grid: { color: t.grid }, ticks: { color: t.text, maxTicksLimit: 8 } }, y: { stacked: true, grid: { color: t.grid }, ticks: { color: t.text, callback: v => state.currency === 'usd' ? fmtUSD(v) : fmtADA(v) } } } },
  });
}

function renderStakingChart() {
  const ctx = getChartCtx('stakingChart');
  if (!ctx) return;
  const data = state.surfData?.analytics?.stakingHistory;
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
        y: { position: 'left', grid: { color: t.grid }, ticks: { color: t.text, callback: v => fmtShort(v) }, title: { display: true, text: 'SURF', color: t.text, font: { size: 10 } } },
        y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: t.text } },
      },
    },
  });
}

/* ---------- Activity ---------- */

async function fetchActivity(page = 0) {
  try {
    const params = new URLSearchParams();
    params.set('page', page);
    params.set('pageSize', state.activityPageSize);
    if (state.filterActivityType) params.set('type', state.filterActivityType);
    if (state.filterActivityAddr) params.set('address', state.filterActivityAddr);
    const res = await fetch('/api/surf-activity?' + params.toString());
    if (!res.ok) throw new Error('Failed to fetch activity');
    const data = await res.json();
    state.activityPage = page;
    state.activityTotal = data.total || 0;
    renderActivity(data.items || []);
    renderActivityPagination();
  } catch (e) {
    $('#activityList').innerHTML = '<div class="empty-state"><strong>Could not load activity</strong><p>' + escHtml(e.message) + '</p></div>';
  }
}

function renderActivity(items) {
  const container = $('#activityList');
  if (!items || items.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No activity found.</p></div>';
    return;
  }
  container.innerHTML = items.map(a => {
    const amount = a.amount ? (state.currency === 'usd' ? fmtUSD(a.amount) : fmtADA(a.amountAda || a.amount)) : '';
    return `
      <div class="activity-item">
        <span class="activity-type ${a.type}">${escHtml(a.type)}</span>
        <div class="activity-detail">
          <strong>${amount}</strong>
          ${a.poolName ? 'in ' + escHtml(a.poolName) : ''}
          ${a.address ? '<div class="activity-addr">' + escHtml(shorten(a.address, 8)) + '</div>' : ''}
        </div>
        <span class="activity-time">${a.timestamp ? new Date(a.timestamp).toLocaleString() : ''}</span>
      </div>`;
  }).join('');
}

function renderActivityPagination() {
  const container = $('#activityPagination');
  const totalPages = Math.ceil(state.activityTotal / state.activityPageSize);
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
  if (!d) return;
  renderSurfTokenSummary(d);
  renderSurfTokenDetails(d);
  fetchTokenHolders();
}

function renderSurfTokenSummary(d) {
  const container = $('#surfTokenSummary');
  container.innerHTML = `
    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-label">SURF Price</div>
        <div class="summary-value">${fmtUSD(d.price)}</div>
        <div class="summary-sub">${fmtADA(d.priceAda)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Market Cap</div>
        <div class="summary-value">${fmtUSD(d.marketCap)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Total Supply</div>
        <div class="summary-value">${fmtShort(d.totalSupply)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Circulating</div>
        <div class="summary-value">${fmtShort(d.circulatingSupply)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Staked</div>
        <div class="summary-value">${fmtShort(d.staked)}</div>
        <div class="summary-sub">${fmtPct(d.stakePct)} of supply</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Holders</div>
        <div class="summary-value">${d.holders || 0}</div>
      </div>
    </div>`;
}

function renderSurfTokenDetails(d) {
  const container = $('#surfTokenDetails');
  const details = d.details || {};
  container.innerHTML = `
    <div class="token-detail-grid">
      <div class="token-detail-card">
        <div class="token-detail-label">Token Name</div>
        <div class="token-detail-value">${escHtml(d.name || 'SURF')}</div>
      </div>
      <div class="token-detail-card">
        <div class="token-detail-label">Ticker</div>
        <div class="token-detail-value">${escHtml(d.ticker || 'SURF')}</div>
      </div>
      <div class="token-detail-card">
        <div class="token-detail-label">Decimals</div>
        <div class="token-detail-value">${d.decimals != null ? d.decimals : 6}</div>
      </div>
      <div class="token-detail-card">
        <div class="token-detail-label">Policy ID</div>
        <div class="token-detail-value" style="font-size:0.7rem">${escHtml(shorten(d.policyId || details.policyId || '', 12))}</div>
      </div>
      ${d.website ? `
      <div class="token-detail-card">
        <div class="token-detail-label">Website</div>
        <div class="token-detail-value" style="font-size:0.7rem"><a href="${escHtml(d.website)}" target="_blank" rel="noopener" style="color:var(--primary)">${escHtml(d.website)}</a></div>
      </div>` : ''}
      <div class="token-detail-card">
        <div class="token-detail-label">24h Volume</div>
        <div class="token-detail-value">${fmtUSD(d.volume24h || 0)}</div>
      </div>
      ${d.allTimeHigh != null ? `
      <div class="token-detail-card">
        <div class="token-detail-label">All-Time High</div>
        <div class="token-detail-value">${fmtUSD(d.allTimeHigh)}</div>
      </div>` : ''}
      ${d.allTimeLow != null ? `
      <div class="token-detail-card">
        <div class="token-detail-label">All-Time Low</div>
        <div class="token-detail-value">${fmtUSD(d.allTimeLow)}</div>
      </div>` : ''}
    </div>`;
}

async function fetchTokenHolders() {
  try {
    const res = await fetch('/api/surf-holders');
    if (!res.ok) throw new Error('Failed to fetch holders');
    const data = await res.json();
    renderTokenHolders(data.holders || []);
    renderTokenDistChart(data.holders || []);
  } catch (e) {
    $('#holderTableWrap').innerHTML = '<div class="empty-state"><p>Could not load holders.</p></div>';
  }
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
            <td>${escHtml(shorten(h.address, 10))}</td>
            <td>${fmtShort(h.balance)}</td>
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
  const labels = [...top10.map(h => shorten(h.address, 6)), 'Others'];
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
        if (view === 'pools') renderPoolDeepDive();
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
  updateWalletUI();
  fetchSurfDashboard();
  $('#connectBtn')?.addEventListener('click', openWalletModal);
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

  $$('[data-close]').forEach(el => {
    el.addEventListener('click', () => $('#' + el.dataset.close).classList.remove('open'));
  });
  $$('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });
});
