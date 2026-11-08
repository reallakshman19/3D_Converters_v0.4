function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function parseConfig(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function object(parent, key) {
  if (!parent[key] || typeof parent[key] !== 'object' || Array.isArray(parent[key])) parent[key] = {};
  return parent[key];
}

export function modeARigidReviewIdentity(sourceId, issueKey) {
  return `${text(sourceId)}::${text(issueKey)}`;
}

export function flattenModeARigidReviewEntries(entries = []) {
  const rows = [];
  for (const entry of entries || []) {
    for (const issue of entry?.issues || []) {
      rows.push({
        ...issue,
        sourceId: entry.sourceId,
        fileName: entry.fileName,
        alias: entry.alias || '',
        reviewId: modeARigidReviewIdentity(entry.sourceId, issue.key),
      });
    }
  }
  return rows;
}

export function applyModeAConsolidatedRigidReviewUpdates(state = {}, updates = {}) {
  const batch = state.sourceBatch || {};
  const sources = (batch.sources || []).map((source) => {
    const patch = updates?.[source.sourceId];
    if (!patch) return source;
    const config = parseConfig(source.supportConfigJson || '{}');
    const overrides = object(config, 'overrides');
    const ratings = patch.ratingsByKey && typeof patch.ratingsByKey === 'object' ? patch.ratingsByKey : {};
    const weights = patch.weightsByKey && typeof patch.weightsByKey === 'object' ? patch.weightsByKey : {};
    const skips = patch.skippedByKey && typeof patch.skippedByKey === 'object' ? patch.skippedByKey : {};
    if (Object.keys(skips).length) {
      // Zero kg is NOT a physical source-mass override. Record the Owner's
      // explicit skip in separate run custody, never in overrides.rigidWeight.
      const bucket=object(overrides,'rigidWeightSkipped');
      for(const [key,record] of Object.entries(skips)){
        if(text(key) && record?.skipped===true && Number(record?.weightKg)===0){
          if(Number(overrides.rigidWeight?.[key])>0)
            throw new Error('Cannot skip source mass with existing positive override: '+key);
          bucket[key]={skipped:true,weightKg:0,
            reason:'EXPLICIT_ZERO_MASS_SKIP_NO_SOURCE_AUTHORITY'};
        }
      }
    }
    if (Object.keys(ratings).length) {
      const bucket = object(overrides, 'rating');
      for (const [key, value] of Object.entries(ratings)) if (text(key) && text(value)) bucket[key] = text(value);
    }
    if (Object.keys(weights).length) {
      const bucket = object(overrides, 'rigidWeight');
      for (const [key, value] of Object.entries(weights)) {
        const numeric = Number(value);
        if (text(key) && Number.isFinite(numeric) && numeric > 0) {
          bucket[key] = numeric;
          // A subsequent approved or manual source mass replaces a prior skip.
          if(overrides.rigidWeightSkipped)delete overrides.rigidWeightSkipped[key];
          // Old receipts cannot independently approve a different new mass.
          const previous=overrides.rigidWeightReviewReceipts?.[key];
          if(previous && Math.abs(Number(previous.weightKg)-numeric)>1e-9)
            delete overrides.rigidWeightReviewReceipts[key];
        }
      }
    }
    const receipts=patch.reviewReceiptsByKey && typeof patch.reviewReceiptsByKey==='object'
      ? patch.reviewReceiptsByKey : {};
    if(Object.keys(receipts).length){
      const bucket=object(overrides,'rigidWeightReviewReceipts');
      for(const [key,receipt] of Object.entries(receipts)){
        const mass=Number(weights[key]);
        const recorded=Number(receipt?.weightKg);
        const method=text(receipt?.reviewMethod);
        const allowed=['EXPLICIT_BULK_OWNER_ATTESTATION','EXPLICIT_INDIVIDUAL_OWNER_REVIEW'];
        if(!text(key)||receipt?.reviewed!==true || !allowed.includes(method) ||
           !(Number.isFinite(mass)&&mass>0) ||
           !Number.isFinite(recorded)||Math.abs(mass-recorded)>1e-9)
          throw new Error('Invalid physical mass review receipt: '+key);
        bucket[key]={
          reviewed:true,reviewMethod:method,weightKg:mass,
          sourceComponentRef:text(receipt.sourceComponentRef),
          sourceEndpoint:text(receipt.sourceEndpoint),
          statement:'Reviewer confirms independent physical-component mass verification',
        };
      }
    }
    return { ...source, supportConfigJson: JSON.stringify(config, null, 2) };
  });
  const active = sources.find((source) => source.sourceId === batch.activeSourceId) || null;
  return {
    ...state,
    supportConfigJson: active?.supportConfigJson || state.supportConfigJson,
    sourceBatch: { ...batch, sources },
  };
}
