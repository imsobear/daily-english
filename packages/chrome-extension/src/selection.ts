const MAX = 80

export type PreparedSelection =
  | { ok: true; headword: string }
  | { ok: false; message: string }

export function normalizeSelection(raw: string) {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function prepareSelection(raw: string): PreparedSelection {
  const headword = normalizeSelection(raw)
  if (headword.length < 1 || headword.length > MAX) {
    return { ok: false, message: 'Enter a word or short phrase' }
  }
  return { ok: true, headword }
}

export type ToastKind = 'added' | 'duplicate' | 'signin' | 'invalid' | 'network'

export function toastCopy(input: {
  type: ToastKind
  headword?: string
  detail?: string
}): string {
  const word = input.headword ?? ''
  switch (input.type) {
    case 'added':
      return `Added “${word}”.`
    case 'duplicate':
      return `“${word}” is already in your list.`
    case 'signin':
      return 'Sign in with Gmail first'
    case 'invalid':
      return input.detail ?? 'Enter a word or short phrase'
    case 'network':
      return `Could not add “${word}”.`
  }
}
