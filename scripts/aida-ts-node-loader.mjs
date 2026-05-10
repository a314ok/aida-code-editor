import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const TS_EXT_RE = /\.(cts|mts|tsx?|jsx?)$/i;

const compilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  jsx: ts.JsxEmit.ReactJSX,
  esModuleInterop: true,
  inlineSourceMap: true,
  inlineSources: true,
  sourceMap: false,
};

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) throw error;

    const candidates = [];
    for (const ext of ['.ts', '.tsx', '.mts', '.cts']) {
      candidates.push(`${specifier}${ext}`);
      candidates.push(`${specifier}/index${ext}`);
    }

    for (const candidate of candidates) {
      try {
        return await nextResolve(candidate, context);
      } catch {}
    }
    throw error;
  }
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:') || !TS_EXT_RE.test(url)) {
    return nextLoad(url, context);
  }

  const filename = fileURLToPath(url);
  const source = await readFile(filename, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions,
    fileName: filename,
  });

  return {
    format: 'module',
    shortCircuit: true,
    source: `${transpiled.outputText}\n//# sourceURL=${url}\n`,
  };
}
