const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../src/shared/startup.ts'), 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
})

const startupModule = { exports: {} }
const wrapper = new Function('require', 'module', 'exports', transpiled.outputText)
wrapper(require, startupModule, startupModule.exports)
const { parseNodeVersion, isNodeVersionSupported } = startupModule.exports

test('parses node versions from semver strings', () => {
  assert.deepEqual(parseNodeVersion('v20.11.1'), [20, 11, 1])
  assert.deepEqual(parseNodeVersion('18.17.0'), [18, 17, 0])
})

test('accepts supported node versions and rejects unsupported ones', () => {
  assert.equal(isNodeVersionSupported('v20.11.1'), true)
  assert.equal(isNodeVersionSupported('18.17.0'), true)
  assert.equal(isNodeVersionSupported('v16.20.0'), false)
})
