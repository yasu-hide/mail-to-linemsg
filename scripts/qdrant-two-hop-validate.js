const fsp = require('node:fs/promises');
const path = require('node:path');

const QUERY_RESULTS_DIR = path.join(process.cwd(), 'artifacts', 'qdrant', 'query-results');

const THEMES = [
  {
    id: 'parse',
    hop1Query: 'mail webhook multipart parse transfer-encoding charset fallback',
    hop2Query: 'belongs_to:file:lib/mail-webhook.js tested_by:file:test/e2e-mail-samples.test.js related_doc:file:docs/system-overview.md',
    hop2File: path.join(QUERY_RESULTS_DIR, 'parse-hop2.txt'),
    requiredPaths: ['lib/mail-webhook.js', 'test/e2e-mail-samples.test.js', 'docs/system-overview.md'],
  },
  {
    id: 'signature',
    hop1Query: 'inbound parse webhook signature ecdsa p256 verification',
    hop2Query: 'belongs_to:file:lib/inbound-parse-webhook-signature.js tested_by:file:test/inbound-parse-webhook-signature.test.js related_doc:file:docs/api-reference.md',
    hop2File: path.join(QUERY_RESULTS_DIR, 'signature-hop2.txt'),
    requiredPaths: ['lib/inbound-parse-webhook-signature.js', 'test/inbound-parse-webhook-signature.test.js', 'docs/api-reference.md'],
  },
  {
    id: 'payload',
    hop1Query: 'mail text normalization html to text line message payload',
    hop2Query: 'belongs_to:file:lib/mail-text.js tested_by:file:test/mail-text.test.js related_doc:file:README.md',
    hop2File: path.join(QUERY_RESULTS_DIR, 'payload-hop2.txt'),
    requiredPaths: ['lib/mail-text.js', 'test/mail-text.test.js', 'README.md'],
  },
];

function tryParseJsonAsText(raw) {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return raw;
  try {
    const parsed = JSON.parse(trimmed);
    return JSON.stringify(parsed);
  } catch (_error) {
    return raw;
  }
}

function toMarkdown(report) {
  const lines = [];
  lines.push('# Qdrant Two-Hop Validation');
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push('- Scope: 3 themes x 2-hop queries (1st intent query + 2nd links query)');
  lines.push('');
  lines.push('## Query Set');
  lines.push('');

  for (const theme of report.themes) {
    lines.push(`### ${theme.id}`);
    lines.push(`- Hop1: \`${theme.hop1Query}\``);
    lines.push(`- Hop2: \`${theme.hop2Query}\``);
    lines.push(`- Hop2 Result File: \`${path.relative(process.cwd(), theme.hop2File)}\``);
    lines.push('');
  }

  lines.push('## Results');
  lines.push('');
  lines.push('| Theme | Required Path | Result |');
  lines.push('|---|---|---|');
  for (const check of report.checks) {
    lines.push(`| ${check.theme} | ${check.requiredPath} | ${check.result} |`);
  }
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total checks: ${report.totalChecks}`);
  lines.push(`- Passed: ${report.passedChecks}`);
  lines.push(`- Failed: ${report.failedChecks}`);
  lines.push(`- Gate: ${report.gate}`);
  return lines.join('\n');
}

async function main() {
  const checks = [];

  for (const theme of THEMES) {
    let text = '';
    try {
      const raw = await fsp.readFile(theme.hop2File, 'utf-8');
      text = tryParseJsonAsText(raw);
    } catch (_error) {
      text = '';
    }

    for (const requiredPath of theme.requiredPaths) {
      const result = text.includes(requiredPath) ? 'PASS' : 'FAIL';
      checks.push({
        theme: theme.id,
        hop2File: theme.hop2File,
        requiredPath,
        result,
      });
    }
  }

  const totalChecks = checks.length;
  const passedChecks = checks.filter((check) => check.result === 'PASS').length;
  const failedChecks = totalChecks - passedChecks;
  const gate = failedChecks === 0 ? 'PASS' : 'FAIL';

  const report = {
    generatedAt: new Date().toISOString(),
    totalChecks,
    passedChecks,
    failedChecks,
    gate,
    themes: THEMES,
    checks,
  };

  const outDir = path.join(process.cwd(), 'artifacts', 'qdrant');
  const outJson = path.join(outDir, 'two-hop-validation.json');
  const outMd = path.join(outDir, 'two-hop-validation.md');
  await fsp.mkdir(outDir, { recursive: true });
  await fsp.writeFile(outJson, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fsp.writeFile(outMd, `${toMarkdown(report)}\n`, 'utf-8');

  console.log(`[qdrant] validation: ${path.relative(process.cwd(), outMd)}`);
  console.log(`[qdrant] checks=${totalChecks} pass=${passedChecks} fail=${failedChecks} gate=${gate}`);

  if (process.env.QDRANT_TWO_HOP_GATE === '1' && gate === 'FAIL') {
    console.error('[qdrant] gate failed (set QDRANT_TWO_HOP_GATE=1)');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[qdrant] failed to validate two-hop results', error);
  process.exitCode = 1;
});
