import { describe, expect, it, vi } from 'vitest'
import type { Source } from '../shared/contracts'
import { plan, write } from '../worker/ai/agents'
import { config, resolveAIConfig } from '../worker/config'
import type { AppEnv } from '../worker/env'

describe('runtime configuration', () => {
  it.each([{}, { PLANNER_MODEL: '', WRITER_MODEL: ' \t ' }])(
    'uses code defaults for missing or blank overrides: %j',
    (overrides) => {
      expect(resolveAIConfig(overrides)).toEqual(config.ai)
    },
  )

  it('resolves model overrides independently without modifying defaults', () => {
    expect(resolveAIConfig({ PLANNER_MODEL: ' planner-model ' })).toEqual({
      planner: { ...config.ai.planner, model: 'planner-model' },
      writer: config.ai.writer,
    })
    expect(resolveAIConfig({ WRITER_MODEL: ' writer-model ' })).toEqual({
      planner: config.ai.planner,
      writer: { ...config.ai.writer, model: 'writer-model' },
    })
    expect(resolveAIConfig({})).toEqual(config.ai)
  })

  it.each([
    {
      name: 'defaults',
      overrides: {},
      plannerModel: config.ai.planner.model,
      writerModel: config.ai.writer.model,
    },
    {
      name: 'environment overrides',
      overrides: {
        PLANNER_MODEL: 'planner-model',
        WRITER_MODEL: 'writer-model',
      },
      plannerModel: 'planner-model',
      writerModel: 'writer-model',
    },
  ])('passes $name and configured budgets to Workers AI', async (test) => {
    const run = vi
      .fn()
      .mockImplementation(async (_model, input) =>
        input.stream
          ? new Response(
              'data: {"response":"Progress was reported [S1].","finish_reason":"stop"}\n\n',
            ).body
          : { response: 'NO_SEARCH' },
      )
    const env = {
      AI: { run },
      ...test.overrides,
    } as unknown as AppEnv
    const source: Source = {
      id: 'S1',
      title: 'Research progress',
      outlet: 'Example News',
      url: 'https://example.com/research',
      publishedAt: null,
      retrievedAt: '2026-10-18T12:00:00Z',
      content: 'Researchers reported progress on their experiment.',
      evidence: 'feed-excerpt',
    }
    const signal = new AbortController().signal
    expect(
      await plan(env, 'What did the researchers report?', [], [source], signal),
    ).toEqual({ query: 'Previous source context', reused: true })
    expect(run).toHaveBeenNthCalledWith(
      1,
      test.plannerModel,
      expect.objectContaining({
        max_tokens: config.ai.planner.maxTokens,
        temperature: config.ai.planner.temperature,
      }),
    )

    await expect(
      write(env, 'Explain the report', [], [source], signal, () => {}),
    ).resolves.toBe('Progress was reported [S1].')
    expect(run).toHaveBeenNthCalledWith(
      2,
      test.writerModel,
      expect.objectContaining({
        max_tokens: config.ai.writer.maxTokens,
        temperature: config.ai.writer.temperature,
        stream: true,
      }),
    )
  })
})
