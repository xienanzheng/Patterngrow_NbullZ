import { pathToFileURL, fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { createResearchTools, HISTORY_RANGES, MAX_HISTORY_ROWS, toToolError, toToolResult } from './researchTools.js';

const symbolSchema = z.string().trim().min(1).max(15).regex(/^[A-Z0-9^][A-Z0-9.^-]*$/i)
  .describe('One exchange ticker, for example AAPL or BRK-B. URLs are not accepted.');
const commonFields = {
  symbol: symbolSchema,
  range: z.enum(HISTORY_RANGES).default('1y').describe('Bounded daily history window, up to two years.'),
};

export function createResearchMcpServer(dependencies) {
  const handlers = createResearchTools(dependencies);
  const server = new McpServer({ name: 'patterngrow-research', version: '1.1.0' });
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  const wrap = (handler) => async (input) => {
    try {
      return toToolResult(await handler(input));
    } catch {
      return toToolError();
    }
  };

  server.registerTool('get_market_history', {
    title: 'Historical daily market observations',
    description: 'Read bounded daily OHLCV observations and source labels for descriptive market research. No execution or account access.',
    inputSchema: z.object({
      ...commonFields,
      limit: z.number().int().min(1).max(MAX_HISTORY_ROWS).default(250),
    }).strict(),
    annotations: readOnly,
  }, wrap(handlers.getMarketHistory));

  server.registerTool('get_market_research', {
    title: 'Historical volume and risk statistics',
    description: 'Calculate descriptive volume, volatility, drawdown and data-quality statistics from daily observations. These describe history and do not recommend actions.',
    inputSchema: z.object(commonFields).strict(),
    annotations: readOnly,
  }, wrap(handlers.getMarketResearch));

  server.registerTool('get_market_comparison', {
    title: 'Historical benchmark comparison',
    description: 'Compare one symbol with one benchmark on common daily sessions: indexed prices, historical returns, correlation, beta and tracking error. No investment recommendations or account access.',
    inputSchema: z.object({ ...commonFields, benchmark: symbolSchema.default('SPY') }).strict(),
    annotations: readOnly,
  }, wrap(handlers.getMarketComparison));

  server.registerTool('get_market_overview', {
    title: 'Historical market overview',
    description: 'Describe six fixed market proxies using daily historical observations, source dates and coverage caveats. No custom symbol list or live quotes; unavailable rows remain explicitly unavailable.',
    inputSchema: z.object({}).strict(),
    annotations: readOnly,
  }, wrap(handlers.getMarketOverview));

  server.registerTool('get_provider_status', {
    title: 'Data provider configuration',
    description: 'Report configured provider flags and known coverage caveats. Configuration does not prove health, credentials or data entitlement; no keys are returned.',
    inputSchema: z.object({}).strict(),
    annotations: { ...readOnly, openWorldHint: false },
  }, wrap(handlers.getProviderStatus));

  return server;
}

async function main() {
  // Resolve the project's optional environment file independently of the host's working directory.
  // Loading configuration before the dynamic imports is necessary for providers that read env at import time.
  dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
  const [{ getResearchSnapshot }, { buildMarketResearch }, { getProviderStatus }, { getComparisonSnapshot }, { getMarketOverview }] = await Promise.all([
    import('../utils/researchService.js'),
    import('../utils/marketResearch.js'),
    import('../utils/providerStatus.js'),
    import('../utils/comparisonService.js'),
    import('../utils/marketOverview.js'),
  ]);
  serveStdio(() => createResearchMcpServer({
    getResearchSnapshot,
    buildResearch: buildMarketResearch,
    providerStatus: getProviderStatus,
    getComparisonSnapshot,
    getMarketOverview,
  }), { transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 64_000 }) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // stdout is exclusively MCP protocol; do not echo environment or upstream errors.
    console.error('PatternGrow research MCP failed to start. Check installed dependencies and local configuration.');
    process.exitCode = 1;
  });
}
