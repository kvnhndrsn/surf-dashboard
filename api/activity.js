import { createClient } from '@supabase/supabase-js';

const SURF_API = 'https://surflending.org';

let supabase = null;
let supabaseError = null;
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  supabaseError = 'SUPABASE_URL / SUPABASE_SERVICE_KEY are not set on this deployment';
} else {
  try {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  } catch (e) {
    supabaseError = 'Supabase client init failed: ' + e.message;
  }
}

const txFeeCache = new Map();

async function surfFetch(path) {
  const res = await fetch(SURF_API + path);
  if (!res.ok) return null;
  return res.json();
}

function shortenAddr(addr, chars = 6) {
  return addr.slice(0, chars) + '...' + addr.slice(-chars);
}

function fmtShort(val) {
  if (val >= 1e6) return (val / 1e6).toFixed(2) + 'M';
  if (val >= 1e3) return (val / 1e3).toFixed(2) + 'K';
  return val.toFixed(2);
}

function formatToken(val) {
  if (val >= 1e6) return (val / 1e6).toFixed(2) + 'M';
  if (val >= 1e3) return (val / 1e3).toFixed(2) + 'K';
  return val.toFixed(2);
}

async function fetchTxFees(txHashes) {
  const uncached = txHashes.filter(h => h && !txFeeCache.has(h));
  if (uncached.length === 0) {
    const result = {};
    for (const h of txHashes) {
      if (h && txFeeCache.has(h)) result[h] = txFeeCache.get(h);
    }
    return result;
  }

  const urls = [
    process.env.KOIOS_API_URL || 'https://api.koios.rest/api/v1',
    'https://api.koios.rest/api/v2',
  ];

  for (const baseUrl of urls) {
    try {
      const resp = await fetch(baseUrl + '/tx_info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _tx_hashes: [...new Set(uncached)] }),
      });
      if (!resp.ok) continue;

      const txs = await resp.json();
      if (!Array.isArray(txs)) continue;

      for (const tx of txs) {
        const hash = tx.tx_hash;
        const info = {};

        if (tx.metadata && typeof tx.metadata === 'object') {
          const entries = Object.entries(tx.metadata);
          if (entries.length > 0) info.metadata = tx.metadata;
        }

        if (tx.withdrawals && Array.isArray(tx.withdrawals) && tx.withdrawals.length > 0) {
          info.withdrawals = tx.withdrawals.map(w => ({
            address: w.address,
            amount: Number(w.amount) / 1e6,
          }));
        }

        if (tx.outputs && Array.isArray(tx.outputs)) {
          info.outputs = tx.outputs.map(o => ({
            address: o.address,
            ada: Number(o.value) / 1e6,
            assets: (o.asset_list || []).map(a => ({
              policy: a.policy_id,
              name: a.asset_name,
              quantity: a.quantity,
            })),
          }));
        }

        txFeeCache.set(hash, info);
      }

      break;
    } catch {
      continue;
    }
  }

  for (const h of uncached) {
    if (!txFeeCache.has(h)) txFeeCache.set(h, {});
  }

  const result = {};
  for (const h of txHashes) {
    if (h && txFeeCache.has(h)) result[h] = txFeeCache.get(h);
  }
  return result;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  if (supabaseError) return res.status(500).json({ error: supabaseError });
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page) || 50));
    const typeFilter = req.query.type || '';
    const addressFilter = req.query.address || '';

    let query = supabase
      .from('surf_activities')
      .select('*', { count: 'exact' });

    if (typeFilter) {
      query = query.eq('activity_type', typeFilter);
    }
    if (addressFilter) {
      query = query.ilike('address', '%' + addressFilter + '%');
    }

    const from = (page - 1) * perPage;
    const to = from + perPage - 1;

    const { data, error, count } = await query
      .order('activity_time', { ascending: false })
      .range(from, to);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const poolData = await surfFetch('/api/getAllPoolInfos');
    const pools = poolData?.poolInfos || poolData || {};
    const poolMap = {};
    const assetLookup = {};
    for (const [pid, info] of Object.entries(pools)) {
      const asset = info.asset || {};
      poolMap[pid] = {
        ticker: asset.ticker || '?',
        decimals: asset.decimals || 0,
        price: info.price || 0,
      };
      const addAsset = (a) => {
        if (!a) return;
        const key = (a.policyId || '') + (a.assetName || '');
        if (key && !assetLookup[key]) {
          assetLookup[key] = { ticker: a.ticker || '?', decimals: a.decimals || 0 };
        }
      };
      addAsset(info.asset);
      if (info.collateralAssets) {
        for (const c of info.collateralAssets) addAsset(c.asset);
      }
    }
    assetLookup[''] = { ticker: 'ADA', decimals: 6 };

    const txHashes = data.map(a => a.tx_hash).filter(Boolean);
    const txFees = await fetchTxFees(txHashes);

    const enriched = data.map(a => {
      const pool = poolMap[a.pool_id] || {};
      const amountInfo = assetLookup[a.asset] || { ticker: pool.ticker, decimals: pool.decimals };
      const collatInfo = assetLookup[a.collateral_asset] || { ticker: '?', decimals: 0 };
      const amountDiv = Math.pow(10, amountInfo.decimals);
      const collatDiv = Math.pow(10, collatInfo.decimals);
      const amountVal = a.amount / amountDiv;
      const collatVal = a.collateral_amount / collatDiv;

      let feeVal = 0, feeLabel = '', stakerShare = 0, lpShare = 0;
      let feeSource = 'protocol-rule';
      const at = a.activity_type;
      const txInfo = txFees[a.tx_hash];

      if (at === 'Borrow' || at === 'Leveraged Borrow') {
        feeVal = amountVal * 0.01;
        feeLabel = fmtShort(feeVal) + ' ' + amountInfo.ticker;
        stakerShare = 70;
        lpShare = 30;
      } else if (at === 'Liquidate') {
        feeVal = collatVal * 0.15;
        feeLabel = fmtShort(feeVal) + ' ' + collatInfo.ticker;
        stakerShare = 70;
        lpShare = 30;
      }

      if (txInfo?.withdrawals?.length) {
        const adaFee = txInfo.withdrawals.reduce((s, w) => s + w.amount, 0);
        feeSource = 'onchain';
      }

      return {
        ...a,
        address_short: shortenAddr(a.address),
        pool_ticker: pool.ticker || '?',
        asset_ticker: amountInfo.ticker,
        collateral_ticker: collatInfo.ticker,
        amount_fmt: formatToken(amountVal),
        collateral_fmt: formatToken(collatVal),
        fee: feeVal,
        fee_fmt: feeLabel || '—',
        fee_staker_pct: stakerShare,
        fee_lp_pct: lpShare,
        fee_source: feeSource,
        tx_metadata: txInfo?.metadata || null,
        tx_withdrawals: txInfo?.withdrawals || [],
        time_ago: timeAgo(a.activity_time),
        cardanoscan_link: 'https://cardanoscan.io/transaction/' + a.tx_hash,
      };
    });

    return res.json({ data: enriched, total: count, page, per_page: perPage });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  return new Date(ts).toLocaleDateString();
}
