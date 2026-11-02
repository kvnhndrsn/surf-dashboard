import { koiosPost, defaultKoiosUrl } from '../lib/koios.js';

const SURF_API = 'https://surflending.org';
const SURF_POLICY = '2d9db8a89f074aa045eab177f23a3395f62ced8b53499a9e4ad46c80';
const SURF_ASSET = '464c4f57';
const SURF_DECIMALS = 6;

async function surfFetch(path) {
  const res = await fetch(SURF_API + path);
  if (!res.ok) return null;
  return res.json();
}

const HOLDERS_TTL_MS = 5 * 60 * 1000;
const HOLDERS_PAGE = 1000;
const HOLDERS_MAX_PAGES = 5;
let holdersCache = { at: 0, data: null };

// /asset_info is the authoritative supply (25,000,000 SURF); holder pages only
// add up to what the first few thousand addresses hold.
async function fetchSurfSupply(koiosUrl) {
  const info = await koiosPost(koiosUrl + '/asset_info', {
    _asset_policy: SURF_POLICY,
    _asset_name: SURF_ASSET,
  }, 'surf-supply');
  if (!Array.isArray(info) || !info[0]) return null;
  return Number(info[0].total_supply) / Math.pow(10, SURF_DECIMALS);
}

// Koios exposes holders at /asset_addresses (not the old /asset_address_list,
// which 404s) and reports them as payment_address, paginated 1000 at a time.
async function fetchSurfHolders(koiosUrl) {
  if (holdersCache.data && Date.now() - holdersCache.at < HOLDERS_TTL_MS) return holdersCache.data;
  try {
    const supply = await fetchSurfSupply(koiosUrl);
    const seen = new Map();

    for (let page = 0; page < HOLDERS_MAX_PAGES; page++) {
      const rows = await koiosPost(
        koiosUrl + '/asset_addresses?limit=' + HOLDERS_PAGE + '&offset=' + page * HOLDERS_PAGE,
        { _asset_policy: SURF_POLICY, _asset_name: SURF_ASSET },
        'surf-holders-' + page
      );
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const row of rows) {
        const address = row.payment_address || row.address;
        const quantity = Number(row.quantity || 0);
        if (!address || !(quantity > 0)) continue;
        seen.set(address, (seen.get(address) || 0) + quantity);
      }
      if (rows.length < HOLDERS_PAGE) break;
    }

    if (seen.size === 0) {
      return supply
        ? { holders: 0, totalSupply: supply, topHolders: [], top10ConcentrationPct: 0, avgBalance: 0, medianBalance: 0, buckets: {} }
        : null;
    }

    const divisor = Math.pow(10, SURF_DECIMALS);
    const ranked = [...seen.entries()]
      .map(([address, quantity]) => ({ address, balance: quantity / divisor }))
      .sort((a, b) => b.balance - a.balance);

    const held = ranked.reduce((s, h) => s + h.balance, 0);
    const totalSupply = supply || held;
    const top10 = ranked.slice(0, 10).map(h => ({
      address: h.address,
      balance: h.balance,
      pct: totalSupply > 0 ? (h.balance / totalSupply) * 100 : 0,
    }));
    const top10Held = ranked.slice(0, 10).reduce((s, h) => s + h.balance, 0);

    const buckets = { under1K: 0, under10K: 0, under100K: 0, under1M: 0, over1M: 0 };
    for (const h of ranked) {
      if (h.balance < 1e3) buckets.under1K++;
      else if (h.balance < 1e4) buckets.under10K++;
      else if (h.balance < 1e5) buckets.under100K++;
      else if (h.balance < 1e6) buckets.under1M++;
      else buckets.over1M++;
    }

    const balances = ranked.map(h => h.balance).sort((a, b) => a - b);
    const data = {
      holders: ranked.length,
      totalSupply,
      topHolders: top10,
      top10ConcentrationPct: totalSupply > 0 ? (top10Held / totalSupply) * 100 : 0,
      avgBalance: ranked.length ? held / ranked.length : 0,
      medianBalance: balances.length ? balances[Math.floor(balances.length / 2)] : 0,
      buckets,
      truncated: ranked.length >= HOLDERS_PAGE * HOLDERS_MAX_PAGES,
    };

    holdersCache = { at: Date.now(), data };
    return data;
  } catch (e) {
    return null;
  }
}

function decodeAsset(policyId, assetNameHex) {
  if (!policyId) return { ticker: 'ADA', decimals: 6, policyId: '', assetName: '' };
  let name = '';
  if (assetNameHex) {
    try { name = decodeURIComponent(assetNameHex.replace(/([0-9a-fA-F]{2})/g, '%$1')); } catch {}
  }
  return { policyId, assetName: assetNameHex || '', name };
}

