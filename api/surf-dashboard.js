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

async function fetchSurfHolders(koiosUrl) {
  try {
    const result = await koiosPost(koiosUrl + '/asset_address_list', {
      _asset_policy: SURF_POLICY,
      _asset_name: SURF_ASSET,
    }, 'surf-holders');
    if (!Array.isArray(result)) return null;

    const holders = result
      .filter(h => h.quantity && BigInt(h.quantity) > 0n)
      .map(h => ({ address: h.address, balance: h.quantity }));

    const totalWithDecimals = holders.reduce((s, h) => s + Number(h.balance), 0);
    const totalTokens = totalWithDecimals / Math.pow(10, SURF_DECIMALS);

    const sorted = holders.sort((a, b) => Number(b.balance) - Number(a.balance));
    const top10 = sorted.slice(0, 10).map(h => ({
      address: h.address,
      balance: Number(h.balance) / Math.pow(10, SURF_DECIMALS),
      pct: totalTokens > 0 ? (Number(h.balance) / totalWithDecimals) * 100 : 0,
    }));

    const top10Count = sorted.slice(0, 10).reduce((s, h) => s + Number(h.balance), 0);
    const balances = sorted.map(h => Number(h.balance));
    const avgBalance = holders.length > 0 ? totalWithDecimals / holders.length : 0;

    let low = 0, midLow = 0, mid = 0, midHigh = 0, high = 0;
    for (const bal of balances) {
      const t = bal / Math.pow(10, SURF_DECIMALS);
      if (t < 1000) low++;
      else if (t < 10000) midLow++;
      else if (t < 100000) mid++;
      else if (t < 1000000) midHigh++;
      else high++;
    }

    return {
      holders: holders.length,
      totalSupply: totalTokens,
      topHolders: top10,
      top10ConcentrationPct: totalTokens > 0 ? (top10Count / totalWithDecimals) * 100 : 0,
      avgBalance,
      medianBalance: balances.length > 0
        ? [...balances].sort((a, b) => a - b)[Math.floor(balances.length / 2)] / Math.pow(10, SURF_DECIMALS)
        : 0,
      buckets: { under1K: low, under10K: midLow, under100K: mid, under1M: midHigh, over1M: high },
    };
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
