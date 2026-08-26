type ToastMessage = {
  type: 'toast'
  text: string
  tone: 'ok' | 'warn' | 'error'
}

function isToast(value: unknown): value is ToastMessage {
  return (
    typeof value === 'object' &&
    value != null &&
    'type' in value &&
    (value as { type: unknown }).type === 'toast' &&
    'text' in value &&
    typeof (value as { text: unknown }).text === 'string'
  )
}

const TONE: Record<ToastMessage['tone'], { bg: string; fg: string }> = {
  ok: { bg: '#d7f0c5', fg: '#215e2a' },
  warn: { bg: '#ffe8c2', fg: '#6a3d00' },
  error: { bg: '#ffd6cc', fg: '#8c1d18' },
}

function showToast(message: ToastMessage) {
  const host = document.createElement('div')
  host.style.all = 'initial'
  host.style.position = 'fixed'
  host.style.zIndex = '2147483647'
  host.style.top = '16px'
  host.style.right = '16px'
  const root = host.attachShadow({ mode: 'closed' })
  const wrap = document.createElement('div')
  const colors = TONE[message.tone]
  wrap.textContent = message.text
  wrap.setAttribute(
    'style',
    [
      'font-family: ui-sans-serif, system-ui, sans-serif',
      'font-size: 14px',
      'font-weight: 700',
      'line-height: 1.35',
      'max-width: 280px',
      'padding: 12px 14px',
      'border-radius: 14px',
      `background: ${colors.bg}`,
      `color: ${colors.fg}`,
      'box-shadow: 0 8px 24px rgba(22, 18, 15, 0.18)',
    ].join(';'),
  )
  root.append(wrap)
  document.documentElement.append(host)
  window.setTimeout(() => host.remove(), 2800)
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (isToast(message)) showToast(message)
})
