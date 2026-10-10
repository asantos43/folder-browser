import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { contractDeclaration } from './declarations.ts'

it('keeps the public declaration text and exported names intentional', () => {
  const source = readFileSync(new URL('./contract.ts', import.meta.url), 'utf8')
  const declaration = contractDeclaration(source)
  expect(declaration.names).toEqual(['MenuPoint', 'ContributionCommand', 'ContributionKey', 'SettingDef', 'ContributionMenuItem', 'Contribution'])
  expect(declaration.text).toMatchSnapshot()
  expect(() => contractDeclaration('export const hidden = 1')).toThrow()
  expect(() => contractDeclaration('export type A = string;\nexport type A = number')).toThrow()
  expect(() => contractDeclaration('export type A = string;\nexport { A }')).toThrow()
})
