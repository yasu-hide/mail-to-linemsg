const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

function runGit(args, allowFail = false) {
  try {
    return execFileSync('git', args, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (allowFail) return '';
    throw error;
  }
}

function posixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch (_error) {
    return false;
  }
}

function getBaseRef() {
  const fromEnv = (process.env.QDRANT_BASE || '').trim();
  if (fromEnv) return fromEnv;

  const fromArg = (process.argv[2] || '').trim();
  if (fromArg) return fromArg;

  const refs = [
    ['merge-base', 'origin/main', 'HEAD'],
    ['merge-base', 'origin/master', 'HEAD'],
  ];

  for (const args of refs) {
    const out = runGit(args, true);
    if (out) return out;
  }

  return 'HEAD~1';
}

function getChangedPaths(baseRef) {
  const compare = runGit(['diff', '--name-only', `${baseRef}..HEAD`], true)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const unstaged = runGit(['diff', '--name-only'], true)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const staged = runGit(['diff', '--name-only', '--cached'], true)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const untracked = runGit(['ls-files', '--others', '--exclude-standard'], true)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const seen = new Set();
  const merged = [];
  for (const p of [...compare, ...staged, ...unstaged, ...untracked]) {
    const normalized = posixPath(p);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(normalized);
  }

  return merged;
}

function isTextLikeFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const deny = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.db']);
  if (deny.has(ext)) return false;
  return true;
}

function classifySourceKind(filePath) {
  const p = posixPath(filePath);
  const ext = path.extname(p).toLowerCase();

  if (p.startsWith('test/') || p.endsWith('.test.js')) return 'test';
  if (p.startsWith('docs/') || p === 'README.md') return 'doc';
  if (
    p === 'package.json'
    || p === 'mise.toml'
    || p === 'pnpm-lock.yaml'
    || p === 'pnpm-workspace.yaml'
    || p === 'Dockerfile'
    || p === 'Procfile'
    || p === 'fly.toml'
    || ext === '.sql'
  ) return 'config';
  if (p.startsWith('artifacts/') || p.startsWith('.local/')) return 'generated';
  if (ext === '.js' || ext === '.json' || ext === '.ejs' || ext === '.css' || ext === '.md') return 'source';
  return 'other';
}

function pickStrategy(lineCount, sourceKind) {
  if (sourceKind === 'generated' || sourceKind === 'other') return 'summary';
  if (sourceKind === 'doc') return lineCount <= 700 ? 'full' : 'summary';
  return lineCount <= 900 ? 'full' : 'summary';
}

function splitLines(text) {
  return text.replace(/\r\n/g, '\n').split('\n');
}

function extractImports(filePath, content) {
  const imports = new Set();
  const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
  const importRegex = /from\s+['"]([^'"]+)['"]/g;

  for (const regex of [requireRegex, importRegex]) {
    let m = regex.exec(content);
    while (m) {
      const spec = m[1];
      if (spec && spec.startsWith('.')) {
        const resolved = resolveRelativeImport(filePath, spec);
        if (resolved) imports.add(resolved);
      }
      m = regex.exec(content);
    }
  }

  return [...imports].sort();
}

function resolveRelativeImport(fromFilePath, specifier) {
  const base = path.resolve(process.cwd(), path.dirname(fromFilePath), specifier);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.json`,
    path.join(base, 'index.js'),
  ];

  for (const c of candidates) {
    if (fileExists(c)) {
      return posixPath(path.relative(process.cwd(), c));
    }
  }

  return null;
}

function extractExports(content) {
  const exportsFound = new Set();

  const namedExportRegex = /exports\.([A-Za-z0-9_$]+)/g;
  let m = namedExportRegex.exec(content);
  while (m) {
    exportsFound.add(m[1]);
    m = namedExportRegex.exec(content);
  }

  const objectExportRegex = /module\.exports\s*=\s*\{([\s\S]*?)\};?/g;
  m = objectExportRegex.exec(content);
  while (m) {
    const body = m[1] || '';
    body
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((name) => {
        const key = name.split(':')[0].trim();
        if (key) exportsFound.add(key);
      });
    m = objectExportRegex.exec(content);
  }

  return [...exportsFound].sort();
}

function extractFunctionSymbols(content) {
  const symbols = new Set();
  const fnDecl = /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g;
  let m = fnDecl.exec(content);
  while (m) {
    symbols.add(m[1]);
    m = fnDecl.exec(content);
  }

  const constFn = /(?:^|\n)\s*const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/g;
  m = constFn.exec(content);
  while (m) {
    symbols.add(m[1]);
    m = constFn.exec(content);
  }

  return [...symbols].sort().slice(0, 40);
}

function inferTestPath(filePath) {
  const ext = path.extname(filePath);
  const stem = path.basename(filePath, ext);
  const candidate = path.join('test', `${stem}.test.js`);
  return fileExists(path.join(process.cwd(), candidate)) ? posixPath(candidate) : null;
}

function inferRelatedDoc(filePath) {
  const p = posixPath(filePath);
  if (p.startsWith('docs/')) return p;
  if (p.startsWith('lib/') || p.startsWith('routes/') || p.startsWith('app/')) return 'docs/system-overview.md';
  return 'README.md';
}

function buildSearchHints(filePath, content) {
  const hints = new Set();
  const base = path.basename(filePath);
  const stem = base.replace(path.extname(base), '');
  hints.add(`path:${filePath}`);
  hints.add(`file:${base}`);
  if (stem) hints.add(`symbol:${stem}`);

  for (const symbol of extractFunctionSymbols(content).slice(0, 6)) {
    hints.add(`symbol:${symbol}`);
  }

  return [...hints];
}

function toMarkdown(report) {
  const lines = [];
  lines.push('# Qdrant Diff Targets');
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Base Ref: ${report.baseRef}`);
  lines.push(`- Targets: ${report.totalTargets} (full=${report.fullTargets}, summary=${report.summaryTargets})`);
  lines.push(`- Nodes: file=${report.fileNodes}, symbol=${report.symbolNodes}`);
  lines.push('');
  lines.push('| Node Type | Strategy | Path | Reason |');
  lines.push('|---|---|---|---|');

  for (const target of report.targets) {
    const reason = target.reason.replace(/\|/g, '/');
    lines.push(`| ${target.nodeType} | ${target.strategy} | ${target.path} | ${reason} |`);
  }

  return lines.join('\n');
}

