import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const GLOBAL_CONFIGS = [
  /^package(?:-lock)?\.json$/, /^vitest\.config\.ts$/, /^tsconfig[^/]*\.json$/,
  /^src\/test\/setup\.ts$/, /^(?:\.oxlintrc\.json|oxlint\.config\.[cm]?[jt]s)$/,
]

export function classify(files) {
  const unique = [...new Set(files)].sort()
  const config = unique.find(file => GLOBAL_CONFIGS.some(pattern => pattern.test(file)))
  if (config) return { modo: 'completa', motivo: `configuração global: ${config}`, arquivos: unique }
  const arquivos = unique.filter(file => /^(core|electron|src|scripts)\//.test(file)
    && /\.(?:[cm]?[jt]sx?|vue|svelte|css|json)$/.test(file))
  return { modo: arquivos.length ? 'relacionados' : 'nada',
    motivo: arquivos.length ? 'arquivos alterados' : 'nenhum teste unitário a rodar', arquivos }
}

export function collectFiles(cwd = process.cwd()) {
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  let base = 'origin/main'
  try { git(['rev-parse', '--verify', base]) } catch { base = 'main' }
  return [...new Set([
    git(['diff', '--name-only', '-z', `${base}...HEAD`]),
    git(['diff', '--name-only', '-z', 'HEAD']),
    git(['ls-files', '-o', '--exclude-standard', '-z']),
  ].flatMap(output => output.split('\0').filter(Boolean)))].sort()
}

export async function selectTests(files, options = {}) {
  const plan = classify(files)
  if (plan.modo !== 'relacionados') return plan
  const { createVitest } = await import('vitest/node')
  const vitest = await createVitest('test', { ...options, watch: false })
  try {
    for (const file of plan.arquivos) {
      vitest.config.related = [path.resolve(vitest.config.root, file)]
      if (!(await vitest.getRelevantTestSpecifications()).length) {
        return { ...plan, modo: 'completa', motivo: `lacuna de cobertura: ${file}` }
      }
    }
    return plan
  } finally { await vitest.close() }
}

export async function main({ cwd = process.cwd(), files, log = console.log, run = spawnSync } = {}) {
  const plan = await selectTests(files ?? collectFiles(cwd), { root: cwd })
  log(`${plan.modo}: ${plan.motivo.replace(/[\r\n]/g, ' ')}`)
  if (plan.modo === 'nada') return 0
  const args = plan.modo === 'completa' ? ['run'] : ['related', '--run', ...plan.arquivos]
  const result = run(process.execPath,
    [fileURLToPath(new URL('vitest.mjs', import.meta.resolve('vitest/package.json'))), ...args, '--reporter=json'],
    { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  try {
    const summary = JSON.parse(result.stdout)
    log(`Testes: ${summary.numTotalTests}; passaram: ${summary.numPassedTests}; falharam: ${summary.numFailedTests}`)
    if (result.status !== 0) {
      const failures = (summary.testResults ?? []).flatMap(test => [test.message,
        ...(test.assertionResults ?? []).flatMap(assertion => assertion.failureMessages ?? [])])
      log(failures.filter(Boolean).join('\n').split(/\r?\n/).slice(0, 3).join('\n'))
    }
  } catch { log('Vitest não produziu resumo JSON.') }
  if (result.status !== 0) log(String(result.error ?? result.stderr ?? '').split(/\r?\n/).slice(-8).join('\n'))
  return result.status ?? 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code }).catch(error => {
    console.error(String(error.message).split(/\r?\n/).slice(0, 2).join('\n'))
    process.exitCode = 1
  })
}
