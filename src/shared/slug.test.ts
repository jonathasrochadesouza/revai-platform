import { describe, expect, it } from 'vitest'
import { slugify } from './slug'

describe('slugify', () => {
  it('keeps plain names', () => {
    expect(slugify('checkout-api')).toBe('checkout-api')
  })

  it('replaces path separators and unsafe characters', () => {
    expect(slugify('feature/PEQ-1234')).toBe('feature-PEQ-1234')
    expect(slugify('my:app?')).toBe('my-app')
  })

  it('collapses repeats and trims leading/trailing separators', () => {
    expect(slugify('--my::app--')).toBe('my-app')
  })

  it('falls back to "review" when nothing survives', () => {
    expect(slugify('///')).toBe('review')
    expect(slugify('')).toBe('review')
  })
})