async function buildTargets(changedPaths) {
  const targets = [];

  for (const changedPath of changedPaths) {
    const abs = path.join(process.cwd(), changedPath);
    if (!fileExists(abs) || !isTextLikeFile(changedPath)) continue;

    let content = '';
    try {
      content = await fsp.readFile(abs, 'utf-8');
    } catch (_error) {
      continue;
    }

    const lineCount = splitLines(content).length;
    const sourceKind = classifySourceKind(changedPath);
    const strategy = pickStrategy(lineCount, sourceKind);
    const imports = extractImports(changedPath, content);
    const exportsFound = extractExports(content);
    const searchHints = buildSearchHints(changedPath, content);

    const links = new Set();
    links.add(`belongs_to:file:${changedPath}`);

    const relatedDoc = inferRelatedDoc(changedPath);
    if (relatedDoc) links.add(`related_doc:file:${relatedDoc}`);

    const testPath = inferTestPath(changedPath);
    if (testPath) links.add(`tested_by:file:${testPath}`);

    for (const imported of imports) {
      links.add(`imports:file:${imported}`);
    }

    targets.push({
      nodeType: 'file',
      nodeId: `file:${changedPath}`,
      path: changedPath,
      lineCount,
      strategy,
      reason: `changed ${sourceKind} file`,
      sourceKind,
      links: [...links],
      searchHints,
      imports,
      exports: exportsFound,
    });

    const symbols = extractFunctionSymbols(content);
    for (const symbolName of symbols) {
      targets.push({
        nodeType: 'symbol',
        nodeId: `symbol:${changedPath}#${symbolName}`,
        path: changedPath,
        lineCount,
        strategy: 'summary',
        reason: `symbol ${symbolName} in changed file`,
        sourceKind,
        links: [`belongs_to:file:${changedPath}`, ...(testPath ? [`tested_by:file:${testPath}`] : [])],
        searchHints: [`symbol:${symbolName}`, `path:${changedPath}`],
        symbolName,
        parentPath: changedPath,
      });
    }
  }

  return targets;
}

async function main() {
  const baseRef = getBaseRef();
  const changedPaths = getChangedPaths(baseRef);
  const targets = await buildTargets(changedPaths);

  const report = {
    generatedAt: new Date().toISOString(),
    baseRef,
    totalTargets: targets.length,
    fullTargets: targets.filter((t) => t.strategy === 'full').length,
    summaryTargets: targets.filter((t) => t.strategy === 'summary').length,
    totalNodes: targets.length,
    fileNodes: targets.filter((t) => t.nodeType === 'file').length,
    symbolNodes: targets.filter((t) => t.nodeType === 'symbol').length,
    targets,
  };

  const outDir = path.join(process.cwd(), 'artifacts', 'qdrant');
  const outJson = path.join(outDir, 'diff-targets.json');
  const outMd = path.join(outDir, 'diff-targets.md');

  await fsp.mkdir(outDir, { recursive: true });
  await fsp.writeFile(outJson, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fsp.writeFile(outMd, `${toMarkdown(report)}\n`, 'utf-8');

  console.log(`[qdrant] diff targets: ${path.relative(process.cwd(), outJson)}`);
  console.log(`[qdrant] base=${baseRef} files=${report.fileNodes} symbols=${report.symbolNodes} total=${report.totalTargets}`);
}

main().catch((error) => {
  console.error('[qdrant] failed to generate diff targets', error);
  process.exitCode = 1;
});
