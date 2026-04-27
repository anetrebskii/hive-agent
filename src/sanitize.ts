/**
 * Output sanitizer — strips reasoning-channel artifacts that some OpenRouter
 * models (e.g. Gemma-4 harmony-style) emit as plain text in message content.
 * Applied inside OpenRouterProvider so sanitized text flows out as part of
 * LLMResponse; downstream code never sees raw artifacts.
 */

const CHANNEL_HEADER_RE =
  /(?:(?:^|\s)(?:thought|analysis|final|commentary|reasoning)\s*)?<\|?channel\|?>\s*\w+\s*<\|?(channel|message)\|?>/gi
const STRAY_MARKER_RE =
  /<\|?(channel|message|end|start|return|system|user|assistant|developer|constrain)\|?>/gi

// Reasoning tags emitted as XML-like blocks. Kept language-aware for known
// channel names; less ambiguous than the bare-token case below.
const REASONING_BLOCK_RE =
  /<(thought|thinking|reasoning|analysis|思考|思维|分析|推理)>[\s\S]*?<\/\1>\s*/gi

// Generic reasoning-preamble rule (issue #18): first line is a short single
// token — no whitespace, ≤ 10 chars, no sentence-ending punctuation — followed
// by one or more newlines and more content. Matches English (`thought`), CJK
// single-char labels (`探`, `思考`), etc. without maintaining a per-language
// allow-list. Allowing `(?:\r?\n)+` strips a preamble even when the model
// emits a blank line between the label and the answer (issue #22).
const LEADING_PREAMBLE_RE =
  /^[\t ]*[^\s.!?。！？]{1,10}[\t ]*[:：]?[\t ]*(?:\r?\n)+/

// Short punctuation preamble the model sometimes emits after the channel
// header is stripped (`--Well...`, `—`, `...`). Real content does not begin
// with 2-3 dashes/dots or a bare em-dash / ellipsis char.
const LEADING_PUNCT_RE = /^[\t ]*(?:[-–.]{2,3}|[—…])[\t ]*/

export function defaultSanitize(text: string): string {
  let out = text.replace(REASONING_BLOCK_RE, '')
  out = out.replace(CHANNEL_HEADER_RE, '')
  out = out.replace(STRAY_MARKER_RE, '')
  // Strip leading whitespace before checking the preamble so a leading
  // blank line doesn't hide a `thought\n…` label from the regex.
  out = out.replace(/^\s+/, '')
  while (LEADING_PREAMBLE_RE.test(out)) {
    out = out.replace(LEADING_PREAMBLE_RE, '')
  }
  out = out.replace(LEADING_PUNCT_RE, '')
  return out.replace(/^\s+/, '')
}
