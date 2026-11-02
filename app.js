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
  graphRaw: null,
  graphFetchedAt: 0,
  analyticsData: null,
  activityPage: 0,
  activityPageSize: 20,
  activityPerPage: 20,
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

// Compact numbers (fmtShort is for truncating address strings, not values)
function fmtNum(v) {
  if (v == null || isNaN(v)) return '0';
  const n = Number(v);
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(2);
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
        renderPoolDeepDive();
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
  const atRisk = (d.positions || []).filter(p => (p.ltv || 0) >= 0.75).length;
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

function positionStatus(p) {
  return (p.ltv || 0) >= 0.75 ? 'at_risk' : 'active';
}

const POSITION_SORTS = {
  address: p => p.address || '',
  pool: p => p.principalTicker || p.poolId || '',
  collateral: p => p.collateralValueUSD || 0,
  borrowed: p => p.totalOwedUSD || 0,
  ltv: p => p.ltv || 0,
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
          <th data-sort="pool">Borrowed Asset<span class="sort-arrow">${sortArrow('pool')}</span></th>
          <th data-sort="collateral">Collateral<span class="sort-arrow">${sortArrow('collateral')}</span></th>
          <th data-sort="borrowed">Debt<span class="sort-arrow">${sortArrow('borrowed')}</span></th>
          <th data-sort="ltv">LTV<span class="sort-arrow">${sortArrow('ltv')}</span></th>
          <th data-sort="rate">Rate<span class="sort-arrow">${sortArrow('rate')}</span></th>
          <th data-sort="status">Status<span class="sort-arrow">${sortArrow('status')}</span></th>
        </tr>
      </thead>
      <tbody>
        ${positions.map(p => {
          const ltv = p.ltv || 0;
          const status = positionStatus(p);
          const rowClass = ltv >= 0.9 ? 'row-danger' : status === 'at_risk' ? 'row-warning' : '';
          return `
            <tr class="${rowClass}">
              <td>${escHtml(displayAddr(p.address, shorten(p.address || '', 8)))}</td>
              <td>${tokenCell(p.principalPolicyId, p.principalAssetName, p.principalTicker || '?')}</td>
              <td>${fmtMoney(p.collateralValueUSD)} ${tokenCell(p.collateralPolicyId, p.collateralAssetName, p.collateralTicker)}</td>
              <td>${fmtMoney(p.totalOwedUSD)} ${tokenCell(p.principalPolicyId, p.principalAssetName, p.principalTicker)}</td>
              <td>${fmtRatio(ltv)}</td>
              <td>${fmtRatio(p.interestRate)}</td>
              <td><span class="status-badge status-${status}">${escHtml(status.replace('_', ' '))}</span></td>
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

function renderPoolDeepDive() {
  const container = $('#poolDeepDive');
  const pools = [...(state.surfData?.pools || [])]
    .sort((a, b) => (b.totalSuppliedUSD || 0) - (a.totalSuppliedUSD || 0));
  if (pools.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No pool data available.</p></div>';
    return;
  }
  container.innerHTML = pools.map(p => `
    <div class="pool-card">
      <div class="pool-card-header">
        ${poolIconPile(p)}
        <span class="pool-card-title">${escHtml(poolLabel(p))}</span>
        <span class="pool-metric-val">${fmtRatio(p.supplyApyTotal)}</span>
      </div>
      <div class="pool-card-body">
        <div class="pool-metric">
          <span class="pool-metric-label">Supplied</span>
          <span class="pool-metric-val">${fmtMoney(p.totalSuppliedUSD)}</span>
        </div>
        <div class="pool-metric">
          <span class="pool-metric-label">Borrowed</span>
          <span class="pool-metric-val">${fmtMoney(p.totalBorrowedUSD)}</span>
        </div>
        <div class="pool-metric">
          <span class="pool-metric-label">Utilization</span>
          <span class="pool-metric-val">${fmtRatio(p.utilizationRate)}</span>
        </div>
        <div class="pool-metric">
          <span class="pool-metric-label">Supply APY</span>
          <span class="pool-metric-val">${fmtRatio(p.supplyApyTotal)}</span>
        </div>
        <div class="pool-metric">
          <span class="pool-metric-label">Borrow APR</span>
          <span class="pool-metric-val">${fmtRatio(p.borrowApr)}</span>
        </div>
        <div class="pool-metric">
          <span class="pool-metric-label">Max LTV</span>
          <span class="pool-metric-val">${fmtRatio(p.maxBorrowLTV)}</span>
          <span class="pool-metric-sub">Liq ${fmtRatio(p.liquidationThresholdLTV)}</span>
        </div>
        <div class="pool-metric">
          <span class="pool-metric-label">Reserve Factor</span>
          <span class="pool-metric-val">${fmtRatio(p.reserveFactor)}</span>
        </div>
        <div class="pool-metric">
          <span class="pool-metric-label">Collateral</span>
          <span class="pool-metric-val" style="font-size:0.75rem">${escHtml((p.collateralAssets || []).map(c => c.ticker).join(', ') || '—')}</span>
        </div>
      </div>
    </div>`).join('');
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
      labels: compLabels.slice(0, top.length),
      supply: top.map(([, v]) => v.supply),
      borrow: top.map(([, v]) => v.borrow),
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
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: t.grid }, ticks: { color: t.text, maxTicksLimit: 8 } }, y: { grid: { color: t.grid }, ticks: { color: t.text, callback: v => state.currency === 'usd' ? fmtUSD(v) : fmtADA(v) } } } },
  });
}

function renderTvlCompChart() {
  const ctx = getChartCtx('tvlCompChart');
  if (!ctx) return;
  const data = state.analyticsData?.tvlComposition;
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
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: t.text, boxWidth: 10, padding: 8, font: { size: 10 } } } }, scales: { x: { grid: { color: t.grid }, ticks: { color: t.text, maxTicksLimit: 8 } }, y: { grid: { color: t.grid }, ticks: { color: t.text, callback: v => state.currency === 'usd' ? fmtUSD(v) : fmtADA(v) } } } },
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
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: t.text, boxWidth: 10, padding: 8, font: { size: 10 } } } }, scales: { x: { stacked: true, grid: { color: t.grid }, ticks: { color: t.text, maxTicksLimit: 8 } }, y: { stacked: true, grid: { color: t.grid }, ticks: { color: t.text, callback: v => state.currency === 'usd' ? fmtUSD(v) : fmtADA(v) } } } },
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
        y: { position: 'left', grid: { color: t.grid }, ticks: { color: t.text, callback: v => fmtNum(v) }, title: { display: true, text: 'SURF', color: t.text, font: { size: 10 } } },
        y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: t.text } },
      },
    },
  });
}

/* ---------- Activity ---------- */

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
    renderActivity(payload.data || []);
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
    const amount = a.amount_fmt ? (a.amount_fmt + ' ' + (a.asset_ticker || '')).trim() : '';
    const link = a.tx_hash ? 'https://cardanoscan.io/transaction/' + a.tx_hash : '';
    const time = escHtml(a.time_ago || '');
    return `
      <div class="activity-item">
        <span class="activity-type ${escHtml(type.toLowerCase().replace(/\s+/g, '_'))}">${escHtml(type)}</span>
        <div class="activity-detail">
          <strong>${escHtml(amount || '—')}</strong>
          ${a.pool_ticker && a.pool_ticker !== a.asset_ticker ? ' on ' + escHtml(a.pool_ticker) : ''}
          ${a.fee_fmt && a.fee_fmt !== '—' ? '<div class="activity-addr">fee ' + escHtml(a.fee_fmt) + '</div>' : ''}
          ${a.address ? '<div class="activity-addr">' + escHtml(displayAddr(a.address, a.address_short || shorten(a.address, 8))) + '</div>' : ''}
        </div>
        <span class="activity-time">${link ? `<a href="${link}" target="_blank" rel="noopener">${time}</a>` : time}</span>
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
        <div class="summary-value">${d?.holders != null ? d.holders : '—'}</div>
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
            <td>${escHtml(shorten(h.address, 10))}</td>
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
