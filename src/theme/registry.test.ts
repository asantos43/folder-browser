// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { escapeAttr, themePreview, themeToCss } from '@core/themeCss.ts'
import type { CompiledTheme } from '@core/plugins/compile.ts'
import { ThemeRegistry, type ThemeDOM } from './registry.ts'

/** The compile step namespaces a theme id with the plugin id (`<plugin>:<theme>`); tests mirror that. */
function theme(overrides: Partial<CompiledTheme> & { tokens: Record<string, string>; pluginId?: string }): CompiledTheme {
  const pluginId = overrides.pluginId ?? 'a'
  const suffix = overrides.id ?? 'midnight'
  return {
    id: overrides.id !== undefined ? overrides.id : `${pluginId}:${suffix}`,
    label: overrides.label ?? 'Midnight',
    base: overrides.base ?? 'dark',
    tokens: overrides.tokens,
  }
}

function pack(pluginId: string, themes: readonly CompiledTheme[]): { pluginId: string; themes: readonly CompiledTheme[] } {
  return { pluginId, themes }
}

const TOKEN_NAMES: readonly string[] = [
  'vscode-font-family', 'vscode-font-size', 'vscode-editor-font-family', 'vscode-editor-font-size',
  'vscode-foreground', 'vscode-focusBorder', 'vscode-descriptionForeground', 'vscode-errorForeground',
  'vscode-textLinkForeground', 'vscode-icon-foreground', 'vscode-widget-shadow',
  'vscode-editor-background', 'vscode-editor-foreground', 'vscode-editorGroup-border',
  'vscode-editorGroupHeader-tabsBackground', 'vscode-editorWidget-background', 'vscode-editorWidget-border',
  'vscode-breadcrumb-foreground', 'vscode-breadcrumb-focusForeground',
  'vscode-tab-activeBackground', 'vscode-tab-inactiveBackground', 'vscode-tab-activeForeground',
  'vscode-tab-inactiveForeground', 'vscode-tab-border',
  'vscode-titleBar-activeBackground', 'vscode-titleBar-activeForeground',
  'vscode-titleBar-inactiveBackground', 'vscode-titleBar-inactiveForeground',
  'vscode-activityBar-background', 'vscode-activityBar-foreground', 'vscode-activityBar-inactiveForeground',
  'vscode-activityBar-activeBorder', 'vscode-activityBar-activeBackground', 'vscode-activityBar-activeFocusBorder',
  'vscode-sideBar-background', 'vscode-sideBar-foreground', 'vscode-sideBarSectionHeader-background',
  'vscode-sideBarSectionHeader-foreground', 'vscode-sideBarSectionHeader-border',
  'vscode-sideBarTitle-foreground', 'vscode-sideBar-dropBackground',
  'vscode-list-activeSelectionBackground', 'vscode-list-activeSelectionForeground',
  'vscode-list-inactiveSelectionBackground', 'vscode-list-inactiveSelectionForeground',
  'vscode-list-hoverBackground', 'vscode-list-hoverForeground', 'vscode-list-focusBackground',
  'vscode-list-focusForeground', 'vscode-list-highlightForeground',
  'vscode-tree-indentGuidesStroke', 'vscode-tree-tableColumnsBorder', 'vscode-tree-tableOddRowsBackground',
  'vscode-statusBar-background', 'vscode-statusBar-foreground', 'vscode-statusBarItem-hoverBackground',
  'vscode-statusBarItem-activeBackground', 'vscode-statusBarItem-activeForeground', 'vscode-statusBar-border',
  'vscode-statusBar-noFolder-background', 'vscode-statusBar-debuggingBackground',
  'vscode-statusBarDebugging-foreground', 'vscode-statusBarDebugging-border',
  'vscode-pickerGroup-foreground', 'vscode-pickerGroup-border',
  'vscode-input-background', 'vscode-input-foreground', 'vscode-input-border',
  'vscode-input-placeholderForeground', 'vscode-inputOption-activeBackground',
  'vscode-inputOption-activeBorder', 'vscode-inputOption-activeForeground',
  'vscode-inputValidation-errorBackground', 'vscode-inputValidation-errorForeground',
  'vscode-inputValidation-infoBackground', 'vscode-inputValidation-infoForeground',
  'vscode-inputValidation-warningBackground', 'vscode-inputValidation-warningForeground',
  'vscode-dropdown-background', 'vscode-dropdown-foreground', 'vscode-dropdown-border',
  'vscode-button-background', 'vscode-button-foreground', 'vscode-button-hoverBackground',
  'vscode-button-secondaryBackground', 'vscode-button-secondaryForeground', 'vscode-button-secondaryHoverBackground',
  'vscode-button-border', 'vscode-checkbox-background', 'vscode-checkbox-foreground', 'vscode-checkbox-border',
  'vscode-progressBar-background', 'vscode-editor-selectionBackground', 'vscode-editor-selectionForeground',
  'vscode-editor-inactiveSelectionBackground', 'vscode-editorCursor-foreground', 'vscode-editor-lineHighlightBackground',
  'vscode-editor-lineHighlightBorder', 'vscode-editorWhitespace-foreground',
  'vscode-editor-lineNumberForeground', 'vscode-editor-lineNumberActiveForeground',
]

