import { describe, it, expect } from 'vitest'
import { defaultSanitize } from './sanitize.js'

describe('defaultSanitize', () => {
  it('strips leading thought\\n', () => {
    expect(defaultSanitize('thought\nHello')).toBe('Hello')
  })

  it('strips leading thinking/reasoning/analysis preambles', () => {
    expect(defaultSanitize('thinking\nHello')).toBe('Hello')
    expect(defaultSanitize('reasoning\nHello')).toBe('Hello')
    expect(defaultSanitize('analysis\nHello')).toBe('Hello')
  })

  it('strips leading preamble case-insensitively', () => {
    expect(defaultSanitize('Thought\nHello')).toBe('Hello')
    expect(defaultSanitize('THINKING\nHello')).toBe('Hello')
  })

  it('keeps content when first line is not a bare short token', () => {
    // Line has a space → not a single token, keep as-is.
    expect(defaultSanitize('thought: pasta\nmore')).toBe('thought: pasta\nmore')
    // Line ends with sentence-ending punctuation → real sentence, keep.
    expect(defaultSanitize('Hello!\nWorld')).toBe('Hello!\nWorld')
  })

  it('strips CJK single-char reasoning preamble (issue #18)', () => {
    const input = '探\nRecorded your lunch: pasta\n...'
    expect(defaultSanitize(input)).toBe('Recorded your lunch: pasta\n...')
  })

  it('strips a short punctuation preamble before content (issue #18)', () => {
    expect(defaultSanitize('--Well, looking at your notes'))
      .toBe('Well, looking at your notes')
    expect(defaultSanitize('...ok then')).toBe('ok then')
    expect(defaultSanitize('—Hello')).toBe('Hello')
    expect(defaultSanitize('…Hello')).toBe('Hello')
  })

  it('strips punctuation preamble that remains after channel header strip', () => {
    const input = '<|channel|>final<|message|>--Well, looking'
    expect(defaultSanitize(input)).toBe('Well, looking')
  })

  it('strips <thought>...</thought> blocks', () => {
    expect(defaultSanitize('<thought>internal</thought>Hello')).toBe('Hello')
  })

  it('strips <thinking>...</thinking> blocks spanning newlines', () => {
    const input = '<thinking>\nlet me consider\nthe options\n</thinking>\nFinal answer'
    expect(defaultSanitize(input)).toBe('Final answer')
  })

  it('strips Chinese reasoning preambles', () => {
    expect(defaultSanitize('思考\n你好')).toBe('你好')
    expect(defaultSanitize('分析\n你好')).toBe('你好')
    expect(defaultSanitize('推理\n你好')).toBe('你好')
    expect(defaultSanitize('思维\n你好')).toBe('你好')
  })

  it('strips Chinese preamble with trailing colon', () => {
    expect(defaultSanitize('思考：\n你好')).toBe('你好')
    expect(defaultSanitize('分析:\n你好')).toBe('你好')
  })

  it('strips Chinese reasoning blocks', () => {
    expect(defaultSanitize('<思考>内部推理</思考>最终答案')).toBe('最终答案')
  })

  it('strips harmony channel wrapper', () => {
    const input = 'thought\n<|channel>thought\n<channel|>Real reply'
    expect(defaultSanitize(input)).toBe('Real reply')
  })

  it('handles symmetric harmony tokens', () => {
    const input =
      '<|channel|>analysis<|message|>reasoning<|end|><|channel|>final<|message|>Answer<|end|>'
    const out = defaultSanitize(input)
    expect(out).not.toMatch(/<\|?/)
    expect(out).not.toContain('channel')
    expect(out).not.toContain('message')
    expect(out).not.toContain('end')
    expect(out).toContain('Answer')
  })

  it('strips bare channel marker with no header', () => {
    expect(defaultSanitize('<channel|>Hello!')).toBe('Hello!')
  })

  it('is a no-op on clean text', () => {
    expect(defaultSanitize('Hello world')).toBe('Hello world')
  })

  it('returns empty string when the entire text is an artifact', () => {
    expect(defaultSanitize('thought\n')).toBe('')
  })

  it('strips channel-name preceding a channel marker (no newline)', () => {
    const input = 'thought<|channel>final<|message|>Recorded an apple'
    expect(defaultSanitize(input)).toBe('Recorded an apple')
  })

  it('strips two-line reasoning preamble from issue #22', () => {
    const input =
      'thought\n探测\nThe meeting is scheduled for 3pm.\n\nLet me know if that works for you.'
    expect(defaultSanitize(input)).toBe(
      'The meeting is scheduled for 3pm.\n\nLet me know if that works for you.'
    )
  })

  it('strips preamble even when separated by a blank line', () => {
    expect(defaultSanitize('thought\n\n探测\nHello')).toBe('Hello')
    expect(defaultSanitize('thought\n探测\n\nHello')).toBe('Hello')
  })

  it('strips preamble hidden behind a leading blank line', () => {
    expect(defaultSanitize('\n\nthought\n探测\nHello')).toBe('Hello')
  })
})
