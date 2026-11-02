const reqId = () => Math.random().toString(36).slice(2, 8);

function log(id, step, data) {
  console.log(JSON.stringify({ reqId: id, step, ...data }));
}

function defaultKoiosUrl(network) {
  switch (network) {
    case 'preprod': return 'https://preprod.koios.rest/api/v1';
    case 'preview': return 'https://preview.koios.rest/api/v1';
    case 'sanchonet': return 'https://sancho.koios.rest/api/v1';
    default: return 'https://api.koios.rest/api/v1';
  }
}

function formatAssetId(policyId, assetName) {
  if (!policyId) return null;
  return policyId + (assetName || '');
}

async function koiosPost(url, body, label) {
  const id = label || reqId();
  log(id, 'koios-req', { url: url.slice(0, 60) + '..', bodyPreview: JSON.stringify(body).slice(0, 120) });
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  log(id, 'koios-resp', { status: resp.status, ok: resp.ok });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    log(id, 'koios-err-body', { text: text.slice(0, 300) });
    return null;
  }
  const json = await resp.json();
  log(id, 'koios-data', { isArray: Array.isArray(json), length: Array.isArray(json) ? json.length : typeof json });
  return json;
}

async function koiosGet(url, label) {
  const id = label || reqId();
  log(id, 'koios-get-req', { url: url.slice(0, 60) + '..' });
  const resp = await fetch(url);
  log(id, 'koios-get-resp', { status: resp.status, ok: resp.ok });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    log(id, 'koios-get-err-body', { text: text.slice(0, 300) });
    return null;
  }
  const json = await resp.json();
  log(id, 'koios-get-data', { json });
  return json;
}

function ipfsToHttp(url) {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('ipfs://')) return url.replace('ipfs://', 'https://ipfs.io/ipfs/');
  return url;
}

function extractCip25Metadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return { name: null, image: null };
  const cip25 = metadata['721'];
  if (cip25 && typeof cip25 === 'object') {
    for (const policyId of Object.keys(cip25)) {
      const policy = cip25[policyId];
      if (policy && typeof policy === 'object') {
        const keys = Object.keys(policy);
        if (keys.length > 0) {
          const entry = policy[keys[0]];
          if (entry && typeof entry === 'object') {
            return {
              name: typeof entry.name === 'string' ? entry.name : null,
              image: typeof entry.image === 'string' ? ipfsToHttp(entry.image) : null,
            };
          }
        }
      }
    }
  }
  return { name: null, image: null };
}

async function fetchTokenRegistry(policy, assetName) {
  const id = 'reg-' + reqId();
  if (!policy || !assetName) return null;
  const subject = (policy + assetName).toLowerCase();
  try {
    log(id, 'fetch', { subject: subject.slice(0, 24) + '...' });
    const resp = await fetch('https://tokens.cardano.org/metadata/' + subject);
    if (!resp.ok) return null;
    const data = await resp.json();
    log(id, 'got', { name: data.name?.value, ticker: data.ticker?.value, decimals: data.decimals?.value });
    return {
      name: data.name?.value || null,
      ticker: data.ticker?.value || null,
      decimals: data.decimals?.value != null ? Number(data.decimals.value) : null,
      logo: data.logo?.value ? 'data:image/png;base64,' + data.logo.value : null,
    };
  } catch (e) {
    log(id, 'error', { msg: e.message });
    return null;
  }
}

async function fetchAssetInfo(policy, assetName, koiosUrl) {
  const id = 'asset-' + reqId();
  if (!policy) return null;
  let supply = null, fingerprint = null, name = null, image = null;
  let ticker = null, decimals = null;
  try {
    log(id, 'fetch', { policy: policy.slice(0, 16) + '...', name: assetName || '(empty)' });
    const result = await koiosPost(koiosUrl + '/asset_info', {
      _asset_policy: policy,
      _asset_name: assetName || '',
    }, id);
    if (Array.isArray(result) && result.length > 0) {
      const info = result[0];
      log(id, 'got-info', { supply: info.total_supply, hasMeta: !!info.minting_tx_metadata, fingerprint: info.fingerprint });
      supply = info.total_supply;
      fingerprint = info.fingerprint || null;
      const meta = extractCip25Metadata(info.minting_tx_metadata);
      name = meta.name;
      image = meta.image;
    }
  } catch (e) {
    log(id, 'error', { msg: e.message });
  }
  if (assetName && (!name || !image || !ticker)) {
    log(id, 'registry-fallback', {});
    const reg = await fetchTokenRegistry(policy, assetName);
    if (reg) {
      if (!name) name = reg.name;
      if (!image) image = reg.logo;
      if (!ticker) ticker = reg.ticker;
      if (decimals == null) decimals = reg.decimals;
    }
  }
  return { supply, name, image, ticker, decimals, fingerprint };
}

async function fetchAdaSupply(koiosUrl) {
  const id = 'ada-supply-' + reqId();
  try {
    const result = await koiosGet(koiosUrl + '/totals', id);
    if (Array.isArray(result) && result.length > 0) {
      const circulating = result[0].circulating_supply;
      log(id, 'done', { circulating });
      return circulating;
    }
  } catch (e) {
    log(id, 'error', { msg: e.message });
  }
  return null;
}

