// Gemini call with structured JSON output. Model name lives in the GEMINI_MODEL script property,
// so it can be swapped if free-tier quotas or model names change.

const DEFAULT_MODEL = 'gemini-3.8-flash';

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    intent: { type: 'STRING', enum: ['log', 'correct', 'query', 'other'] },
    transactions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          date: { type: 'STRING' },
          amount: { type: 'INTEGER' },
          type: { type: 'STRING', enum: ['expense', 'income', 'saving'] },
          category: { type: 'STRING' },
          account: { type: 'STRING', nullable: true },
          merchant: { type: 'STRING', nullable: true },
          note: { type: 'STRING', nullable: true },
        },
        required: ['date', 'amount', 'type', 'category'],
      },
    },
    correction: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        amount: { type: 'INTEGER', nullable: true },
        category: { type: 'STRING', nullable: true },
        type: { type: 'STRING', nullable: true },
        date: { type: 'STRING', nullable: true },
      },
    },
    query: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        metric: { type: 'STRING', enum: ['spending', 'income', 'saving', 'savings_rate', 'balance'] },
        period: { type: 'STRING', enum: ['today', 'week', 'month', 'custom'] },
        category: { type: 'STRING', nullable: true },
      },
    },
    reply_hint: { type: 'STRING', nullable: true },
  },
  required: ['intent', 'transactions'],
};

// todayLabel is optional (tests pin it); defaults to now in Asia/Jakarta.
function parseMessage_(text, todayLabel, cats) {
  const today = todayLabel || Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd (EEEE)');
  const model = PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || DEFAULT_MODEL;
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
  const body = {
    systemInstruction: { parts: [{ text: buildPrompt_(today, cats) }] },
    contents: [{ role: 'user', parts: [{ text: text }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': prop_('GEMINI_API_KEY') },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Gemini ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  }
  const data = JSON.parse(res.getContentText());
  const part = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  if (!part || !part[0] || !part[0].text) throw new Error('Gemini returned no content');
  return JSON.parse(part[0].text);
}
