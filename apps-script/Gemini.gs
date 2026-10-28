// Gemini call with structured JSON output. Model name lives in the GEMINI_MODEL script property,
// so it can be swapped if free-tier quotas or model names change.

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    intent: { type: 'STRING', enum: ['log', 'correct', 'delete', 'query', 'account', 'budget', 'category', 'help', 'email', 'other'] },
    delete_id: { type: 'STRING', nullable: true },
    transactions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          date: { type: 'STRING' },
          amount: { type: 'INTEGER' },
          type: { type: 'STRING', enum: ['expense', 'income', 'saving', 'transfer'] },
          category: { type: 'STRING' },
          account: { type: 'STRING', nullable: true },
          to_account: { type: 'STRING', nullable: true },
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
        id: { type: 'STRING', nullable: true },
        item: { type: 'INTEGER', nullable: true },
        amount: { type: 'INTEGER', nullable: true },
        category: { type: 'STRING', nullable: true },
        type: { type: 'STRING', nullable: true },
        date: { type: 'STRING', nullable: true },
        account: { type: 'STRING', nullable: true },
      },
    },
    query: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        metric: { type: 'STRING', enum: ['spending', 'income', 'saving', 'savings_rate', 'balance', 'account_balance', 'recent'] },
        period: { type: 'STRING', enum: ['today', 'week', 'month', 'all', 'custom'], nullable: true },
        account_kind: { type: 'STRING', enum: ['bank', 'ewallet', 'cash', 'tabungan', 'investasi', 'lainnya'], nullable: true },
        limit: { type: 'INTEGER', nullable: true },
        category: { type: 'STRING', nullable: true },
        account: { type: 'STRING', nullable: true },
        merchant: { type: 'STRING', nullable: true },
      },
    },
    account_setup: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        name: { type: 'STRING' },
        opening: { type: 'INTEGER', nullable: true },
        kind: { type: 'STRING', enum: ['bank', 'ewallet', 'cash', 'tabungan', 'investasi', 'lainnya'], nullable: true },
        rename_to: { type: 'STRING', nullable: true },
      },
    },
    budget_setup: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        category: { type: 'STRING', nullable: true },
        limit: { type: 'INTEGER', nullable: true },
      },
    },
    category_setup: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        type: { type: 'STRING', enum: ['expense', 'income', 'saving'], nullable: true },
        name: { type: 'STRING', nullable: true },
      },
    },
    reply_hint: { type: 'STRING', nullable: true },
    quip: { type: 'STRING', nullable: true },
  },
  required: ['intent', 'transactions'],
};

// One Gemini call with structured JSON output; retries rate limits and temporary overloads (429, 5xx) with a short
// backoff.
function callGemini_(systemText, userText, schema) {
  const model = PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || DEFAULT_MODEL;
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
  const body = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  };
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': prop_('GEMINI_API_KEY') },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  };
  let res = UrlFetchApp.fetch(url, options);
  for (let attempt = 1; attempt < 3 && (res.getResponseCode() === 429 || res.getResponseCode() >= 500); attempt++) {
    Utilities.sleep(attempt * 2000);
    res = UrlFetchApp.fetch(url, options);
  }
  if (res.getResponseCode() !== 200) {
    throw new Error('Gemini ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 900));
  }
  const data = JSON.parse(res.getContentText());
  const part = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  if (!part || !part[0] || !part[0].text) throw new Error('Gemini returned no content');
  return JSON.parse(part[0].text);
}

// todayLabel is optional (tests pin it); defaults to now in Asia/Jakarta.
function parseMessage_(text, todayLabel, ctx) {
  const today = todayLabel || Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd (EEEE)');
  return callGemini_(buildPrompt_(today, ctx), text, RESPONSE_SCHEMA);
}

// Best expense category for each merchant name from a QRIS email. Returns { lowercase merchant: category }.
function categorizeMerchants_(merchants, categories) {
  const schema = {
    type: 'OBJECT',
    properties: {
      items: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { merchant: { type: 'STRING' }, category: { type: 'STRING', enum: categories } },
          required: ['merchant', 'category'],
        },
      },
    },
    required: ['items'],
  };
  const system = 'Each line is a shop or service name from an Indonesian QRIS payment (it can be a brand, a legal ' +
    'entity or abbreviated). Return one item per line, merchant copied exactly, with the best category from the ' +
    'allowed list. Use "Lainnya" when you cannot tell.';
  const out = {};
  callGemini_(system, merchants.join('\n'), schema).items.forEach(function (it) {
    out[it.merchant.toLowerCase()] = it.category;
  });
  return out;
}
