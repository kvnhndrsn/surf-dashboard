import { createClient } from '@supabase/supabase-js';

const SURF_API = 'https://surflending.org';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function surfFetch(path) {
  const res = await fetch(SURF_API + path);
  if (!res.ok) return null;
  return res.json();
}

function ltvBucket(ltv) {
  if (ltv < 0.25) return '0-25';
  if (ltv < 0.50) return '25-50';
  if (ltv < 0.75) return '50-75';
  return '75-100';
}

export default async function handler(req, res) {
  const start = Date.now();

  if (req.query.key !== process.env.SNAPSHOT_KEY) {
    return res.status(401).json({ error: 'invalid key' });
  }

  try {
    const [poolData, posData, surfPriceData, adaPriceData] = await Promise.all([
      surfFetch('/api/getAllPoolInfos'),
      surfFetch('/api/getAllPositions'),
      surfFetch('/api/getSurfPrice'),
      surfFetch('/api/getAdaPrice'),
    ]);

    if (!poolData) {
      return res.status(502).json({ error: 'could not fetch pool data' });
    }

    const surfPrice = surfPriceData?.price || 0;
    const adaPrice = adaPriceData?.price || 0;
    const pools = poolData.poolInfos || poolData;
    const poolMap = {};
    const poolEntries = [];

    for (const [poolId, info] of Object.entries(pools)) {
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

      const p = {
        poolId,
        asset: { ticker: asset.ticker || '?', policyId: asset.policyId || '', assetName: asset.assetName || '', decimals: asset.decimals || 0 },
        ticker: asset.ticker || '?',
        policyId: asset.policyId || '',
        assetName: asset.assetName || '',
        decimals: asset.decimals || 0,
        price: info.price || 0,
        totalSupplied: Number(info.totalSupplied || 0),
        totalBorrowed: Number(info.totalBorrowed || 0),
        reserve: Number(info.reserve || 0),
        reserveFactor: info.reserveFactor || 0,
        supplyApy: info.supplyApy || 0,
        borrowApr: info.borrowApr || 0,
        totalCToken: Number(info.totalCToken || 0),
        totalUnpaidInterest: Number(info.totalUnpaidInterest || 0),
        u: info.u || 0,
        cToken: { policyId: ctoken.policyId || '', assetName: ctoken.assetName || '' },
        maxBorrowLTV: info.maxBorrowLTV || 0,
        recommendedBorrowLTV: info.recommendedBorrowLTV || 0,
        liquidationThresholdLTV: info.liquidationThresholdLTV || 0,
        historicalApy: info.historicalApy || 0,
        totalVolume: Number(info.totalVolume || 0),
        collateralAssets: collaterals,
      };

      poolEntries.push(p);
      poolMap[poolId] = p;
    }

    const positionsRaw = posData?.positions || [];
    const allPositions = [];
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
        const principalPriceADA = pool?.price || 1;
        let collateralPriceADA = 0;
        if (isCollateralADA) {
          collateralPriceADA = 1;
        } else if (collInfo) {
          collateralPriceADA = (collInfo.price || 0) * principalPriceADA;
        }
        const totalOwedADA = (totalOwed / Math.pow(10, principalDecimals)) * principalPriceADA;
        const collateralADA = collateralPriceADA > 0 ? (collateral / Math.pow(10, collateralDecimals)) * collateralPriceADA : 0;
        const netValueADA = collateralADA - totalOwedADA;
        const totalOwedUSD = totalOwedADA * adaPrice;
        const collateralValueUSD = collateralADA * adaPrice;
        const netValueUSD = netValueADA * adaPrice;
        const computedLtv = collateralADA > 0 ? totalOwedADA / collateralADA : 0;

        allPositions.push({
          poolId,
          principal,
          totalOwed,
          collateral,
          ltv: computedLtv,
          netValueUSD,
          totalOwedUSD,
          collateralValueUSD,
          interestRate,
        });
      }
    }

    const poolPosCount = {};
    for (const p of allPositions) {
      poolPosCount[p.poolId] = (poolPosCount[p.poolId] || 0) + 1;
    }

    const buckets = { '0-25': 0, '25-50': 0, '50-75': 0, '75-100': 0 };
    let healthy = 0, atRisk = 0, liquidatable = 0;
    let healthyValue = 0, atRiskValue = 0, liquidatableValue = 0;
    let totalLtv = 0, totalApr = 0, totalSuppliedUSD = 0, totalBorrowedUSD = 0;
    let totalCollateralUSD = 0, totalNetValueUSD = 0, totalReserveUSD = 0;
    let totalUnpaidInterestUSD = 0;
    let totalVolumeUSD = 0;

    for (const p of allPositions) {
      const ltv = p.ltv || 0;
      const bucket = ltvBucket(ltv);
      buckets[bucket] = (buckets[bucket] || 0) + 1;
      if (ltv >= 0.75) { liquidatable++; liquidatableValue += p.collateralValueUSD + p.totalOwedUSD; }
      else if (ltv >= 0.5) { atRisk++; atRiskValue += p.collateralValueUSD + p.totalOwedUSD; }
      else { healthy++; healthyValue += p.collateralValueUSD + p.totalOwedUSD; }
      totalLtv += ltv;
      totalApr += (p.interestRate || 0) * p.totalOwedUSD;
      totalBorrowedUSD += p.totalOwedUSD;
      totalCollateralUSD += p.collateralValueUSD;
      totalNetValueUSD += p.netValueUSD;
    }

    const poolBreakdown = {};
    for (const p of poolEntries) {
      const decimals = p.decimals || 0;
      const suppliedADA = (p.totalSupplied / Math.pow(10, decimals)) * p.price;
      const borrowedADA = (p.totalBorrowed / Math.pow(10, decimals)) * p.price;
      const reserveADA = (p.reserve / Math.pow(10, decimals)) * p.price;
      const unpaidADA = (p.totalUnpaidInterest / Math.pow(10, decimals)) * p.price;
      const suppliedUSD = suppliedADA * adaPrice;
      const borrowedUSD = borrowedADA * adaPrice;
      const reserveUSD = reserveADA * adaPrice;
      const unpaidUSD = unpaidADA * adaPrice;
      const volADA = (p.totalVolume / Math.pow(10, decimals)) * p.price;
      const volUSD = volADA * adaPrice;

      totalSuppliedUSD += suppliedUSD;
      totalReserveUSD += reserveUSD;
      totalUnpaidInterestUSD += unpaidUSD;
      totalVolumeUSD += volUSD;

      poolBreakdown[p.poolId] = {
        ticker: p.ticker,
        supplied_usd: suppliedUSD,
        borrowed_usd: borrowedUSD,
        reserve_usd: reserveUSD,
        positions: poolPosCount[p.poolId] || 0,
      };
    }

    const avgLtv = allPositions.length > 0 ? totalLtv / allPositions.length : 0;
    const weightedApr = totalBorrowedUSD > 0 ? totalApr / totalBorrowedUSD : 0;
    const avgSupplyApy = poolEntries.length > 0
      ? poolEntries.reduce((s, p) => s + (p.supplyApy || 0), 0) / poolEntries.length
      : 0;

    const fetchDuration = Date.now() - start;

    const { error: protoErr } = await supabase
      .from('surf_protocol_snapshots')
      .insert({
        snapshot_at: new Date(start).toISOString(),
        total_pools: poolEntries.length,
        total_positions: allPositions.length,
        positions_healthy: healthy,
        positions_at_risk: atRisk,
        positions_liquidatable: liquidatable,
        healthy_value_usd: healthyValue,
        at_risk_value_usd: atRiskValue,
        liquidatable_value_usd: liquidatableValue,
        total_supplied_usd: totalSuppliedUSD,
        total_borrowed_usd: totalBorrowedUSD,
        total_collateral_usd: totalCollateralUSD,
        total_net_value_usd: totalNetValueUSD,
        total_reserve_usd: totalReserveUSD,
        total_unpaid_interest_usd: totalUnpaidInterestUSD,
        avg_ltv: avgLtv,
        avg_borrow_apr: weightedApr,
        avg_supply_apy: avgSupplyApy,
        total_volume_usd: totalVolumeUSD,
        ltv_buckets: buckets,
        pool_breakdown: poolBreakdown,
        surf_price: surfPrice,
        surf_price_usd: surfPrice * adaPrice,
        ada_price: adaPrice,
        fetch_duration_ms: fetchDuration,
      });

    if (protoErr) {
      console.error('protocol snapshot insert error:', protoErr);
      return res.status(500).json({ error: 'db insert failed', detail: protoErr.message });
    }

    const poolSnapshotRows = poolEntries.map(p => {
      const decimals = p.decimals || 0;
      const suppliedADA = (p.totalSupplied / Math.pow(10, decimals)) * p.price;
      const borrowedADA = (p.totalBorrowed / Math.pow(10, decimals)) * p.price;
      const reserveADA = (p.reserve / Math.pow(10, decimals)) * p.price;
      const unpaidADA = (p.totalUnpaidInterest / Math.pow(10, decimals)) * p.price;
      const suppliedUSD = suppliedADA * adaPrice;
      const borrowedUSD = borrowedADA * adaPrice;
      const reserveUSD = reserveADA * adaPrice;
      const unpaidUSD = unpaidADA * adaPrice;
      const volADA = (p.totalVolume / Math.pow(10, decimals)) * p.price;
      const volUSD = volADA * adaPrice;

      return {
        pool_id: p.poolId,
        snapshot_at: new Date(start).toISOString(),
        ticker: p.ticker,
        policy_id: p.policyId,
        asset_name: p.assetName,
        decimals: p.decimals,
        price_ada: p.price,
        price_usd: p.price * adaPrice,
        total_supplied: p.totalSupplied,
        total_borrowed: p.totalBorrowed,
        reserve: p.reserve,
        total_supplied_usd: suppliedUSD,
        total_borrowed_usd: borrowedUSD,
        reserve_usd: reserveUSD,
        supply_apy: p.supplyApy,
        borrow_apr: p.borrowApr,
        utilization_rate: p.u,
        total_ctoken: p.totalCToken,
        total_unpaid_interest: p.totalUnpaidInterest,
        total_unpaid_interest_usd: unpaidUSD,
        max_ltv: p.maxBorrowLTV,
        liq_threshold_ltv: p.liquidationThresholdLTV,
        recommended_ltv: p.recommendedBorrowLTV,
        positions_in_pool: poolPosCount[p.poolId] || 0,
        total_volume_usd: volUSD,
        historical_apy: p.historicalApy,
        collateral_assets: p.collateralAssets,
      };
    });

    const { error: poolErr } = await supabase
      .from('surf_pool_snapshots')
      .insert(poolSnapshotRows);

    if (poolErr) {
      console.error('pool snapshot insert error:', poolErr);
      return res.status(500).json({ error: 'pool insert failed', detail: poolErr.message });
    }

    return res.json({
      success: true,
      snapshot_at: new Date(start).toISOString(),
      duration_ms: Date.now() - start,
      stats: {
        pools: poolEntries.length,
        positions: allPositions.length,
        healthy,
        at_risk: atRisk,
        liquidatable,
        total_borrowed_usd: totalBorrowedUSD,
        total_collateral_usd: totalCollateralUSD,
        total_net_value_usd: totalNetValueUSD,
      },
    });
  } catch (e) {
    console.error('snapshot error:', e);
    return res.status(500).json({ error: e.message });
  }
}
