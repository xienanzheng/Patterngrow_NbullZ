// Static metadata profiles used to demonstrate prototype/periphery, rule-based taxonomy, and faceted classification.
// In a production system these would be hydrated from a datastore, but the shape here is sufficient for the UI + API to reason about categories.

const prototypeProfiles = {
  Semiconductors: {
    prototypeSymbols: ['NVDA', 'TSM', 'ASML'],
    description:
      'Prototype members are vertically integrated or design-first chip leaders with high R&D intensity and dominant market share.',
  },
  Software: {
    prototypeSymbols: ['MSFT', 'ADBE'],
    description: 'Prototype members deliver scaled subscription software with diversified revenue and high gross margins.',
  },
};

const metadataTable = [
  {
    symbol: 'NVDA',
    name: 'NVIDIA Corporation',
    sector: 'Technology',
    industryGroup: 'Semiconductors',
    prototypeScore: 0.95,
    marketCapBucket: 'Mega',
    region: 'US',
    riskBucket: 'High Volatility',
    styleFactors: ['Growth', 'Momentum'],
    dividendProfile: 'Low',
    evidence: 'Fabless GPU and AI systems leader; >80% revenue from chips and platforms; NASDAQ listing; US-incorporated.',
  },
  {
    symbol: 'TSM',
    name: 'Taiwan Semiconductor Manufacturing',
    sector: 'Technology',
    industryGroup: 'Semiconductors',
    prototypeScore: 0.93,
    marketCapBucket: 'Mega',
    region: 'APAC',
    riskBucket: 'Medium Volatility',
    styleFactors: ['Growth'],
    dividendProfile: 'Stable',
    evidence: 'Pure-play foundry; TSMC ADR on NYSE; APAC revenue base; high capex/R&D.',
  },
  {
    symbol: 'ASML',
    name: 'ASML Holding',
    sector: 'Technology',
    industryGroup: 'Semiconductors',
    prototypeScore: 0.91,
    marketCapBucket: 'Mega',
    region: 'EU',
    riskBucket: 'Medium Volatility',
    styleFactors: ['Growth'],
    dividendProfile: 'Moderate',
    evidence: 'EUV lithography monopoly; EURONEXT/NASDAQ dual listing; Netherlands-incorporated.',
  },
  {
    symbol: 'AMD',
    name: 'Advanced Micro Devices',
    sector: 'Technology',
    industryGroup: 'Semiconductors',
    prototypeScore: 0.77,
    marketCapBucket: 'Large',
    region: 'US',
    riskBucket: 'High Volatility',
    styleFactors: ['Growth', 'Momentum'],
    dividendProfile: 'None',
    evidence: 'Fabless CPU/GPU designer; NASDAQ listing; high R&D; revenue tied to chips but more cyclical — peripheral member.',
  },
  {
    symbol: 'SMCI',
    name: 'Super Micro Computer',
    sector: 'Technology',
    industryGroup: 'Infrastructure / AI-adjacent',
    prototypeScore: 0.62,
    marketCapBucket: 'Mid',
    region: 'US',
    riskBucket: 'High Volatility',
    styleFactors: ['Momentum'],
    dividendProfile: 'None',
    evidence: 'Server and rack systems; AI adjacency; NASDAQ listing; peripheral to the semiconductor prototype.',
  },
  {
    symbol: 'MSFT',
    name: 'Microsoft Corporation',
    sector: 'Technology',
    industryGroup: 'Software',
    prototypeScore: 0.88,
    marketCapBucket: 'Mega',
    region: 'US',
    riskBucket: 'Low Volatility',
    styleFactors: ['Growth'],
    dividendProfile: 'Growing',
    evidence: 'Scaled subscription + cloud software; NASDAQ listing; diversified revenue; prototype member for software.',
  },
  {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    sector: 'Technology',
    industryGroup: 'Hardware / Devices',
    prototypeScore: 0.7,
    marketCapBucket: 'Mega',
    region: 'US',
    riskBucket: 'Medium Volatility',
    styleFactors: ['Growth'],
    dividendProfile: 'Moderate',
    evidence: 'Hybrid hardware/services; NASDAQ listing; high margin services keep it closer to prototype than pure hardware.',
  },
];

const allowedFacets = ['sector', 'industryGroup', 'region', 'marketCapBucket', 'riskBucket', 'styleFactors', 'dividendProfile'];

function normalizeSymbol(symbol) {
  return typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
}

export function listMetadata(filters = {}) {
  return metadataTable.filter((row) => {
    // Apply exact-match filters for scalar facets
    for (const facet of ['sector', 'industryGroup', 'region', 'marketCapBucket', 'riskBucket', 'dividendProfile']) {
      if (filters[facet] && row[facet] !== filters[facet]) return false;
    }
    // Style factors can be multi-valued
    if (filters.styleFactor && !row.styleFactors.includes(filters.styleFactor)) {
      return false;
    }
    if (filters.minPrototypeScore != null && typeof filters.minPrototypeScore === 'number') {
      if ((row.prototypeScore ?? 0) < filters.minPrototypeScore) return false;
    }
    if (filters.symbol && normalizeSymbol(filters.symbol) !== row.symbol) return false;
    return true;
  });
}

export function getTickerMetadata(symbol) {
  const row = metadataTable.find((item) => item.symbol === normalizeSymbol(symbol));
  if (!row) return null;
  const prototypeProfile = prototypeProfiles[row.industryGroup] || prototypeProfiles[row.sector] || null;
  return {
    ...row,
    categoryModel: {
      prototype: {
        anchor: prototypeProfile?.prototypeSymbols ?? [],
        description: prototypeProfile?.description ?? 'Prototype not defined for this sector.',
        score: row.prototypeScore,
      },
      classical: {
        regionRule: row.region ? `Primary listing region = ${row.region}; incorporation & exchange satisfy rule.` : null,
      },
      facets: {
        sector: row.sector,
        industryGroup: row.industryGroup,
        region: row.region,
        marketCapBucket: row.marketCapBucket,
        riskBucket: row.riskBucket,
        styleFactors: row.styleFactors,
        dividendProfile: row.dividendProfile,
      },
    },
  };
}

export function listFacetOptions() {
  const options = {
    sector: new Set(),
    industryGroup: new Set(),
    region: new Set(),
    marketCapBucket: new Set(),
    riskBucket: new Set(),
    styleFactors: new Set(),
    dividendProfile: new Set(),
  };

  metadataTable.forEach((row) => {
    options.sector.add(row.sector);
    options.industryGroup.add(row.industryGroup);
    options.region.add(row.region);
    options.marketCapBucket.add(row.marketCapBucket);
    options.riskBucket.add(row.riskBucket);
    options.dividendProfile.add(row.dividendProfile);
    row.styleFactors.forEach((factor) => options.styleFactors.add(factor));
  });

  const serialize = (set) => Array.from(set).sort();
  return Object.fromEntries(Object.entries(options).map(([key, set]) => [key, serialize(set)]));
}

export function getAllowedFacetKeys() {
  return allowedFacets;
}
