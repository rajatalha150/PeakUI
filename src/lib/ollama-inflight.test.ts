import { afterEach, describe, expect, it } from 'vitest'
import {
  beginModelUse,
  inFlightCount,
  isModelInUse,
  listInFlightModels,
  __resetInFlightForTest,
} from './ollama-inflight'

describe('ollama-inflight', () => {
  afterEach(() => {
    __resetInFlightForTest()
  })

  it('tracks a model as in-use and releases it', () => {
    const release = beginModelUse('gemma4:latest', 'chat')
    expect(isModelInUse('gemma4')).toBe(true)
    expect(inFlightCount()).toBe(1)
    release()
    expect(isModelInUse('gemma4')).toBe(false)
    expect(inFlightCount()).toBe(0)
  })

  it('refcounts concurrent uses of the same model', () => {
    const a = beginModelUse('gemma4', 'chat')
    const b = beginModelUse('gemma4:latest', 'chat')
    expect(inFlightCount()).toBe(1)
    a()
    expect(isModelInUse('gemma4')).toBe(true)
    b()
    expect(isModelInUse('gemma4')).toBe(false)
  })

  it('release is idempotent', () => {
    const release = beginModelUse('gemma4', 'chat')
    release()
    release()
    expect(inFlightCount()).toBe(0)
  })

  it('tracks distinct models separately', () => {
    const chat = beginModelUse('gemma4', 'chat')
    const embed = beginModelUse('nomic-embed-text', 'embedding')
    expect(inFlightCount()).toBe(2)
    expect(listInFlightModels()).toEqual(
      expect.arrayContaining([
        { model: 'gemma4', kind: 'chat' },
        { model: 'nomic-embed-text', kind: 'embedding' },
      ]),
    )
    chat()
    embed()
    expect(inFlightCount()).toBe(0)
  })

  it('normalizes :latest suffix when matching', () => {
    const release = beginModelUse('hf.co/Foo-Bar:latest', 'chat')
    expect(isModelInUse('hf.co/Foo-Bar')).toBe(true)
    release()
  })
})
