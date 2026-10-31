const { generateJson } = require('../llm');
const { validateConfig } = require('../config');

async function main() {
  console.log('[Smoke Test] Validating AI configuration...');

  let config;
  try {
    config = validateConfig();
    console.log(`[Smoke Test] Configuration valid.`);
    console.log(`  • Provider : ${config.AI_PROVIDER}`);
    console.log(`  • Model    : ${config.AI_MODEL}`);
    console.log(`  • Timeout  : ${config.AI_TIMEOUT_MS}ms`);
    console.log(`  • Retries  : ${config.AI_MAX_RETRIES}`);
  } catch (configErr) {
    console.error(`\n❌ Configuration Error:\n${configErr.message}\n`);
    console.error('To run this smoke test, please supply the required environment variables:');
    console.error('  AI_PROVIDER=gemini (or openai)');
    console.error('  AI_API_KEY=<your_api_key>');
    console.error('  AI_MODEL=gemini-2.5-flash (or gpt-4o-mini)');
    process.exit(1);
  }

  console.log('\n[Smoke Test] Invoking generateJson() with trivial prompt...');
  const startTime = Date.now();

  try {
    const result = await generateJson({
      system: 'You are an automated diagnostic test agent. Output strictly valid JSON conforming to the schema.',
      user: 'Please acknowledge that the CaseMind AI connection is operating correctly.',
      jsonSchema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description: 'Connection status, e.g. "ok"',
          },
          message: {
            type: 'string',
            description: 'Short confirmation message',
          },
          timestamp: {
            type: 'string',
            description: 'ISO-8601 current timestamp',
          },
        },
        required: ['status', 'message'],
      },
      temperature: 0.1,
    });

    const elapsed = Date.now() - startTime;
    console.log(`\n✅ [Smoke Test Succeeded] Received response in ${elapsed}ms:`);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 0;
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`\n❌ [Smoke Test Failed] after ${elapsed}ms:`);
    console.error(err.message);
    process.exitCode = 1;
  }
}

main();
