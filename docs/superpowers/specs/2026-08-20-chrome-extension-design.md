# Chrome extension — add words from the page

Date: 2026-08-20

## Product

A Manifest V3 Chrome extension in `packages/chrome-extension` that adds a selected word or short phrase to the same list as [english.readish.app](https://english.readish.app), under the same Gmail account.

## Locked decisions

| Topic | Decision |
|---|---|
| Login | Reuse the website Gmail session. Popup opens `/api/auth/google`. Extension reads the HttpOnly `uid` cookie via `chrome.cookies`. |
| Guest | Do not add. Toast: “Sign in with Gmail first.” Never mint a guest via `ensureUser()`. |
| Feedback | Toast overlay on the page (shadow root). No system notification. Silent if the page cannot host a content script. |
| Popup | Account status + Continue with Gmail / Sign out only. |
| Selection | Word or short phrase, same as the site (normalized, 1–80 characters). |
| Source URL | Do not save. `source` is `manual`. |
| Backend | Production only: `https://english.readish.app`. |
| Auth on API | `Authorization: Bearer <uid>`. Do not send the session cookie from the extension (`SameSite=Lax` would drop it anyway). |

## Architecture

The web app stays at the repo root. The extension is a workspace package. Because the session cookie is `SameSite=Lax`, the service worker cannot rely on `credentials: include`. It copies `uid` with `chrome.cookies.get` and sends it as a bearer token.

New server routes (HTTP contract for the extension; business logic shared with the existing `addWord` server function):

- `GET /api/extension/me` → `{ email, signedIn }` (`signedIn` is true only when the user has a `googleId`)
- `POST /api/extension/words` `{ headword }` → `{ created, word: { headword } }`

Missing/unknown token → 401. Cookie present but guest (no Gmail) → 403. Duplicate headword → 200 with `created: false`.

## Extension pieces

| Piece | Job |
|---|---|
| Service worker | Context menu “Add “%s” to word list”, cookie, API, message to the tab |
| Content script (`http`/`https`) | Toast in a shadow root |
| Popup | Signed-in email, Continue with Gmail, Sign out (`chrome.cookies.remove` of `uid`, which also signs the site out) |

## Permissions

`contextMenus`, `cookies`, host `https://english.readish.app/*`. Content scripts match `http://*/*` and `https://*/*`.

## Out of scope

Localhost override, in-extension OAuth client, word list in the popup, `source_url`, Chrome notifications, Firefox.
