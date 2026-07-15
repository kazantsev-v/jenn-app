module.exports = {
  name: 'desktop',
  title: 'Desktop Input',
  description: 'Отправка сообщений с рабочего стола через Alt+Space',
  icon: '💻',
  author: 'Jenn Core',
  version: '1.0.0',
  instructions: `
    <div style="background:var(--surface2);border-radius:8px;padding:14px;margin-bottom:16px;font-size:13px">
      <div style="font-weight:600;margin-bottom:8px">🔗 Подключение</div>
      <ol style="margin:0;padding-left:18px;color:var(--text2);line-height:1.7">
        <li>Скопируйте <strong>Source Token</strong> ниже (кнопка Copy)</li>
        <li>Откройте Desktop Input на вашем ПК</li>
        <li>При первом запуске вставьте токен и URL сервера в окно настройки</li>
        <li>Нажмите Alt+Space — введите текст — Enter → сообщение уйдёт на сервер</li>
      </ol>
    </div>
  `,
  configFields: [
    { key: 'source_name', label: 'Source Name', type: 'text', placeholder: 'desktop' },
    { key: 'server_url', label: 'URL сервера', type: 'text', placeholder: 'http://localhost:3000' },
    { key: 'user_name', label: 'Имя пользователя', type: 'text', placeholder: 'Desktop User' }
  ]
}