function parseAssetId(key) {
  if (!key) return { policyId: '', assetName: '' };
  if (!key.includes('.')) return { policyId: key, assetName: '' };
  const dot = key.indexOf('.');
  return { policyId: key.slice(0, dot), assetName: key.slice(dot + 1) };
}

export default async function handler(req, res) {
  const { address } = req.query;
  res.setHeader('Content-Type', 'application/json');
  if (!address) {
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  }

  try {
    const network = process.env.BLOCKFROST_NETWORK || 'mainnet';
    const koiosUrl = process.env.KOIOS_API_URL || defaultKoiosUrl(network);

    const [poolData, posData, surfPriceData, adaPriceData, stakingInfo, stakingApy, stakingChart, tokenData] = await Promise.all([
      surfFetch('/api/getAllPoolInfos'),
      surfFetch('/api/getAllPositions' + (address ? `?address=${encodeURIComponent(address)}` : '')),
      surfFetch('/api/getSurfPrice'),
      surfFetch('/api/getAdaPrice'),
      surfFetch('/api/staking/getInfo' + (address ? `?address=${encodeURIComponent(address)}` : '')),
      surfFetch('/api/staking/getAPY'),
      surfFetch('/api/staking/getRewardsChart' + (address ? `?address=${encodeURIComponent(address)}` : '')),
      fetchSurfHolders(koiosUrl),
    ]);

    if (!poolData) {
      return res.status(502).json({ error: 'Could not fetch pool data' });
    }

    const surfPrice = surfPriceData?.price || 0;
    const adaPrice = adaPriceData?.price || 0;

    const pools = poolData.poolInfos || poolData;
    const poolEntries = Object.entries(pools).map(([poolId, info]) => {
      const asset = info.asset || {};
      const ctoken = info.cToken || {};
      const collaterals = (info.collateralAssets || []).map(c => ({
        ticker: c.asset?.ticker || '?',
        policyId: c.asset?.policyId || '',
        assetName: c.asset?.assetName || '',
        decimals: c.asset?.decimals || 0,
        price: c.price || 0,
        maxBorrowLTV: c.maxBorrowLTV || 0,
        liquidationThresholdLTV: c.liquidationThresholdLTV || 0,
      }));
      return {
        poolId,
        asset: { ticker: asset.ticker || '?', policyId: asset.policyId || '', assetName: asset.assetName || '', decimals: asset.decimals || 0 },
        price: info.price || 0,
        collateralAssets: collaterals,
        totalSupplied: info.totalSupplied || 0,
        totalBorrowed: info.totalBorrowed || 0,
        reserve: info.reserve || 0,
        reserveFactor: info.reserveFactor || 0,
        supplyApy: info.supplyApy || 0,
        supplyApyAdjustment: info.supplyApyAdjustment || 0,
        supplyApyTotal: (info.supplyApy || 0) + (info.supplyApyAdjustment || 0),
        borrowApr: info.borrowApr || 0,
        totalCToken: info.totalCToken || 0,
        totalUnpaidInterest: info.totalUnpaidInterest || 0,
        u: info.u || 0,
        cToken: { policyId: ctoken.policyId || '', assetName: ctoken.assetName || '' },
        maxBorrowLTV: info.maxBorrowLTV || 0,
        recommendedBorrowLTV: info.recommendedBorrowLTV || 0,
        liquidationThresholdLTV: info.liquidationThresholdLTV || 0,
        historicalApy: info.historicalApy || 0,
        totalVolume: info.totalVolume || 0,
      };
    });

    const poolMap = {};
    for (const p of poolEntries) poolMap[p.poolId] = p;

    const positionsRaw = posData?.positions || [];
    const positions = [];
    for (const poolPos of positionsRaw) {
      const poolId = poolPos.poolId;
      const pool = poolMap[poolId];
      const list = poolPos.positions || [];
      for (const pos of list) {
        const now = Date.now();
        const elapsedMs = now - (pos.startTime || now);
        const elapsedYears = elapsedMs / 31557600000;
        const principal = Number(pos.principal || 0);
        const collateral = Number(pos.collateral || 0);
        const interestRate = Number(pos.interestRate || 0);
        const accruedInterest = principal * interestRate * elapsedYears;
        const totalOwed = principal + accruedInterest;

        const poolAsset = pool?.asset || { ticker: '?', decimals: 6, policyId: '' };
        const principalDecimals = poolAsset.decimals || 6;
        const isCollateralADA = !pos.collateralAsset?.policyId;

        let collInfo = null;
        if (pool && !isCollateralADA) {
          collInfo = pool.collateralAssets.find(c =>
            c.policyId === pos.collateralAsset.policyId &&
            c.assetName === pos.collateralAsset.assetName
          );
        }
        const collateralDecimals = isCollateralADA ? 6 : (collInfo?.decimals || 0);

        const principalTicker = poolAsset.ticker || (poolAsset.policyId ? poolAsset.policyId.slice(0, 6) + '..' : 'ADA');
        const collateralTicker = isCollateralADA ? 'ADA' : (collInfo?.ticker || '?');

        const principalPriceADA = pool?.price || 1;
        let collateralPriceADA = 0;
        if (isCollateralADA) {
          collateralPriceADA = 1;
        } else if (collInfo) {
          collateralPriceADA = (collInfo.price || 0) * principalPriceADA;
        }

        const principalValueADA = (principal / Math.pow(10, principalDecimals)) * principalPriceADA;
        const totalOwedADA = (totalOwed / Math.pow(10, principalDecimals)) * principalPriceADA;
        const collateralADA = collateralPriceADA > 0 ? (collateral / Math.pow(10, collateralDecimals)) * collateralPriceADA : 0;
        const netValueADA = collateralADA - totalOwedADA;

        const principalValueUSD = principalValueADA * adaPrice;
        const totalOwedUSD = totalOwedADA * adaPrice;
        const collateralValueUSD = collateralADA * adaPrice;
        const netValueUSD = netValueADA * adaPrice;
        const principalPriceUSD = principalPriceADA * adaPrice;
        const collateralPriceUSD = collateralPriceADA * adaPrice;

        const computedLtv = collateralADA > 0 ? totalOwedADA / collateralADA : 0;

        positions.push({
          poolId,
          address: pos.address,
          principal,
          principalDecimals,
          principalTicker,
          principalPolicyId: pos.principalAsset?.policyId || '',
          principalAssetName: pos.principalAsset?.assetName || '',
          collateral,
          collateralDecimals,
          collateralTicker,
          collateralPolicyId: pos.collateralAsset?.policyId || '',
          collateralAssetName: pos.collateralAsset?.assetName || '',
          interestRate,
          startTime: pos.startTime,
          ltv: computedLtv,
          borrowId: pos.borrowId || null,
          outRef: pos.outRef || null,
          elapsedYears,
          accruedInterest,
          totalOwed,
          principalValueUSD,
          totalOwedUSD,
          collateralValueUSD,
          netValueUSD,
          principalPriceUSD,
          collateralPriceUSD,
        });
      }
    }

    const poolsArray = poolEntries.map(p => {
      const decimals = p.asset.decimals || 0;
      const totalSuppliedADA = (p.totalSupplied / Math.pow(10, decimals)) * p.price;
      const totalBorrowedADA = (p.totalBorrowed / Math.pow(10, decimals)) * p.price;
      const totalSuppliedUSD = totalSuppliedADA * adaPrice;
      const totalBorrowedUSD = totalBorrowedADA * adaPrice;
      return {
        ...p,
        totalSuppliedUSD,
        totalBorrowedUSD,
        utilizationRate: p.totalSupplied > 0 ? p.totalBorrowed / p.totalSupplied : 0,
      };
    });

    const surfPriceUSD = surfPrice * adaPrice;

    const poolBorrowedUSD = poolsArray.reduce((s, p) => s + p.totalBorrowedUSD, 0);
    const posBorrowedUSD = positions.reduce((s, p) => s + p.totalOwedUSD, 0);
    const posCollateralUSD = positions.reduce((s, p) => s + p.collateralValueUSD, 0);
    const posNetValueUSD = positions.reduce((s, p) => s + p.netValueUSD, 0);
    const totalSuppliedUSD = poolsArray.reduce((s, p) => s + p.totalSuppliedUSD, 0);

    return res.json({
      pools: poolsArray,
      positions,
      summary: {
        totalPositions: positions.length,
        totalPools: poolsArray.length,
        totalSuppliedUSD,
        totalBorrowedUSD: posBorrowedUSD,
        totalCollateralUSD: posCollateralUSD,
        totalNetValueUSD: posNetValueUSD,
        totalBorrowedFromPools: poolBorrowedUSD,
        totalTVLUSD: totalSuppliedUSD + posCollateralUSD - posBorrowedUSD,
        totalTVLFromPools: totalSuppliedUSD + posCollateralUSD - poolBorrowedUSD,
        surfPrice,      // ada per SURF
        surfPriceUSD,
        adaPrice,       // usd per ADA
        fetchedAt: Date.now(),
      },
      staking: {
        info: stakingInfo?.info || null,
        apy: stakingApy || null,
        rewardsChart: stakingChart?.data || [],
      },
      token: tokenData ? {
        ...tokenData,
        price: surfPrice,
        priceUSD: surfPriceUSD,
        marketCapADA: surfPrice * (tokenData?.totalSupply || 0),
        marketCapUSD: surfPriceUSD * (tokenData?.totalSupply || 0),
        policyId: SURF_POLICY,
        fingerprint: 'asset1j0x9p32zv67qjgjq7j0v7q5j0x9p32zv67qjgj',
      } : null,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
