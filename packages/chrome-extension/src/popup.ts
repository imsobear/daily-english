import {
  clearSession,
  getAccount,
  openGoogleSignIn,
  readSessionId,
  SESSION_COOKIE,
  type ExtensionAccount,
} from './api'

const statusEl = document.querySelector('#status')
const actionsEl = document.querySelector('#actions')

if (!(statusEl instanceof HTMLElement) || !(actionsEl instanceof HTMLElement)) {
  throw new Error('Popup markup is missing')
}

const status = statusEl
const actions = actionsEl

function render(account: ExtensionAccount | null, loading = false) {
  if (loading) {
    status.textContent = 'Checking sign-in…'
    actions.replaceChildren()
    return
  }

  if (account?.signedIn) {
    status.textContent = account.email
      ? `Signed in as ${account.email}.`
      : 'Signed in with Gmail.'
    const out = document.createElement('button')
    out.type = 'button'
    out.textContent = 'Sign out'
    out.addEventListener('click', () => {
      void clearSession().then(() => render(null))
    })
    actions.replaceChildren(out)
    return
  }

  status.textContent =
    'Sign in with Gmail on Readish so added words go to your list.'
  const signin = document.createElement('button')
  signin.type = 'button'
  signin.className = 'primary'
  signin.textContent = 'Continue with Gmail'
  signin.addEventListener('click', () => openGoogleSignIn())
  actions.replaceChildren(signin)
}

async function refresh() {
  render(null, true)
  const token = await readSessionId()
  if (!token) {
    render(null)
    return
  }
  try {
    render(await getAccount(token))
  } catch {
    render(null)
  }
}

void refresh()

chrome.cookies.onChanged.addListener((change) => {
  if (
    change.cookie.name === SESSION_COOKIE &&
    change.cookie.domain.includes('readish.app')
  ) {
    void refresh()
  }
})
