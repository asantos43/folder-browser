// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LINK_DELAY, LinkTooltip } from './LinkTooltip.tsx'

beforeEach(() => void vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

describe('LinkTooltip', () => {
  it('shows nothing without a link, and the address only after the pointer has rested on the link a moment', () => {
    const { rerender } = render(<LinkTooltip hover={null} />)
    expect(screen.queryByRole('tooltip')).toBeNull()
    rerender(<LinkTooltip hover={{ link: 'https://example.com/a', x: 100, y: 100 }} />)
    wait(LINK_DELAY - 50)
    expect(screen.queryByRole('tooltip')).toBeNull()
    wait(60)
    expect(screen.getByRole('tooltip').textContent).toBe('https://example.com/a')
  })

  it('goes when the pointer leaves the link, and a quick pass over a link shows nothing', () => {
    const { rerender } = render(<LinkTooltip hover={{ link: 'https://example.com/a', x: 1, y: 1 }} />)
    wait(LINK_DELAY + 10)
    expect(screen.getByRole('tooltip')).toBeTruthy()
    rerender(<LinkTooltip hover={null} />)
    expect(screen.queryByRole('tooltip')).toBeNull()
    rerender(<LinkTooltip hover={{ link: '#end', x: 1, y: 1 }} />)
    wait(100)
    rerender(<LinkTooltip hover={null} />)
    wait(LINK_DELAY)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('is below and to the right of the pointer, does not take the pointer, and changes with the link', () => {
    const { rerender } = render(<LinkTooltip hover={{ link: 'one', x: 100, y: 50 }} />)
    wait(LINK_DELAY + 10)
    const tip = screen.getByRole('tooltip')
    expect(tip.style.left).toBe('112px')
    expect(tip.style.top).toBe('72px')
    expect(tip.className).toContain('pointer-events-none')
    rerender(<LinkTooltip hover={{ link: 'two', x: 100, y: 50 }} />)
    expect(screen.queryByRole('tooltip')).toBeNull()
    wait(LINK_DELAY + 10)
    expect(screen.getByRole('tooltip').textContent).toBe('two')
  })
})
