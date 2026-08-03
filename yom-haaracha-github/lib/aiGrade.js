'use strict';
/* =========================================================================
   בדיקת «למד» (תשובות כתובות) ע"י Claude — אחרי האירוע.
   ה-AI *מציע*: ציון 1–5 לכל אחד מ-4 הקריטריונים, מסקנה קצרה, "על מה לשים לב"
   לבודק/ת האנושי/ת, ורמת ביטחון. הבודק/ת מאשר/ת או משנה — ההחלטה האנושית גוברת.

   4 הקריטריונים (מנורמלים ל-1–5, מתויגים בציר ב-lib/score.js):
     accuracy      — דיוק תוכני            [תוכן]
     depth         — עומק ותובנה           [תוכן]
     diagnosis_fit — אבחון והתאמה לתלמיד    [הוראה]
     clarity       — בהירות ובניית ההבנה   [הוראה]

   מפתח API דרך ENV (ANTHROPIC_API_KEY / CLAUDE_API_KEY) או config.local.json.
   בלי מפתח → מצב הדגמה (ציון מבני, demo:true) — כדי לראות את הזרימה בלי בדיקה אמיתית.
   ========================================================================= */
const fs = require('fs');
const path = require('path');

function loadConfig() {
  let cfg = {};
  try {
    const p = path.join(__dirname, '..', 'config.local.json');
    if (fs.existsSync(p)) cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { /* קובץ פגום — מתעלמים */ }
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || cfg.apiKey || null;
  const model = process.env.CLAUDE_MODEL || cfg.model || 'claude-sonnet-5';
  return { apiKey: apiKey, model: model };
}

function hasApiKey() { return !!loadConfig().apiKey; }

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
    conclusion: len === 0 ? 'לא נכתבה תשובה.' : 'ציון הדגמה (בלי מפתח API) — מבוסס על אורך ומבנה בלבד.',
    attention: 'זהו מצב הדגמה: כדי לקבל בדיקה אמיתית של התוכן, יש להגדיר מפתח Claude API.',
    confidence: 'low', evidence: '',
  };
}

// ---------- הפרומפט (עברי, עם עוגני 1/3/5) ----------
const SYSTEM_PROMPT =
  'את/ה בודק/ת מומחה/ית ביום הערכה למועמדים למלגת הוראה. המבחן בודק את היכולת ' +
  'ללמד חומר לתלמיד — לא רק לפתור. קרא/י את שאלת ההוראה ואת תשובת המועמד/ת, ותן/י ' +
  'ציון שלם 1–5 לכל אחד מארבעת הקריטריונים, לפי העוגנים. החזר/י JSON בלבד, בלי טקסט נוסף.\n\n' +
  'הקריטריונים והעוגנים:\n' +
  '• accuracy (דיוק תוכני): 5 = מדויק לחלוטין; בשאלת-טעות זיהה נכון את שורש התפיסה השגויה. ' +
  '3 = בגדול נכון אך עם אי-דיוק או חוסר. 1 = שגוי או מפספס את העיקר (מסוכן — יחזק טעות).\n' +
  '• depth (עומק ותובנה): 5 = הבנה עמוקה, יורד לשורש הרעיון. 3 = הבנה בסיסית ושטחית. 1 = שינון בלי הבנה.\n' +
  '• diagnosis_fit (אבחון והתאמה לתלמיד): 5 = מזהה ופוגש את הקושי הספציפי של התלמיד, ברמה ובשפה מתאימות. ' +
  '3 = כללי, לא ממש מותאם לתלמיד הזה. 1 = לא נוגע בקושי / לא מותאם / מתנשא.\n' +
  '• clarity (בהירות ובניית ההבנה): 5 = ברור ומובנה, בונה הבנה עם דוגמה/אנלוגיה. 3 = מובן אך יבש/חלקי, בלי דוגמה. 1 = מבלבל או רק חוזר על הכלל.\n\n' +
  'כללים: תשובה ריקה או "לא יודע/ת" → 1 בכל הקריטריונים. אל תתגמל מילים יפות על חשבון נכונות. ' +
  'אם התוכן שגוי — accuracy נמוך גם אם ההסבר יפה. בשדה attention כתב/י מה כדאי לבודק/ת האנושי/ת לבדוק בעצמו/ה ' +
  '(או "" אם אין). confidence = high/medium/low לפי כמה את/ה בטוח/ה בציון.';