function allDeclaredTokens(): Record<string, string> {
  // 97 tokens in tokens.css today; the registry must accept every one.
  const tokens: Record<string, string> = {}
  for (const name of TOKEN_NAMES) tokens[name] = '#abcdef'
  return tokens
}

function buildFakeDOM(): { dom: ThemeDOM; setTitleBarCalls: { color: string; symbolColor: string }[] } {
  const setTitleBarCalls: { color: string; symbolColor: string }[] = []
  // happy-dom does not surface custom properties (`--*`) on `getComputedStyle`; the
  // registry reads the base titlebar through that hook, so the tests mirror the
  // property set on the element to read it back.
  const dom: ThemeDOM = {
    document,
    createElement: tag => document.createElement(tag),
    getComputedStyle: el => {
      const real = getComputedStyle(el)
      const props = new Map<string, string>()
      for (let i = 0; i < real.length; i++) {
        const name = real[i]
        const value = real.getPropertyValue(name)
        if (value) props.set(name, value)
      }
      const inline = (el as HTMLElement).style
      for (let i = 0; i < inline.length; i++) {
        const name = inline[i]
        const value = inline.getPropertyValue(name)
        if (value) props.set(name, value)
      }
      return {
        getPropertyValue(name: string) { return props.get(name) ?? real.getPropertyValue(name) },
        length: props.size,
      }
    },
    setTitleBar: (colors) => { setTitleBarCalls.push(colors) },
  }
  return { dom, setTitleBarCalls }
}

function clearDocument(): void {
  document.head.replaceChildren()
  for (const attr of ['data-theme', 'data-theme-plugin', 'data-theme-plugin-preview', 'data-theme-base']) {
    document.documentElement.removeAttribute(attr)
  }
  for (const prop of ['--vscode-titleBar-activeBackground', '--vscode-titleBar-activeForeground']) {
    document.documentElement.style.removeProperty(prop)
  }
}

beforeEach(clearDocument)
afterEach(clearDocument)

