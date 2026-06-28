import { describe, expect, it } from 'vitest'
import { normalizeSlidesDocumentInput, slidesDocumentHasRenderableContent } from './slides-schema'

describe('normalizeSlidesDocumentInput', () => {
  it('accepts content as alias for bullets on a content slide', () => {
    const result = normalizeSlidesDocumentInput({
      title: 'OKR Review',
      slides: [
        {
          layout: 'content',
          title: 'Q4 Objectives',
          content: ['Increase MAU by 25%', 'Ship v2.0', 'Reduce churn to 3%'],
        },
      ],
    } as never)

    expect(result.slides).toHaveLength(1)
    expect(result.slides[0].bullets).toEqual([
      'Increase MAU by 25%',
      'Ship v2.0',
      'Reduce churn to 3%',
    ])
    expect(slidesDocumentHasRenderableContent(result)).toBe(true)
  })

  it('accepts content as alias for bullets on a bullets slide', () => {
    const result = normalizeSlidesDocumentInput({
      title: 'OKR Review',
      slides: [
        {
          layout: 'bullets',
          title: 'Key Results',
          content: ['Ship v2.0 by Nov 15', 'Onboard 5 enterprise customers'],
        },
      ],
    } as never)

    expect(result.slides[0].bullets).toEqual([
      'Ship v2.0 by Nov 15',
      'Onboard 5 enterprise customers',
    ])
  })

  it('accepts items, points, values as aliases for bullets', () => {
    const result = normalizeSlidesDocumentInput({
      title: 'Deck',
      slides: [
        { layout: 'bullets', title: 'A', items: ['one', 'two'] },
        { layout: 'bullets', title: 'B', points: ['three', 'four'] },
        { layout: 'bullets', title: 'C', values: ['five', 'six'] },
      ],
    } as never)

    expect(result.slides).toHaveLength(3)
    expect(result.slides[0].bullets).toEqual(['one', 'two'])
    expect(result.slides[1].bullets).toEqual(['three', 'four'])
    expect(result.slides[2].bullets).toEqual(['five', 'six'])
  })

  it('accepts text and paragraph as aliases for body', () => {
    const result = normalizeSlidesDocumentInput({
      title: 'Deck',
      slides: [
        { layout: 'content', title: 'A', text: 'Long prose here.' },
        { layout: 'content', title: 'B', paragraph: 'More prose.' },
      ],
    } as never)

    expect(result.slides[0].body).toBe('Long prose here.')
    expect(result.slides[1].body).toBe('More prose.')
  })

  it('accepts layout aliases like cover, list, columns, thank-you', () => {
    const result = normalizeSlidesDocumentInput({
      title: 'Deck',
      slides: [
        { layout: 'cover', title: 'Welcome' },
        { layout: 'list', title: 'List', bullets: ['one'] },
        { layout: 'columns', title: 'Two', columns: [{ heading: 'A', bullets: ['a'] }] },
        { layout: 'thank-you', title: 'Bye' },
      ],
    } as never)

    expect(result.slides.map(s => s.layout)).toEqual([
      'title',
      'bullets',
      'two-column',
      'closing',
    ])
  })

  it('accepts content as alias for bullets on two-column slide columns', () => {
    const result = normalizeSlidesDocumentInput({
      title: 'Risks',
      slides: [
        {
          layout: 'two-column',
          title: 'Risks & Mitigations',
          columns: [
            { heading: 'Risks', content: ['Hiring lag', 'Supply chain'] },
            { heading: 'Mitigations', content: ['Contractor pool', 'Dual sourcing'] },
          ],
        },
      ],
    } as never)

    expect(result.slides[0].columns?.[0].bullets).toEqual(['Hiring lag', 'Supply chain'])
    expect(result.slides[0].columns?.[1].bullets).toEqual(['Contractor pool', 'Dual sourcing'])
  })

  it('drops slides that have no content after alias resolution', () => {
    const result = normalizeSlidesDocumentInput({
      title: 'Deck',
      slides: [
        { layout: 'content' }, // no title, no content
        { layout: 'bullets', title: 'Only title' }, // has title -> kept
      ],
    } as never)

    expect(result.slides).toHaveLength(1)
    expect(result.slides[0].title).toBe('Only title')
  })

  it('splits newline-separated content strings into bullets', () => {
    const result = normalizeSlidesDocumentInput({
      title: 'Deck',
      slides: [
        { layout: 'bullets', title: 'A', content: 'one\n- two\nthree' },
      ],
    } as never)

    expect(result.slides[0].bullets).toEqual(['one', 'two', 'three'])
  })
})