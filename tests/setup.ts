process.env.APP_ENV = 'dev';
process.env.SECRET_KEY = 'test-secret-key';
process.env.ENCRYPTION_KEYS = JSON.stringify([
  { id: 'v2', secret: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=' },
]);
process.env.APIBRASIL_MODE_MOCK = 'true';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
