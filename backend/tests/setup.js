// Fake credentials so supabaseClient.js module-level guard passes,
// and VERCEL=1 so importing index.js never calls app.listen in tests.
process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://test-project.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'test-service-key';
process.env.VERCEL = '1';