describe('ThemeRegistry.set', () => {
  it('accepts a valid compiled theme and stores it under its owner', () => {
    const { dom } = buildFakeDOM()
    const registry = new ThemeRegistry(dom)
    const result = registry.set(pack('a', [theme({ tokens: { 'vscode-foreground': '#abcdef' } })]))
    expect(result).toEqual({ ok: true, errors: [] })
    expect(registry.owners()).toEqual(['a'])
    expect(registry.totalThemes()).toBe(1)
  })

  it('refuses a theme whose token value slipped past compile validation (defense in depth)', () => {
    const { dom } = buildFakeDOM()
    const registry = new ThemeRegistry(dom)
    const hostile = ['url(/etc/passwd)', '#fff; display:none', 'red { color: blue }', 'var(--evil)', '@import "x"', 'expression()', '#fff\0', '#fff\x1b', '#fff\x7f']
    for (const value of hostile) {
      const result = registry.set(pack('a', [theme({ tokens: { 'vscode-foreground': value } })]))
      expect(result.ok, JSON.stringify(value)).toBe(false)
      if (!result.ok) expect(result.errors.some(e => e.message.includes('"vscode-foreground"'))).toBe(true)
    }
    expect(registry.totalThemes()).toBe(0)
  })

  it('refuses a theme whose id carries a control byte, a quote or a backslash', () => {
    const { dom } = buildFakeDOM()
    const registry = new ThemeRegistry(dom)
    const ids = ['a:x"\u005c', 'a:b\ninside', 'a:b\u007fhere', '']
    for (const id of ids) {
      const result = registry.set(pack('a', [theme({ id, tokens: { 'vscode-foreground': '#fff' } })]))
      expect(result.ok, JSON.stringify(id)).toBe(false)
    }
  })

  it('accepts transparent as a colour value (it is the one non-format value)', () => {
    const { dom } = buildFakeDOM()
    const registry = new ThemeRegistry(dom)
    const result = registry.set(pack('a', [theme({ tokens: { 'vscode-editor-background': 'transparent' } })]))
    expect(result.ok).toBe(true)
  })

  it('rejects the whole package when one theme is hostile (no partial registration)', () => {
    const { dom } = buildFakeDOM()
    const registry = new ThemeRegistry(dom)
    const result = registry.set(pack('a', [
      theme({ id: 'a:alpha', tokens: { 'vscode-foreground': '#fff' } }),
      theme({ id: 'a:beta', tokens: { 'vscode-foreground': 'url(/etc/passwd)' } }),
    ]))
    expect(result.ok).toBe(false)
    expect(registry.totalThemes()).toBe(0)
  })

  it('replaces a previous package of the same owner and keeps the active rendering in sync', () => {
    const { dom, setTitleBarCalls } = buildFakeDOM()
    const registry = new ThemeRegistry(dom)
    // Simulate applyTheme having set the base titlebar (the renderer-side path that calls this registry).
    document.documentElement.style.setProperty('--vscode-titleBar-activeBackground', '#3c3c3c')
    document.documentElement.style.setProperty('--vscode-titleBar-activeForeground', '#cccccc')
    registry.set(pack('a', [theme({ id: 'a:midnight', tokens: { 'vscode-foreground': '#abcdef' } })]))
    registry.apply('a', 'a:midnight')
    expect(document.documentElement.getAttribute('data-theme-plugin')).toBe('a:midnight')
    registry.set(pack('a', [theme({ id: 'a:midnight', tokens: { 'vscode-foreground': '#fedcba' } })]))
    expect(document.documentElement.getAttribute('data-theme-plugin')).toBe('a:midnight')
    const styleEls = document.head.querySelectorAll('style[data-theme-plugin-source]')
    expect(styleEls).toHaveLength(1)
    expect((styleEls[0] as HTMLStyleElement).textContent).toContain('--vscode-foreground: #fedcba;')
    expect(setTitleBarCalls.length).toBeGreaterThan(0)
  })

  it('clears the active rendering when the active theme disappears from the package', () => {
    const { dom } = buildFakeDOM()
    const registry = new ThemeRegistry(dom)
    registry.set(pack('a', [theme({ id: 'a:midnight', tokens: { 'vscode-foreground': '#abcdef' } })]))
    registry.apply('a', 'a:midnight')
    expect(document.documentElement.getAttribute('data-theme-plugin')).toBe('a:midnight')
    registry.set(pack('a', [theme({ id: 'a:noon', tokens: { 'vscode-foreground': '#ffffff' } })]))
    expect(document.documentElement.hasAttribute('data-theme-plugin')).toBe(false)
    expect(document.head.querySelectorAll('style[data-theme-plugin-source]')).toHaveLength(0)
  })
})

