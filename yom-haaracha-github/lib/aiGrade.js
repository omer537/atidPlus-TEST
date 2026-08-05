'use strict';
/* =========================================================================
   בדיקת «למד» (תשובות כתובות) ע"י Claude — אחרי האירוע.
   ה-AI *מציע*: ציון 1–5 לכל אחד מ-4 הקריטריונים, מסקנה קצרה, "על מה לשים לב"
   לבודק/ת האנושי/ת, ורמת ביטחון. הבודק/ת מאשר/ת או משנה — ההחלטה האנושית גוברת.

   ★ בדיקה מקובצת לפי שאלה: ל-369 התשובות של שני הימים יש רק 62 שאלות
   ייחודיות (השאלה בפרק הכללי לבדה נענתה 38 פעמים). שליחת הקטע והשאלה
   פעם אחת לכל קבוצה של עד 8 תשובות מורידה 369 קריאות ל-81, ובנוסף
   מאפשרת למודל לכייל בין התשובות — כמו בודק אנושי שעובר על שאלה אחת.

   4 הקריטריונים (מנורמלים ל-1–5, מתויגים בציר ב-lib/score.js):
     accuracy      — דיוק תוכני            [תוכן]
     depth         — עומק ותובנה           [תוכן]
     diagnosis_fit — אבחון והתאמה לתלמיד    [הוראה]
     clarity       — בהירות ובניית ההבנה   [הוראה]

   מפתח API דרך ENV (ANTHROPIC_API_KEY / CLAUDE_API_KEY) או config.local.json.
   בלי מפתח → מצב הדגמה (ציון מבני, demo:true) — כדי לראות את הזרימה.
   ========================================================================= */
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const AnthropicClient = Anthropic.default || Anthropic;

// כמה תשובות לאותה שאלה נשלחות בקריאה אחת.
const BATCH_SIZE = 8;

