module.exports = {
  name: 'browser_extension',
  title: 'Browser Extension',
  description: 'Расширение для Chrome / Firefox / Edge — текст и закладки',
  icon: '🌐',
  author: 'Jenn Core',
  version: '1.0.0',
  instructions: `
    <div style="background:var(--surface2);border-radius:8px;padding:14px;margin-bottom:16px;font-size:13px">
      <div style="font-weight:600;margin-bottom:8px">🔗 Подключение</div>
      <ol style="margin:0;padding-left:18px;color:var(--text2);line-height:1.7">
        <li>Скопируйте <strong>Source Token</strong> ниже (кнопка Copy)</li>
        <li>Откройте <code>chrome://extensions</code> (Firefox: <code>about:debugging</code>, Edge: <code>edge://extensions</code>)</li>
        <li>Включите <strong>Developer mode</strong> → <strong>Load unpacked</strong></li>
        <li>Выберите папку <code>inputs/browser-extension</code></li>
        <li>Нажмите ⚙️ в popup → вставьте токен и URL → Сохранить</li>
      </ol>
    </div>
  `,
  configFields: [
    { key: 'server_url', label: 'URL сервера', type: 'text', placeholder: 'https://jenn-app.tech', default: 'https://jenn-app.tech', readOnly: true }
  ],
  async test(config) {
    const url = config?.server_url || 'http://localhost:3000'
    const res = await fetch(`${url}/health`)
    if (!res.ok) throw new Error(`Сервер вернул ${res.status}`)
    const data = await res.json()
    return { message: `Сервер доступен (v${data.version || '?'})` }
  }
}
