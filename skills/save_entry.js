module.exports = {
  name: 'save_entry',
  title: 'Сохранить заметку',
  icon: '📝',
  description: 'Сохранить любую информацию: заметки, задачи, идеи, ссылки, поручения. AI сам определит категорию.',
  capability: 'knowledge.save_text',
  outputFunction: 'saveText',
  params: {
    title: { type: 'string', description: 'Заголовок (опционально)' },
    text: { type: 'string', description: 'Текст записи' },
    category: { type: 'string', description: 'Категория из select/multi_select/status-поля таблицы' },
    date: { type: 'string', description: 'Дата YYYY-MM-DD' },
    destination: { type: 'string', description: 'Destination для сохранения' },
    database: { type: 'string', description: 'Legacy: база для сохранения' },
    source: { type: 'string', description: 'Источник из select-поля таблицы' },
    priority: { type: 'string', description: 'Приоритет из select-поля' },
    status: { type: 'string', description: 'Статус из status/select-поля' },
    tags: { type: 'array', description: 'Теги (multi_select)' },
    url: { type: 'string', description: 'URL из url-поля таблицы' },
    email: { type: 'string', description: 'Email из email-поля' },
    phone: { type: 'string', description: 'Телефон из phone_number-поля' },
    number: { type: 'string', description: 'Число из number-поля' },
    checked: { type: 'boolean', description: 'Галочка из checkbox-поля' }
  },
  describe() {
    return {
      name: this.name,
      title: this.title,
      icon: this.icon,
      description: this.description,
      outputFunction: this.outputFunction,
      author: 'Jenn Core',
      version: '2.1.0',
      params: this.params,
      configSchema: {
        output: { type: 'output', label: 'Output', required: true, description: 'Куда сохранять' },
        destination: { type: 'text', label: 'Destination', required: false, description: 'База/назначение по умолчанию внутри output' }
      }
    }
  },
  async handler(params, message, outputFunctions, skillConfig) {
    const defaultDestination = skillConfig?.routingMode === 'fixed'
      ? (skillConfig?.destination || skillConfig?.database || null)
      : null
    const data = {
      ...params,
      title: params.title || (params.text || message.text).slice(0, 80),
      text: params.text || message.text,
      destination: params.destination || params.database || defaultDestination,
      database: params.database || params.destination || defaultDestination,
      source: message.source
    }
    return {
      action: {
        capability: this.capability,
        output: skillConfig?.output || null,
        function: skillConfig?.function || this.outputFunction,
        params: data
      },
      preview: data
    }
  }
}