function loadConfig() {
  let cfg = {};
  try {
    const p = path.join(__dirname, '..', 'config.local.json');
    if (fs.existsSync(p)) cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { /* קובץ פגום — מתעלמים */ }
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || cfg.apiKey || null;
  // ⚠ שמות ייחודיים לפרויקט. CLAUDE_MODEL / CLAUDE_EFFORT מוגדרים ע"י כלי פיתוח
  // אחרים בסביבה ודרסו כאן את ברירת המחדל בשקט.
  const model = process.env.GRADING_MODEL || cfg.model || 'claude-opus-5';
  const effort = process.env.GRADING_EFFORT || cfg.effort || 'medium';
  return { apiKey: apiKey, model: model, effort: effort };
}

function hasApiKey() { return !!loadConfig().apiKey; }

let _client = null, _clientKey = null;
function getClient(cfg) {
  // ה-SDK מטפל לבד ב-429/5xx עם backoff וכיבוד retry-after — בדיוק מה שצריך
  // ל-81 קריאות רצופות. maxRetries גבוה מברירת המחדל (2) כי הרצה שלמה ארוכה.
  if (_client && _clientKey === cfg.apiKey) return _client;
  _client = new AnthropicClient({ apiKey: cfg.apiKey, maxRetries: 5, timeout: 10 * 60 * 1000 });
  _clientKey = cfg.apiKey;
  return _client;
}

const CRITERIA = ['accuracy', 'depth', 'diagnosis_fit', 'clarity'];

// ---------- מצב הדגמה (בלי מפתח) ----------
function demoGradeTeach(question, answer) {
  const text = String(answer || '').trim();
  const len = text.length;
  const base = len === 0 ? 1 : Math.max(1, Math.min(5, 2 + Math.floor(len / 140)));
  const criteria = {};
  CRITERIA.forEach(function (c, i) { criteria[c] = Math.max(1, Math.min(5, base - (i % 2))); });
  return {
    ok: true, demo: true, criteria: criteria,
    conclusion: len === 0 ? 'לא נכתבה תשובה.'
      : 'ציון הדגמה (בלי מפתח API) — מבוסס על אורך ומבנה בלבד, לא על התוכן.',
    // ⚠ השדה נשאר ריק בכוונה: הוא מזין את מסנן «דורש תשומת לב», ואם נכתוב בו
    // הודעת הדגמה כל 305 הפריטים יסומנו והמסנן יאבד את כל התועלת שלו.
    // הודעת מצב ההדגמה מוצגת כבאנר במסך.
    attention: '',
    confidence: 'low', evidence: '',
  };
}

// תשובה ריקה / «לא יודע/ת» — 1 בכל הקריטריונים, בלי לבזבז קריאה.
function blankResult(cfg) {
  return { ok: true, demo: !cfg || !cfg.apiKey, criteria: { accuracy: 1, depth: 1, diagnosis_fit: 1, clarity: 1 },
    conclusion: 'לא נכתבה תשובה / "לא יודע/ת".', attention: '', confidence: 'high', evidence: '' };
}
function isBlank(item) {
  return !!(item.dontKnow || !String(item.answer == null ? '' : item.answer).trim());
}

// ---------- הפרומפט (עברי, עם עוגני 1/3/5) ----------
const SYSTEM_PROMPT =
  'את/ה בודק/ת מומחה/ית ביום הערכה למועמדים למלגת הוראה. המבחן בודק את היכולת ' +
  'ללמד חומר לתלמיד — לא רק לפתור. קרא/י את שאלת ההוראה ואת תשובות המועמדים, ותן/י ' +
  'ציון שלם 1–5 לכל אחד מארבעת הקריטריונים, לפי העוגנים.\n\n' +
  'הקריטריונים והעוגנים:\n' +
  '• accuracy (דיוק תוכני): 5 = מדויק לחלוטין; בשאלת-טעות זיהה נכון את שורש התפיסה השגויה. ' +
  '3 = בגדול נכון אך עם אי-דיוק או חוסר. 1 = שגוי או מפספס את העיקר (מסוכן — יחזק טעות).\n' +
  '• depth (עומק ותובנה): 5 = הבנה עמוקה, יורד לשורש הרעיון. 3 = הבנה בסיסית ושטחית. 1 = שינון בלי הבנה.\n' +
  '• diagnosis_fit (אבחון והתאמה לתלמיד): 5 = מזהה ופוגש את הקושי הספציפי של התלמיד, ברמה ובשפה מתאימות. ' +
  '3 = כללי, לא ממש מותאם לתלמיד הזה. 1 = לא נוגע בקושי / לא מותאם / מתנשא.\n' +
  '• clarity (בהירות ובניית ההבנה): 5 = ברור ומובנה, בונה הבנה עם דוגמה/אנלוגיה. 3 = מובן אך יבש/חלקי, בלי דוגמה. 1 = מבלבל או רק חוזר על הכלל.\n\n' +
  'כללים: תשובה ריקה או "לא יודע/ת" → 1 בכל הקריטריונים. אל תתגמל מילים יפות על חשבון נכונות. ' +
  'אם התוכן שגוי — accuracy נמוך גם אם ההסבר יפה. בשדה attention כתב/י מה כדאי לבודק/ת האנושי/ת לבדוק בעצמו/ה ' +
  '(או "" אם אין). confidence = high/medium/low לפי כמה את/ה בטוח/ה בציון.\n\n' +
  '★ כשמוצגות כמה תשובות לאותה שאלה: דרג/י כל תשובה **מול העוגנים שלמעלה**, לא ' +
  'מול התשובות האחרות. אין מנה קבועה של ציונים — אם כל התשובות מעולות, כולן יקבלו 5. ' +
  'הצגתן יחד נועדה רק כדי שהסולם יהיה עקבי ביניהן. החזר/י רשומה אחת לכל מפתח שהוצג, ' +
  'עם ה-key המדויק.';

// סכימת הפלט — הפלט המובנה מבטיח JSON תקין לפי הסכימה,
// במקום להסתמך על "החזר JSON בלבד" בפרומפט (שם נולד הכשל «לא ניתן לפענח»).
const SCORE_1_5 = { type: 'integer', enum: [1, 2, 3, 4, 5] };
const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          accuracy: SCORE_1_5,
          depth: SCORE_1_5,
          diagnosis_fit: SCORE_1_5,
          clarity: SCORE_1_5,
          conclusion: { type: 'string' },
          attention: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          evidence: { type: 'string' },
        },
        required: ['key', 'accuracy', 'depth', 'diagnosis_fit', 'clarity', 'conclusion', 'attention', 'confidence', 'evidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

function buildBatchPrompt(subject, sourceText, question, items) {
  const answers = items.map(function (it) {
    return 'key: ' + it.key + '\nתשובה: """' + String(it.answer == null ? '' : it.answer) + '"""';
  }).join('\n\n');
  return (
    'מקצוע: ' + (subject || '') + '\n' +
    (sourceText ? 'קטע מוצג לתלמיד: """' + sourceText + '"""\n' : '') +
    'שאלת ההוראה: ' + (question || '') + '\n\n' +
    'להלן ' + items.length + ' תשובות של מועמדים שונים לאותה שאלה. ' +
    'דרג/י כל אחת בנפרד מול העוגנים, והחזר/י רשומה לכל key:\n\n' +
    answers
  );
}

function clampScore(v) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return null;
  return Math.max(1, Math.min(5, n));
}