describe('ThemeRegistry.remove', () => {
  it('drops the owner and clears the active selection if the owner owned it', () => {
    const { dom } = buildFakeDOM()
    const registry = new ThemeRegistry(dom)
    registry.set(pack('a', [theme({ tokens: { 'vscode-foreground': '#fff' } })]))
    registry.apply('a', 'a:midnight')
    registry.remove('a')
    expect(registry.owners()).toEqual([])
    expect(registry.activeSelection()).toBeNull()
    expect(document.documentElement.hasAttribute('data-theme-plugin')).toBe(false)
  })

  it('removes a preview too, with no residual attribute or style', () => {
    const { dom } = buildFakeDOM()
    const registry = new ThemeRegistry(dom)
    registry.set(pack('a', [theme({ tokens: { 'vscode-foreground': '#fff' } })]))
    registry.set(pack('b', [theme({ pluginId: 'b', id: 'b:noon', tokens: { 'vscode-foreground': '#000' } })]))
    registry.preview('b', 'b:noon')
    expect(document.documentElement.getAttribute('data-theme-plugin-preview')).toBe('b:noon')
    registry.remove('b')
    expect(document.documentElement.hasAttribute('data-theme-plugin-preview')).toBe(false)
    expect(document.head.querySelectorAll('style[data-theme-plugin-preview-source]')).toHaveLength(0)
  })

  it('is a no-op on an unknown owner', () => {
    const { dom } = buildFakeDOM()
    const registry = new ThemeRegistry(dom)
    expect(() => registry.remove('nobody')).not.toThrow()
  })
})

describe('ThemeRegistry.apply / preview / cancel / reset', () => {
  it('apply sets the data-theme-plugin attribute and the style block; cancel restores nothing', () => {
    const { dom } = buildFakeDOM()
    const registry = new ThemeRegistry(dom)
    registry.set(pack('a', [theme({ tokens: { 'vscode-foreground': '#abcdef' } })]))
    registry.apply('a', 'a:midnight')
    expect(document.documentElement.getAttribute('data-theme-plugin')).toBe('a:midnight')
    expect(document.documentElement.getAttribute('data-theme-base')).toBe('dark')
    const styleEls = document.head.querySelectorAll('style[data-theme-plugin-source]')
    expect(styleEls).toHaveLength(1)
    expect((styleEls[0] as HTMLStyleElement).textContent).toContain('html[data-theme-plugin="a:midnight"][data-theme-base="dark"]')

    // cancel does not touch the active
    registry.preview('a', 'a:midnight')
    registry.cancel()
    expect(document.documentElement.hasAttribute('data-theme-plugin-preview')).toBe(false)
    expect(document.documentElement.getAttribute('data-theme-plugin')).toBe('a:midnight')
  })

  it('preview shows the rule with data-theme-plugin-preview; reset clears active and preview', () => {
    const { dom } = buildFakeDOM()
    const registry = new ThemeRegistry(dom)
    registry.set(pack('a', [theme({ tokens: { 'vscode-foreground': '#fff' } })]))
    registry.apply('a', 'a:midnight')
    registry.preview('a', 'a:midnight')
    expect(document.documentElement.getAttribute('data-theme-plugin-preview')).toBe('a:midnight')
    const previewEls = document.head.querySelectorAll('style[data-theme-plugin-preview-source]')
    expect(previewEls).toHaveLength(1)
    expect((previewEls[0] as HTMLStyleElement).textContent).toContain('html[data-theme-plugin-preview="a:midnight"][data-theme-base="dark"]')

    registry.reset()
    expect(document.documentElement.hasAttribute('data-theme-plugin')).toBe(false)
    expect(document.documentElement.hasAttribute('data-theme-plugin-preview')).toBe(false)
    expect(document.documentElement.hasAttribute('data-theme-base')).toBe(false)
    expect(document.head.querySelectorAll('style[data-theme-plugin-source], style[data-theme-plugin-preview-source]')).toHaveLength(0)
  })

  it('replaces a previous preview when a new one is requested (no residue)', () => {
    const { dom } = buildFakeDOM()
    const registry = new ThemeRegistry(dom)
    registry.set(pack('a', [theme({ tokens: { 'vscode-foreground': '#fff' } })]))
    registry.preview('a', 'a:midnight')
    expect(document.documentElement.getAttribute('data-theme-plugin-preview')).toBe('a:midnight')
    registry.preview('a', 'a:midnight')
    expect(document.head.querySelectorAll('style[data-theme-plugin-preview-source]')).toHaveLength(1)
  })

  it('apply removes a preview if any, and then the active style block wins', () => {
    const { dom } = buildFakeDOM()
    const registry = new ThemeRegistry(dom)
    registry.set(pack('a', [theme({ id: 'a:noon', tokens: { 'vscode-foreground': '#000' } })]))
    registry.preview('a', 'a:noon')
    registry.apply('a', 'a:noon')
    expect(document.documentElement.hasAttribute('data-theme-plugin-preview')).toBe(false)
    expect(document.documentElement.getAttribute('data-theme-plugin')).toBe('a:noon')
    expect(document.head.querySelectorAll('style[data-theme-plugin-preview-source]')).toHaveLength(0)
  })

  it('refuses an unknown theme id with an error and does not touch the DOM', () => {
    const { dom } = buildFakeDOM()
    const registry = new ThemeRegistry(dom)
    registry.set(pack('a', [theme({ tokens: { 'vscode-foreground': '#fff' } })]))
    const before = document.head.children.length
    const result = registry.apply('a', 'a:unknown')
    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
    expect(document.head.children.length).toBe(before)
    expect(document.documentElement.hasAttribute('data-theme-plugin')).toBe(false)
  })
})

