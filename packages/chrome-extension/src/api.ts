export const APP_ORIGIN = 'https://english.readish.app'
export const SESSION_COOKIE = 'uid'

export type ExtensionAccount = {
  email: string | null
  signedIn: boolean
}

export type AddWordResult = {
  created: boolean
  word: { headword: string }
}

export class ExtensionApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ExtensionApiError'
  }
}

export async function readSessionId(): Promise<string | null> {
  const cookie = await chrome.cookies.get({
    url: `${APP_ORIGIN}/`,
    name: SESSION_COOKIE,
  })
  return cookie?.value ?? null
}

export async function clearSession(): Promise<void> {
  await chrome.cookies.remove({
    url: `${APP_ORIGIN}/`,
    name: SESSION_COOKIE,
  })
}

export function openGoogleSignIn(): void {
  void chrome.tabs.create({ url: `${APP_ORIGIN}/api/auth/google` })
}

async function request<T>(
  path: string,
  init: RequestInit & { token: string | null },
): Promise<T> {
  const { token, ...rest } = init
  if (!token) {
    throw new ExtensionApiError(401, 'Sign in with Gmail first')
  }
  const response = await fetch(`${APP_ORIGIN}${path}`, {
    ...rest,
    headers: {
      ...rest.headers,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })
  const payload = (await response.json().catch(() => null)) as
    | T
    | { error?: string }
    | null
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? (payload.error ?? 'Request failed')
        : 'Request failed'
    throw new ExtensionApiError(response.status, message)
  }
  return payload as T
}

export function getAccount(token: string | null) {
  return request<ExtensionAccount>('/api/extension/me', {
    method: 'GET',
    token,
  })
}

export function addWord(token: string | null, headword: string) {
  return request<AddWordResult>('/api/extension/words', {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ headword }),
  })
}
