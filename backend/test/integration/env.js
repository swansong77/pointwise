// Defaults for integration runs; real values come from the environment (docker compose / CI).
process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-0123456789abcdef';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-0123456789abcdef';
process.env.INTERNAL_API_SECRET ??= 'integration-internal-secret';
process.env.AUTH_RATE_LIMIT_PER_MIN ??= '1000';
process.env.RATE_LIMIT_PER_MIN ??= '10000';
process.env.MAIL_DISABLED ??= 'true';
// a separate Redis DB so test jobs never reach the running stack's worker / notification-service
process.env.REDIS_URL ??= 'redis://localhost:6379/1';
process.env.TOKEN_ENC_KEY ??= 'integration-token-encryption-key-0123456789';
// deterministic offline model so AI tests never call a paid provider
process.env.AI_ENABLE_MOCK ??= 'true';
process.env.MCP_ALLOWED_HOSTS ??= '127.0.0.1';
process.env.AI_RATE_LIMIT_PER_MIN ??= '1000';
// never call paid providers from tests, even if keys are present in the shell
for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'AZURE_OPENAI_API_KEY', 'XAI_API_KEY', 'MISTRAL_API_KEY', 'DEEPSEEK_API_KEY', 'OPENROUTER_API_KEY']) delete process.env[k];
// card refresh engine: the fixture "issuer site" runs on 127.0.0.1 over http; no politeness delay in tests
process.env.CARD_SOURCE_HTTP_HOSTS ??= '127.0.0.1';
process.env.CARD_SOURCE_MIN_INTERVAL_MS ??= '0';
// alert-email inbox (automatic transaction capture)
process.env.INBOUND_EMAIL_DOMAIN ??= 'in.pointwise.test';
process.env.INBOUND_EMAIL_SECRET ??= 'inbound-test-secret-0123456789';
process.env.INBOUND_AUTHSERV_ID ??= 'mx.pointwise.test';
