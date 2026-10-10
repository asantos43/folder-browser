import { expect, it } from 'vitest'
import { MENUS } from '../../src/workbench/commands.ts'
import { createMenuRegistry, contributedMenu } from './menus.ts'
import { menubarPoints } from './types.ts'
import type { ContributionMenuItem } from './contract.ts'

it('matches actual menubar ids and keeps Tools as a dormant contract point', () => {
  expect(MENUS.map(menu => `menubar/${menu.id}`)).toEqual(['menubar/file', 'menubar/edit', 'menubar/view', 'menubar/go', 'menubar/help'])
  expect(menubarPoints).toEqual(['menubar/file', 'menubar/edit', 'menubar/view', 'menubar/go', 'menubar/tools', 'menubar/help'])
  const r = createMenuRegistry(), builtin = ['existing', 'separator', 'save']
  for (const menu of MENUS) expect(contributedMenu(r, `menubar/${menu.id}` as ContributionMenuItem['point'], builtin, item => item.id)).toBe(builtin)
})

it('orders by group, declared order, then id, independently of registration order', () => {
  const r = createMenuRegistry()
  const item = (id: string, group: string, order: number): ContributionMenuItem => ({ id: `invented:${id}`, command: 'invented:command', point: 'menubar/edit', group, order })
  r.add(item('last', 'z', 0)); r.add(item('b', 'a', 2)); r.add(item('a', 'a', 2)); r.add(item('first', 'a', 1))
  r.add({ ...item('conditional', 'a', 0), when: 'active' })
  expect(contributedMenu(r, 'menubar/edit', ['builtin'], entry => entry.id)).toEqual(['builtin', 'invented:first', 'invented:a', 'invented:b', 'invented:last'])
  expect(r.at('menubar/edit', { active: true }).map(entry => entry.id)).toEqual(['invented:conditional', 'invented:first', 'invented:a', 'invented:b', 'invented:last'])
  expect(r.at('menubar/file')).toEqual([])
  expect(() => r.add(item('a', 'a', 2))).toThrow(/already registered/)
  r.remove('invented:a'); r.remove('invented:a')
  expect(r.get('invented:a')).toBeUndefined()
})
