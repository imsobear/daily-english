import {
  addWord,
  ExtensionApiError,
  readSessionId,
} from './api'
import { prepareSelection, toastCopy } from './selection'

const MENU_ID = 'add-word'

function ensureMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Add “%s” to word list',
      contexts: ['selection'],
    })
  })
}

chrome.runtime.onInstalled.addListener(ensureMenu)
chrome.runtime.onStartup.addListener(ensureMenu)

type ToastMessage = {
  type: 'toast'
  text: string
  tone: 'ok' | 'warn' | 'error'
}

async function showToast(tabId: number | undefined, message: ToastMessage) {
  if (tabId == null) return
  try {
    await chrome.tabs.sendMessage(tabId, message)
  } catch {
    // PDFs, chrome://, and similar pages have no content script.
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return

  const prepared = prepareSelection(info.selectionText ?? '')
  if (!prepared.ok) {
    await showToast(tab?.id, {
      type: 'toast',
      text: toastCopy({ type: 'invalid', detail: prepared.message }),
      tone: 'error',
    })
    return
  }

  const token = await readSessionId()
  try {
    const result = await addWord(token, prepared.headword)
    await showToast(tab?.id, {
      type: 'toast',
      text: toastCopy({
        type: result.created ? 'added' : 'duplicate',
        headword: result.word.headword,
      }),
      tone: result.created ? 'ok' : 'warn',
    })
  } catch (error) {
    const signin =
      error instanceof ExtensionApiError &&
      (error.status === 401 || error.status === 403)
    await showToast(tab?.id, {
      type: 'toast',
      text: toastCopy({
        type: signin ? 'signin' : 'network',
        headword: prepared.headword,
      }),
      tone: 'error',
    })
  }
})
