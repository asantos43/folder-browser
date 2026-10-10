import { expect, it } from 'vitest'
import { parseRange, parseSemver, satisfies } from './semver.ts'

it.each(['0.0.0', '1.2.3-alpha.1+build.01', '1.0.0-0', '12.345.678+test'])('parses strict semver %s', value => expect(parseSemver(value)).not.toBeNull())
it.each(['1', '1.2', 'v1.2.3', '01.2.3', '1.2.3-01', '1.2.3-', '1.2.3+', '1.2.3-a..b', '1.2.3\n', '9007199254740992.0.0'])('rejects %j', value => expect(parseSemver(value)).toBeNull())
it.each(['*', '^1.2.3', '~1.2.3', '1.x', '>=1.2', '>=1.2.3 || <3.0.0', ' >=1.0.0', '1.0.0 2.0.0'])('rejects unsupported range %s', range => expect(parseRange(range)).toBeNull())
it('compares exact versions, bounds and SemVer prerelease precedence (ignoring build)', () => {
  expect(satisfies('1.2.3+different', '1.2.3+build')).toBe(true)
  expect(satisfies('0.2.5', '>=0.2.0 <0.4.0')).toBe(true)
  expect(satisfies('0.4.0', '>=0.2.0 <0.4.0')).toBe(false)
  expect(satisfies('0.2.0', '>0.2.0 <=0.4.0')).toBe(false)
  const order = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0']
  for (let i = 1; i < order.length; i++) expect(satisfies(order[i], `>${order[i - 1]}`)).toBe(true)
  expect(satisfies('1.0.0-99999999999999999999', '>1.0.0-9999999999999999999')).toBe(true)
  expect(satisfies('bad', '1.0.0')).toBe(false)
})