function normalizeEntry(e) {
  const criteria = {};
  CRITERIA.forEach(function (c) { const v = clampScore(e[c]); if (v != null) criteria[c] = v; });
  return {
    ok: Object.keys(criteria).length === CRITERIA.length,
    demo: false,
    criteria: criteria,
    conclusion: String(e.conclusion || '').slice(0, 400),
    attention: String(e.attention || '').slice(0, 400),
    confidence: ['high', 'medium', 'low'].indexOf(e.confidence) >= 0 ? e.confidence : 'medium',
    evidence: String(e.evidence || '').slice(0, 300),
  };
}

// ---------- קריאה אחת מול Claude, לקבוצת תשובות לאותה שאלה ----------
async function callClaudeBatch(cfg, subject, sourceText, question, items) {
  const client = getClient(cfg);
  const res = await client.messages.create({
    model: cfg.model,
    max_tokens: 8000,           // 8 תשובות + חשיבה (דלוקה כברירת מחדל ב-Opus 5)
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: cfg.effort, format: { type: 'json_schema', schema: RESULT_SCHEMA } },
    messages: [{ role: 'user', content: buildBatchPrompt(subject, sourceText, question, items) }],
  });
  if (res.stop_reason === 'refusal') {
    throw new Error('הבקשה נדחתה ע"י מסנני הבטיחות (' + ((res.stop_details && res.stop_details.category) || 'ללא סיבה') + ').');
  }
  const textOut = (res.content || []).filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; }).join('');
  if (res.stop_reason === 'max_tokens') throw new Error('התשובה נחתכה (max_tokens) — יש לקבץ פחות תשובות.');
  const parsed = JSON.parse(textOut);
  const byKey = {};
  (parsed.results || []).forEach(function (e) { if (e && e.key) byKey[String(e.key)] = normalizeEntry(e); });
  return byKey;
}

// ---------- קיבוץ פריטים לפי (פרק, שאלה) ----------
// שומר על כל הפריטים, בקבוצות של עד size, ולא מערבב שאלות שונות בקריאה אחת.
function groupItemsByQuestion(items, size) {
  const n = size || BATCH_SIZE;
  const byQ = new Map();
  items.forEach(function (gi) {
    const k = gi.chapter_id + '|' + gi.item_id;
    if (!byQ.has(k)) byQ.set(k, []);
    byQ.get(k).push(gi);
  });
  const groups = [];
  for (const list of byQ.values()) {
    for (let i = 0; i < list.length; i += n) groups.push(list.slice(i, i + n));
  }
  return groups;
}

