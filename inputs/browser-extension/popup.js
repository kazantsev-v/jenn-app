const $ = id => document.getElementById(id)

const viewMain = $('view-main')
const viewSettings = $('view-settings')
const input = $('input')
const sendBtn = $('send-btn')
const bookmarkBtn = $('bookmark-btn')
const settingsBtn = $('settings-btn')
const backBtn = $('back-btn')
const openSettingsInline = $('open-settings-inline')
const noToken = $('no-token')
const toast = $('toast')
const settingsMsg = $('settings-msg')
const sUrl = $('s-url')
const sToken = $('s-token')
const saveBtn = $('save-btn')
const testBtn = $('test-btn')

// ── Storage ───────────────────────────────────

function getCfg() {
  return new Promise(r => chrome.storage.local.get(['serverUrl', 'token', 'showSettings'], r))
}

function setCfg(data) {
  return new Promise(r => chrome.storage.local.set(data, r))
}

// ── Toast ─────────────────────────────────────

function showToast(el, msg, ok = true, duration = 2500) {
  el.textContent = msg
  el.className = `toast ${ok ? 'ok' : 'err'}`
  clearTimeout(el._t)
  el._t = setTimeout(() => el.classList.add('hidden'), duration)
}

function hideToast(el) {
  clearTimeout(el._t)
  el.classList.add('hidden')
}

// ── View switching ────────────────────────────

function showView(name) {
  viewMain.classList.toggle('hidden', name !== 'main')
  viewSettings.classList.toggle('hidden', name !== 'settings')
  if (name === 'settings') {
    sToken.focus()
  } else {
    input.focus()
  }
}

// ── Send ──────────────────────────────────────

async function sendMessage(text, meta = {}) {
  const { serverUrl, token } = await getCfg()

  if (!token) {
    showView('settings')
    return
  }

  sendBtn.disabled = true
  bookmarkBtn.disabled = true
  hideToast(toast)

  try {
    const res = await fetch(`${serverUrl || 'http://localhost:3000'}/v1/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        source: 'browser_extension',
        text,
        user: { id: 'browser-user', name: 'Browser' },
        meta
      })
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(err || `HTTP ${res.status}`)
    }

    showToast(toast, '✓ Отправлено', true)
    input.value = ''
  } catch (e) {
    showToast(toast, `✗ ${e.message}`, false, 4000)
  } finally {
    sendBtn.disabled = false
    bookmarkBtn.disabled = false
  }
}

// ── Events: main view ─────────────────────────

sendBtn.addEventListener('click', () => {
  const text = input.value.trim()
  if (!text) return
  sendMessage(text, { type: 'text' })
})

bookmarkBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url) return

  const comment = input.value.trim()
  const text = `${tab.title}\n${tab.url}${comment ? '\n' + comment : ''}`

  sendMessage(text, {
    type: 'bookmark',
    url: tab.url,
    title: tab.title,
    comment
  })
})

input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendBtn.click()
})

settingsBtn.addEventListener('click', async () => {
  const { serverUrl, token } = await getCfg()
  sUrl.value = serverUrl || ''
  sToken.value = token || ''
  showView('settings')
})

openSettingsInline.addEventListener('click', e => {
  e.preventDefault()
  settingsBtn.click()
})

// ── Events: settings view ─────────────────────

backBtn.addEventListener('click', async () => {
  const { token } = await getCfg()
  noToken.classList.toggle('hidden', !!token)
  showView('main')
})

saveBtn.addEventListener('click', async () => {
  const url = sUrl.value.trim().replace(/\/+$/, '')
  const tok = sToken.value.trim()

  await setCfg({ serverUrl: url, token: tok, showSettings: false })
  showToast(settingsMsg, '✓ Сохранено', true)
})

testBtn.addEventListener('click', async () => {
  const url = (sUrl.value.trim().replace(/\/+$/, '')) || 'http://localhost:3000'
  const tok = sToken.value.trim()

  testBtn.disabled = true
  hideToast(settingsMsg)

  try {
    const res = await fetch(`${url}/v1/ping`, {
      headers: { 'Authorization': `Bearer ${tok}` }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    showToast(settingsMsg, `✓ ${data.source || 'Сервер доступен'}`, true)
  } catch (e) {
    showToast(settingsMsg, `✗ ${e.message}`, false, 4000)
  } finally {
    testBtn.disabled = false
  }
})

// ── Init ──────────────────────────────────────

getCfg().then(({ token, showSettings }) => {
  if (showSettings || !token) {
    noToken.classList.remove('hidden')
    showView('settings')
  } else {
    noToken.classList.add('hidden')
    input.focus()
  }
})
