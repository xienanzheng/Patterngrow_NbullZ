import fs from 'fs';
import path from 'path';
import { fetchYahooProfile } from './marketData.js';
import { supabaseAdmin } from './supabaseClient.js';

function loadFallbackMetadata() {
  try {
    const filePath = path.join(process.cwd(), 'backend', 'data', 'metadata-fallback.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.rows)) return parsed.rows;
  } catch (err) {
    console.warn('Fallback metadata file missing or invalid, using in-memory sample.', err.message);
  }
  return [
    {
      symbol: 'NVDA',
      name: 'NVIDIA Corporation',
      exchange: 'NASDAQ',
      sector: 'Technology',
      industry_group: 'Semiconductors',
      prototype_score: 0.95,
      market_cap_bucket: 'Mega',
      region: 'US',
      risk_bucket: 'High Volatility',
      style_factors: ['Growth', 'Momentum'],
      dividend_profile: 'Low',
      ipo_year: 1999,
      evidence: 'Fabless GPU and AI systems leader; >80% revenue from chips and platforms; NASDAQ listing; US-incorporated.',
    },
    {
      symbol: 'TSM',
      name: 'Taiwan Semiconductor Manufacturing',
      exchange: 'NYSE',
      sector: 'Technology',
      industry_group: 'Semiconductors',
      prototype_score: 0.93,
      market_cap_bucket: 'Mega',
      region: 'APAC',
      risk_bucket: 'Medium Volatility',
      style_factors: ['Growth'],
      dividend_profile: 'Stable',
      ipo_year: 1997,
      evidence: 'Pure-play foundry; ADR on NYSE; APAC revenue base; high capex/R&D.',
    },
    {
      symbol: 'MSFT',
      name: 'Microsoft Corporation',
      exchange: 'NASDAQ',
      sector: 'Technology',
      industry_group: 'Software',
      prototype_score: 0.88,
      market_cap_bucket: 'Mega',
      region: 'US',
      risk_bucket: 'Low Volatility',
      style_factors: ['Growth'],
      dividend_profile: 'Growing',
      ipo_year: 1986,
      evidence: 'Scaled subscription + cloud software; diversified revenue; prototype member for software.',
    },
    {
      symbol: 'AAPL',
      name: 'Apple Inc.',
      exchange: 'NASDAQ',
      sector: 'Technology',
      industry_group: 'Hardware / Devices',
      prototype_score: 0.7,
      market_cap_bucket: 'Mega',
      region: 'US',
      risk_bucket: 'Medium Volatility',
      style_factors: ['Growth'],
      dividend_profile: 'Moderate',
      ipo_year: 1980,
      evidence: 'Hardware + services mix; high-margin services lift resemblance to software prototype.',
    },
    {
      symbol: 'ASML',
      name: 'ASML Holding',
      exchange: 'NASDAQ',
      sector: 'Technology',
      industry_group: 'Semiconductors',
      prototype_score: 0.91,
      market_cap_bucket: 'Mega',
      region: 'EU',
      risk_bucket: 'Medium Volatility',
      style_factors: ['Growth'],
      dividend_profile: 'Moderate',
      ipo_year: 1995,
      evidence: 'EUV lithography monopoly; EU/US listings; Netherlands-incorporated.',
    },
    {
      symbol: 'AMD',
      name: 'Advanced Micro Devices',
      exchange: 'NASDAQ',
      sector: 'Technology',
      industry_group: 'Semiconductors',
      prototype_score: 0.77,
      market_cap_bucket: 'Large',
      region: 'US',
      risk_bucket: 'High Volatility',
      style_factors: ['Growth', 'Momentum'],
      dividend_profile: 'None',
      ipo_year: 1972,
      evidence: 'Fabless CPU/GPU designer; NASDAQ listing; peripheral to the semiconductor prototype.',
    },
    {
      symbol: 'SMCI',
      name: 'Super Micro Computer',
      exchange: 'NASDAQ',
      sector: 'Technology',
      industry_group: 'Infrastructure / AI-adjacent',
      prototype_score: 0.62,
      market_cap_bucket: 'Mid',
      region: 'US',
      risk_bucket: 'High Volatility',
      style_factors: ['Momentum'],
      dividend_profile: 'None',
      ipo_year: 2007,
      evidence: 'Server and rack systems; AI adjacency; peripheral to the semiconductor prototype.',
    },
  ];
}

const staticMetadata = loadFallbackMetadata();

const allowedFacets = ['sector', 'industry_group', 'region', 'market_cap_bucket', 'risk_bucket', 'style_factors', 'dividend_profile'];

function normalizeSymbol(symbol) {
  return typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
}

function applyLocalFilters(rows, filters) {
  return rows.filter((row) => {
    if (filters.symbol && normalizeSymbol(filters.symbol) !== row.symbol) return false;
    for (const facet of ['sector', 'industry_group', 'region', 'market_cap_bucket', 'risk_bucket', 'dividend_profile']) {
      if (filters[facet] && row[facet] !== filters[facet]) return false;
    }
    if (filters.style_factor && !(row.style_factors || []).includes(filters.style_factor)) return false;
    if (filters.min_ipo_year && row.ipo_year && row.ipo_year < filters.min_ipo_year) return false;
    return true;
  });
}

async function listMetadataFromSupabase(filters = {}, { limit = 100, offset = 0 } = {}) {
  const query = supabaseAdmin.from('ticker_metadata').select('*').range(offset, offset + limit - 1);

  if (filters.symbol) query.eq('symbol', normalizeSymbol(filters.symbol));
  if (filters.sector) query.eq('sector', filters.sector);
  if (filters.industry_group) query.eq('industry_group', filters.industry_group);
  if (filters.region) query.eq('region', filters.region);
  if (filters.market_cap_bucket) query.eq('market_cap_bucket', filters.market_cap_bucket);
  if (filters.risk_bucket) query.eq('risk_bucket', filters.risk_bucket);
  if (filters.dividend_profile) query.eq('dividend_profile', filters.dividend_profile);
  if (filters.style_factor) query.contains('style_factors', [filters.style_factor]);
  if (filters.min_ipo_year) query.gte('ipo_year', filters.min_ipo_year);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function listMetadata(filters = {}, options = {}) {
  try {
    const rows = await listMetadataFromSupabase(filters, options);
    if (rows.length > 0) return rows;
  } catch (err) {
    // Fall through to static sample if Supabase is unavailable
    console.warn('Supabase metadata unavailable, falling back to static sample', err.message);
  }
  return applyLocalFilters(staticMetadata, filters).slice(0, options.limit ?? 100);
}

function classifyMarketCapBucket(cap) {
  if (!cap || !Number.isFinite(cap)) return null;
  if (cap >= 200_000_000_000) return 'Mega';
  if (cap >= 10_000_000_000) return 'Large';
  if (cap >= 2_000_000_000) return 'Mid';
  if (cap >= 300_000_000) return 'Small';
  return 'Micro';
}

function classifyRegion(country) {
  if (!country) return null;
  const normalized = country.toUpperCase();
  if (['UNITED STATES', 'USA', 'US'].includes(normalized)) return 'US';
  if (['CANADA', 'CA'].includes(normalized)) return 'Americas';
  if (['NETHERLANDS', 'GERMANY', 'FRANCE', 'UNITED KINGDOM', 'UK', 'GB'].includes(normalized)) return 'EU';
  if (['TAIWAN', 'JAPAN', 'KOREA', 'SOUTH KOREA', 'CHINA', 'SINGAPORE', 'HONG KONG'].includes(normalized)) return 'APAC';
  return 'Global';
}

function buildMetadataFromYahoo(symbol, yahoo) {
  if (!yahoo) return null;
  const price = yahoo.price ?? {};
  const profile = yahoo.profile ?? {};
  const marketCap = price.marketCap ?? price.marketCapRaw ?? null;
  const region = profile.country ? classifyRegion(profile.country) : null;
  const riskBucket = price.beta != null
    ? price.beta > 1.2
      ? 'High Volatility'
      : price.beta > 0.8
        ? 'Medium Volatility'
        : 'Low Volatility'
    : null;

  return {
    symbol: symbol,
    name: price.longName ?? price.shortName ?? symbol,
    exchange: price.exchangeName ?? price.fullExchangeName ?? null,
    sector: profile.sector ?? null,
    industry_group: profile.industry ?? null,
    region,
    market_cap_bucket: classifyMarketCapBucket(marketCap),
    risk_bucket: riskBucket,
    style_factors: [],
    dividend_profile: price.trailingAnnualDividendRate ? 'Payer' : 'None/Unknown',
    prototype_score: null,
    ipo_year: price.firstTradeDateMilliseconds
      ? new Date(price.firstTradeDateMilliseconds).getFullYear()
      : null,
    evidence: profile.longBusinessSummary
      ? `${profile.longBusinessSummary.slice(0, 200)}...`
      : 'Auto-enriched from Yahoo profile.',
    source: 'yahoo',
  };
}

async function upsertSupabaseMetadata(row) {
  const { error } = await supabaseAdmin.from('ticker_metadata').upsert(row, { onConflict: 'symbol' });
  if (error) throw error;
  return row;
}

export async function upsertMetadataRows(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const sanitized = rows.map((row) => ({
    ...row,
    symbol: normalizeSymbol(row.symbol),
  })).filter((row) => row.symbol);
  if (sanitized.length === 0) return [];
  const { data, error } = await supabaseAdmin.from('ticker_metadata').upsert(sanitized, { onConflict: 'symbol' }).select();
  if (error) throw error;
  return data ?? [];
}

export async function getTickerMetadata(symbol) {
  if (!symbol) return null;
  try {
    const { data, error } = await supabaseAdmin.from('ticker_metadata').select('*').eq('symbol', normalizeSymbol(symbol)).maybeSingle();
    if (error) throw error;
    if (data) return data;

    // Try to fetch and upsert from Yahoo if not found.
    const yahoo = await fetchYahooProfile(symbol);
    const row = buildMetadataFromYahoo(symbol, yahoo);
    if (row) {
      await upsertSupabaseMetadata(row);
      return row;
    }
  } catch (err) {
    console.warn('Supabase metadata unavailable for symbol', symbol, err.message);
  }
  return staticMetadata.find((item) => item.symbol === normalizeSymbol(symbol)) ?? null;
}

export async function listFacetOptions() {
  const sets = {
    sector: new Set(),
    industry_group: new Set(),
    region: new Set(),
    market_cap_bucket: new Set(),
    risk_bucket: new Set(),
    style_factors: new Set(),
    dividend_profile: new Set(),
  };

  let rows = [];
  try {
    const { data, error } = await supabaseAdmin
      .from('ticker_metadata')
      .select('sector,industry_group,region,market_cap_bucket,risk_bucket,style_factors,dividend_profile,ipo_year')
      .limit(500);
    if (error) throw error;
    rows = data ?? [];
  } catch (err) {
    console.warn('Supabase metadata facets fallback to static sample', err.message);
    rows = staticMetadata;
  }

  rows.forEach((row) => {
    if (row.sector) sets.sector.add(row.sector);
    if (row.industry_group) sets.industry_group.add(row.industry_group);
    if (row.region) sets.region.add(row.region);
    if (row.market_cap_bucket) sets.market_cap_bucket.add(row.market_cap_bucket);
    if (row.risk_bucket) sets.risk_bucket.add(row.risk_bucket);
    if (row.dividend_profile) sets.dividend_profile.add(row.dividend_profile);
    (row.style_factors ?? []).forEach((factor) => sets.style_factors.add(factor));
  });

  const serialize = (set) => Array.from(set).sort();
  return Object.fromEntries(Object.entries(sets).map(([key, set]) => [key, serialize(set)]));
}

export function getAllowedFacetKeys() {
  return allowedFacets;
}