// ---------- ממשק ציבורי: בדיקת קבוצת תשובות לאותה שאלה ----------
// question = { subject, sourceText, question }
// items    = [ { key, answer, dontKnow } ]
// פלט      = { <key>: result }  — רשומה לכל key שהתבקש, תמיד.
async function gradeTeachBatch(question, items, cfg) {
  cfg = cfg || loadConfig();
  const out = {};
  const toAsk = [];
  items.forEach(function (it) {
    if (isBlank(it)) out[it.key] = blankResult(cfg);
    else if (!cfg.apiKey) out[it.key] = demoGradeTeach(question.question, it.answer);
    else toAsk.push(it);
  });
  if (!toAsk.length) return out;

  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const byKey = await callClaudeBatch(cfg, question.subject, question.sourceText, question.question, toAsk);
      const missing = toAsk.filter(function (it) { return !byKey[it.key] || !byKey[it.key].ok; });
      if (!missing.length) {
        toAsk.forEach(function (it) { out[it.key] = byKey[it.key]; });
        return out;
      }
      // חלק חזר תקין — שומרים אותו, ומנסים שוב רק על החסרים.
      toAsk.forEach(function (it) { if (byKey[it.key] && byKey[it.key].ok) out[it.key] = byKey[it.key]; });
      lastErr = new Error('חסרו ' + missing.length + ' תשובות בפלט.');
      if (attempt === 1) break;
    } catch (e) {
      lastErr = e;
    }
  }

  // ⚠ נפילה חזרה לבדיקה בודדת: קריאה מקובצת שנכשלה לא תפיל 8 תשובות.
  const remaining = items.filter(function (it) { return !out[it.key]; });
  for (const it of remaining) {
    out[it.key] = await gradeTeachItem({ subject: question.subject, sourceText: question.sourceText,
      question: question.question, answer: it.answer, dontKnow: it.dontKnow }, cfg);
    if (out[it.key] && !out[it.key].ok && lastErr) {
      out[it.key].conclusion = 'שגיאת בדיקה: ' + String(lastErr.message).slice(0, 160);
    }
  }
  return out;
}

// ---------- בדיקת פריט «למד» בודד (גיבוי, ומצב הדגמה) ----------
// item = { subject, sourceText, question, answer, dontKnow }
async function gradeTeachItem(item, cfg) {
  cfg = cfg || loadConfig();
  if (isBlank(item)) return blankResult(cfg);
  if (!cfg.apiKey) return demoGradeTeach(item.question, item.answer);
  try {
    const byKey = await callClaudeBatch(cfg, item.subject, item.sourceText, item.question,
      [{ key: 'a1', answer: item.answer }]);
    if (byKey.a1 && byKey.a1.ok) return byKey.a1;
    throw new Error('הפלט לא כלל ציון לפריט.');
  } catch (e) {
    return { ok: false, demo: false, criteria: {}, conclusion: 'שגיאת בדיקה: ' + String(e.message).slice(0, 160),
      attention: 'יש לבדוק ידנית.', confidence: 'low', evidence: '', error: true };
  }
}

// ---------- בדיקת חיבור: קריאה אחת זולה, לפני שמשגרים עשרות ----------
// מחזירה מסר בעברית שאפשר להציג ישר במסך.
async function testKey(cfg) {
  cfg = cfg || loadConfig();
  if (!cfg.apiKey) {
    return { ok: false, demo: true, message: 'לא הוגדר מפתח API. הבדיקה תרוץ במצב הדגמה בלבד.' };
  }
  try {
    const client = getClient(cfg);
    const res = await client.messages.create({
      model: cfg.model,
      max_tokens: 16,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: 'ענה במילה אחת: תקין' }],
    });
    const txt = (res.content || []).filter(function (b) { return b.type === 'text'; })
      .map(function (b) { return b.text; }).join('').trim();
    return { ok: true, demo: false, model: res.model || cfg.model,
      message: 'המפתח עובד. המודל ' + (res.model || cfg.model) + ' ענה: «' + txt.slice(0, 40) + '»',
      usage: res.usage || null };
  } catch (e) {
    const status = e && e.status;
    let hint = '';
    if (status === 401) hint = ' — המפתח שגוי או בוטל.';
    else if (status === 403) hint = ' — למפתח אין הרשאה למודל הזה.';
    else if (status === 404) hint = ' — שם המודל אינו מוכר (' + cfg.model + ').';
    else if (status === 429) hint = ' — חריגה ממגבלת הקצב. נסו בעוד דקה.';
    else if (status >= 500) hint = ' — תקלה זמנית בשרת של Anthropic. נסו שוב.';
    return { ok: false, demo: false, status: status || null,
      message: 'הבדיקה נכשלה' + (status ? ' (' + status + ')' : '') + hint + ' ' + String(e.message || '').slice(0, 200) };
  }
}

module.exports = { loadConfig, hasApiKey, gradeTeachItem, gradeTeachBatch, groupItemsByQuestion, testKey,
  normalizeEntry, buildBatchPrompt, RESULT_SCHEMA, CRITERIA, SYSTEM_PROMPT, BATCH_SIZE };
