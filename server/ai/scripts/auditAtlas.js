const { runAtlasAudit } = require('../../../scripts/auditAtlas');

if (require.main === module) {
  runAtlasAudit().catch((err) => {
    console.error('Fatal audit error:', err);
    process.exit(1);
  });
}

module.exports = { runAtlasAudit };