describe('the document never has more than two plugin <style> blocks', () => {
  it('keeps exactly one active and one preview, even with 50 themes registered', () => {
    const { dom } = buildFakeDOM()
    const registry = new ThemeRegistry(dom)
    for (let i = 0; i < 50; i++) {
      registry.set(pack(`owner${i}`, [theme({ pluginId: `owner${i}`, id: `owner${i}:t${i}`, tokens: { 'vscode-foreground': `#${i.toString(16).padStart(6, '0')}` } })]))
    }
    expect(registry.totalThemes()).toBe(50)
    registry.apply('owner0', 'owner0:t0')
    registry.preview('owner1', 'owner1:t1')
    const activeEls = document.head.querySelectorAll('style[data-theme-plugin-source]')
    const previewEls = document.head.querySelectorAll('style[data-theme-plugin-preview-source]')
    expect(activeEls).toHaveLength(1)
    expect(previewEls).toHaveLength(1)
    expect(document.head.querySelectorAll('style')).toHaveLength(2)
  })

  it('removes the block when the active theme is unselected (no stale <style>)', () => {
    const { dom } = buildFakeDOM()
    const registry = new ThemeRegistry(dom)
    registry.set(pack('a', [theme({ tokens: { 'vscode-foreground': '#fff' } })]))
    registry.apply('a', 'a:midnight')
    expect(document.head.querySelectorAll('style')).toHaveLength(1)
    registry.reset()
    expect(document.head.querySelectorAll('style')).toHaveLength(0)
  })
})

describe('the active rule and the preview rule cannot be confused', () => {
  it('the active rule uses data-theme-plugin; the preview uses data-theme-plugin-preview', () => {
    const { dom } = buildFakeDOM()
    const registry = new ThemeRegistry(dom)
    const midnight = theme({ id: 'a:midnight', base: 'dark', tokens: { 'vscode-foreground': '#fff' } })
    const dawn = theme({ id: 'a:dawn', base: 'light', tokens: { 'vscode-foreground': '#000' } })
    registry.set(pack('a', [midnight, dawn]))
    registry.apply('a', 'a:midnight')
    registry.preview('a', 'a:dawn')
    const activeRule = document.head.querySelector('style[data-theme-plugin-source]')!.textContent
    const previewRule = document.head.querySelector('style[data-theme-plugin-preview-source]')!.textContent
    expect(activeRule).toContain('html[data-theme-plugin="a:midnight"][data-theme-base="dark"]')
    expect(previewRule).toContain('html[data-theme-plugin-preview="a:dawn"][data-theme-base="light"]')
  })
})