async function fetchLatestBlock(koiosUrl) {
  const id = 'block-' + reqId();
  try {
    log(id, 'fetch-tip', { url: koiosUrl + '/tip' });
    const tip = await koiosGet(koiosUrl + '/tip', id);
    if (!tip || !Array.isArray(tip) || tip.length === 0) return null;
    const t = tip[0];
    const result = { height: t.block_no, slot: t.slot_no };
    log(id, 'tip-parsed', { result });
    return result;
  } catch (e) {
    log(id, 'error', { msg: e.message });
    return null;
  }
}

async function discoverAddresses(stakeAddresses, existingAddresses, koiosUrl) {
  if (!Array.isArray(stakeAddresses) || stakeAddresses.length === 0) return existingAddresses;
  const id = 'discover-' + reqId();
  const addrs = [].concat(existingAddresses || []);
  const existing = new Set(addrs);
  try {
    const result = await koiosPost(koiosUrl + '/account_addresses', { _stake_addresses: stakeAddresses }, id);
    if (Array.isArray(result)) {
      let discovered = 0;
      for (const account of result) {
        if (Array.isArray(account.addresses)) {
          for (const addr of account.addresses) {
            if (!existing.has(addr)) {
              addrs.push(addr);
              existing.add(addr);
              discovered++;
            }
          }
        }
      }
      log(id, 'discovered', { count: discovered, total: addrs.length });
    }
  } catch (e) {
    log(id, 'error', { msg: e.message });
  }
  return addrs;
}

async function checkBalance(addresses, stakeAddresses, targetPolicyId, targetAssetName, targetFingerprint, koiosUrl) {
  const id = 'bal-' + reqId();
  const isADA = !targetPolicyId;
  const matchAsset = (asset) => {
    if (targetFingerprint) return asset.fingerprint === targetFingerprint;
    if (asset.policy_id !== targetPolicyId) return false;
    if (!targetAssetName) return true;
    return (asset.asset_name || '') === targetAssetName;
  };
  let totalBalance = 0n;

  log(id, 'start', { isADA, targetPolicy: (targetPolicyId || '').slice(0, 16) + '...', targetAsset: targetAssetName || '(empty)', addrCount: addresses.length, stakeCount: stakeAddresses.length });

  if (isADA) {
    if (Array.isArray(stakeAddresses) && stakeAddresses.length > 0) {
      const result = await koiosPost(koiosUrl + '/account_info', { _stake_addresses: stakeAddresses }, id);
      if (Array.isArray(result)) {
        for (const acct of result) totalBalance += BigInt(acct.balance || '0');
      }
    }
    if (totalBalance <= 0n && Array.isArray(addresses) && addresses.length > 0) {
      const BATCH_SIZE = 50;
      for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
        const batch = addresses.slice(i, i + BATCH_SIZE);
        const result = await koiosPost(koiosUrl + '/address_info', { _addresses: batch }, id);
        if (Array.isArray(result)) {
          for (const entry of result) totalBalance += BigInt(entry.balance || '0');
        }
      }
    }
  } else {
    if (Array.isArray(stakeAddresses) && stakeAddresses.length > 0) {
      const result = await koiosPost(koiosUrl + '/account_assets', { _stake_addresses: stakeAddresses }, id);
      if (Array.isArray(result)) {
        for (const asset of result) {
          if (matchAsset(asset)) totalBalance += BigInt(asset.quantity || '0');
        }
      }
    }
    if (totalBalance <= 0n && Array.isArray(addresses) && addresses.length > 0) {
      const BATCH_SIZE = 50;
      for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
        const batch = addresses.slice(i, i + BATCH_SIZE);
        const result = await koiosPost(koiosUrl + '/address_assets', { _addresses: batch }, id);
        if (Array.isArray(result)) {
          for (const asset of result) {
            if (matchAsset(asset)) totalBalance += BigInt(asset.quantity || '0');
          }
        }
      }
    }
  }

  log(id, 'done', { total: totalBalance.toString() });
  return totalBalance;
}

async function fetchEpochInfo(koiosUrl) {
  const id = 'epoch-' + reqId();
  const EPOCH_SLOTS = 432000;
  try {
    const tip = await koiosGet(koiosUrl + '/tip', id);
    if (!tip || !Array.isArray(tip) || tip.length === 0) return null;
    const t = tip[0];
    const epochSlot = t.epoch_slot || 0;
    return {
      epochNo: t.epoch_no,
      epochSlot,
      remainingSeconds: EPOCH_SLOTS - epochSlot,
      progress: Math.min((epochSlot / EPOCH_SLOTS) * 100, 100),
    };
  } catch (e) {
    log(id, 'error', { msg: e.message });
    return null;
  }
}

export {
  reqId, log, defaultKoiosUrl, formatAssetId,
  koiosPost, koiosGet, ipfsToHttp,
  extractCip25Metadata, fetchTokenRegistry,
  fetchAssetInfo, fetchAdaSupply, fetchLatestBlock,
  discoverAddresses, checkBalance, fetchEpochInfo,
};