function buildUserPrompt(subject, sourceText, question, answer) {
  return (
    'מקצוע: ' + (subject || '') + '\n' +
    (sourceText ? 'קטע מוצג לתלמיד: """' + sourceText + '"""\n' : '') +
    'שאלת ההוראה: ' + (question || '') + '\n' +
    'תשובת המועמד/ת: """' + String(answer == null ? '' : answer) + '"""\n\n' +
    'החזר/י אך ורק JSON בצורה:\n' +
    '{"criteria":{"accuracy":<1-5>,"depth":<1-5>,"diagnosis_fit":<1-5>,"clarity":<1-5>},' +
    '"conclusion":"<מסקנה קצרה בעברית, השורה התחתונה>",' +
    '"attention":"<על מה כדאי לבודק/ת האנושי/ת לשים לב, או ריק>",' +
    '"confidence":"<high|medium|low>",' +
    '"evidence":"<ציטוט קצר מהתשובה, או ריק>"}'
  );
}

function clampScore(v) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return null;
  return Math.max(1, Math.min(5, n));
}

// ---------- בדיקה אמיתית מול Claude ----------
async function realGradeTeach(cfg, subject, sourceText, question, answer) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 700,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(subject, sourceText, question, answer) }],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(function () { return ''; });
    throw new Error('Claude API ' + res.status + ': ' + String(t).slice(0, 200));
  }
  const data = await res.json();
  const textOut = (data.content || []).map(function (c) { return c.text || ''; }).join('');
  let parsed;
  try {
    const m = textOut.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : textOut);
  } catch (e) {
    return { ok: false, demo: false, criteria: {}, conclusion: 'לא ניתן היה לפענח את תשובת המודל.', attention: 'יש לבדוק ידנית.', confidence: 'low', evidence: '', raw: textOut.slice(0, 200) };
  }
  const rawC = parsed.criteria || {};
  const criteria = {};
  CRITERIA.forEach(function (c) { const v = clampScore(rawC[c]); if (v != null) criteria[c] = v; });
  return {
    ok: Object.keys(criteria).length > 0,
    demo: false,
    criteria: criteria,
    conclusion: String(parsed.conclusion || '').slice(0, 400),
    attention: String(parsed.attention || '').slice(0, 400),
    confidence: ['high', 'medium', 'low'].indexOf(parsed.confidence) >= 0 ? parsed.confidence : 'medium',
    evidence: String(parsed.evidence || '').slice(0, 300),
  };
}

// ---------- ממשק ציבורי: בדיקת פריט «למד» אחד ----------
// item = { subject, sourceText, question, answer, dontKnow }
async function gradeTeachItem(item, cfg) {
  cfg = cfg || loadConfig();
  if (item.dontKnow || !String(item.answer || '').trim()) {
    return { ok: true, demo: !cfg.apiKey, criteria: { accuracy: 1, depth: 1, diagnosis_fit: 1, clarity: 1 },
      conclusion: 'לא נכתבה תשובה / "לא יודע/ת".', attention: '', confidence: 'high', evidence: '' };
  }
  if (!cfg.apiKey) return demoGradeTeach(item.question, item.answer);
  try {
    return await realGradeTeach(cfg, item.subject, item.sourceText, item.question, item.answer);
  } catch (e) {
    return { ok: false, demo: false, criteria: {}, conclusion: 'שגיאת בדיקה: ' + e.message.slice(0, 160), attention: 'יש לבדוק ידנית.', confidence: 'low', evidence: '', error: true };
  }
}

module.exports = { loadConfig, hasApiKey, gradeTeachItem, CRITERIA, SYSTEM_PROMPT };