describe('the CSS a hostile id would have produced is sanitised by escapeAttr', () => {
  it('every control byte, the quote and the backslash become a backslash + HEX + space', () => {
    const id = 'a:x"\u005c\u000a\u000d\u000c\u0001\u007f\u0085 end'
    const escaped = escapeAttr(id)
    // A direct regex would match the backslashes that start the escape sequences themselves.
    // Peel the escape tokens first: every escape is `\` + 2 hex digits + a single space.
    const peeled = escaped.replace(/\\[0-9a-fA-F]{2} /g, '')
    // Whatever remains must be only printable ASCII (no controls, no `"`, no `\`).
    // eslint-disable-next-line no-control-regex
    expect(peeled).not.toMatch(/[\x00-\x1f\x7f-\x9f"\\]/)
    expect(peeled).toBe('a:x end') // the namespace, the `x`, the spaces that came from escape terminators, and the literal 'end' word
    expect(escaped).toContain('\\22 ')
    expect(escaped).toContain('\\0a ')
    expect(escaped).toContain('\\0d ')
    expect(escaped).toContain('\\0c ')
    expect(escaped).toContain('\\7f ')
    expect(escaped).toContain('\\85 ')
    const css = themeToCss({ id, base: 'dark', tokens: { 'vscode-foreground': '#fff' } })
    // eslint-disable-next-line no-control-regex
    expect(css.split('[data-theme-base')[0]).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/)
    const preview = themePreview({ id, base: 'dark', tokens: { 'vscode-foreground': '#fff' } })
    // eslint-disable-next-line no-control-regex
    expect(preview.split('[data-theme-base')[0]).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/)
  })

  it('still uses the escape even when the registry was given a valid id (defense in depth)', () => {
    const { dom } = buildFakeDOM()
    const registry = new ThemeRegistry(dom)
    const tricky = theme({ id: 'a:b theme', tokens: { 'vscode-foreground': '#fff' } })
    registry.set(pack('a', [tricky]))
    registry.apply('a', tricky.id)
    const rule = document.head.querySelector('style[data-theme-plugin-source]')!.textContent
    expect(rule).toContain('html[data-theme-plugin="a:b theme"][data-theme-base="dark"]')
  })
})

describe('titlebar stays at the base colours', () => {
  it('apply records the base titlebar and restores it after the plugin rule sets --vscode-titleBar-*', () => {
    const { dom, setTitleBarCalls } = buildFakeDOM()
    const registry = new ThemeRegistry(dom)
    document.documentElement.style.setProperty('--vscode-titleBar-activeBackground', '#3c3c3c')
    document.documentElement.style.setProperty('--vscode-titleBar-activeForeground', '#cccccc')
    registry.set(pack('a', [theme({ id: 'a:midnight', tokens: { 'vscode-titleBar-activeBackground': '#000000', 'vscode-foreground': '#fff' } })]))
    registry.apply('a', 'a:midnight')
    expect(setTitleBarCalls.length).toBeGreaterThan(0)
    const last = setTitleBarCalls[setTitleBarCalls.length - 1]
    expect(last.color).toBe('#3c3c3c')
    expect(last.symbolColor).toBe('#cccccc')
    registry.reset()
    const after = setTitleBarCalls[setTitleBarCalls.length - 1]
    expect(after.color).toBe('#3c3c3c')
    expect(after.symbolColor).toBe('#cccccc')
  })

  it('cancel does not affect the titlebar (the active theme is still in effect)', () => {
    const { dom, setTitleBarCalls } = buildFakeDOM()
    const registry = new ThemeRegistry(dom)
    document.documentElement.style.setProperty('--vscode-titleBar-activeBackground', '#3c3c3c')
    document.documentElement.style.setProperty('--vscode-titleBar-activeForeground', '#cccccc')
    registry.set(pack('a', [theme({ tokens: { 'vscode-foreground': '#fff' } })]))
    registry.apply('a', 'a:midnight')
    const beforeCancel = setTitleBarCalls.length
    registry.cancel()
    expect(setTitleBarCalls.length).toBe(beforeCancel)
  })
})

describe('lifecycle: preview then cancel / reset / remove / update leave no residue', () => {
  function setup() {
    const built = buildFakeDOM()
    const registry = new ThemeRegistry(built.dom)
    registry.set(pack('a', [
      theme({ id: 'a:midnight', tokens: { 'vscode-foreground': '#fff' } }),
      theme({ id: 'a:dawn', tokens: { 'vscode-foreground': '#000' } }),
    ]))
    return { registry, ...built }
  }

  it('preview → cancel: the preview attribute and style go, the active is intact', () => {
    const { registry } = setup()
    registry.apply('a', 'a:midnight')
    registry.preview('a', 'a:dawn')
    registry.cancel()
    expect(document.documentElement.hasAttribute('data-theme-plugin-preview')).toBe(false)
    expect(document.documentElement.getAttribute('data-theme-plugin')).toBe('a:midnight')
    expect(document.head.querySelectorAll('style[data-theme-plugin-preview-source]')).toHaveLength(0)
    expect(document.head.querySelectorAll('style[data-theme-plugin-source]')).toHaveLength(1)
  })

  it('preview → reset: both go, no attributes or styles left', () => {
    const { registry } = setup()
    registry.apply('a', 'a:midnight')
    registry.preview('a', 'a:dawn')
    registry.reset()
    expect(document.documentElement.attributes.length).toBe(0)
    expect(document.head.querySelectorAll('style')).toHaveLength(0)
  })

  it('preview → remove: the owner disappears; no <style> or attribute for the plugin', () => {
    const { registry } = setup()
    registry.apply('a', 'a:midnight')
    registry.preview('a', 'a:dawn')
    registry.remove('a')
    expect(document.documentElement.attributes.length).toBe(0)
    expect(document.head.querySelectorAll('style')).toHaveLength(0)
  })

  it('update of the active theme changes the rule in place, without a second <style>', () => {
    const { registry } = setup()
    registry.apply('a', 'a:midnight')
    registry.set(pack('a', [theme({ id: 'a:midnight', tokens: { 'vscode-foreground': '#123456' } })]))
    expect(document.head.querySelectorAll('style[data-theme-plugin-source]')).toHaveLength(1)
    expect(document.head.querySelector('style[data-theme-plugin-source]')!.textContent).toContain('#123456')
  })
})

const ROUNDS = 5

describe(`budgets (median of ${ROUNDS} rounds)`, () => {
  it('applies and cancels a theme with all 97 declared tokens in under 5 ms (median of rounds)', () => {
    const tokens = allDeclaredTokens()
    const samples: number[] = []
    for (let run = 0; run < ROUNDS; run++) {
      const { dom } = buildFakeDOM()
      const registry = new ThemeRegistry(dom)
      registry.set(pack('a', [theme({ tokens })]))
      const start = performance.now()
      registry.apply('a', 'a:midnight')
      registry.cancel()
      registry.reset()
      samples.push(performance.now() - start)
    }
    const sorted = [...samples].sort((a, b) => a - b)
    const middle = sorted.length % 2 ? sorted[sorted.length >> 1] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    process.stdout.write(`theme-registry apply+cancel+reset of ${TOKEN_NAMES.length} tokens median of ${ROUNDS}=${middle.toFixed(3)} ms; samples=${samples.map(s => s.toFixed(3)).join(', ')}\n`)
    expect(middle).toBeLessThan(5)
  })

  it('50 registered owners (50 themes) and a preview/active swap is in under 5 ms (median of rounds)', () => {
    const samples: number[] = []
    for (let run = 0; run < ROUNDS; run++) {
      const { dom } = buildFakeDOM()
      const registry = new ThemeRegistry(dom)
      const owners: string[] = []
      for (let i = 0; i < 50; i++) {
        const ownerId = `o${i}`
        owners.push(ownerId)
        registry.set(pack(ownerId, [theme({ pluginId: ownerId, id: `${ownerId}:t${i}`, tokens: { 'vscode-foreground': `#${i.toString(16).padStart(6, '0')}` } })]))
      }
      const start = performance.now()
      registry.apply(owners[0], `${owners[0]}:t0`)
      registry.preview(owners[1], `${owners[1]}:t1`)
      registry.cancel()
      registry.reset()
      samples.push(performance.now() - start)
    }
    const sorted = [...samples].sort((a, b) => a - b)
    const middle = sorted.length % 2 ? sorted[sorted.length >> 1] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    process.stdout.write(`theme-registry 50 owners apply+preview+cancel+reset median of ${ROUNDS}=${middle.toFixed(3)} ms; samples=${samples.map(s => s.toFixed(3)).join(', ')}\n`)
    expect(middle).toBeLessThan(5)
  })
})