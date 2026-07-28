'use strict';
/*
 * "שומר הסף" — בדיקת תקינות אוטומטית של פרק לפי כללי התוכן הנעולים (סעיף 5 בבריף):
 *   1. שאלות הוראה חייבות להיות מילוליות בלבד — אסורות מילות פעולה כמו
 *      "נסח", "כתוב משוואה", "צייר", "שרטט", "בנה טבלה", "סמן על הגרף".
 *   2. כל שאלת הוראה מסומנת answer_mode: "text_explanation" (אכיפה טכנית).
 *   3. כל ביטוי KaTeX חייב להתרנדר בהצלחה — כך תופסים "בליעת backslash".
 *   4. שאלת רב-ברירה חייבת בדיוק תשובה נכונה אחת.
 *   5. אזהרה כשקטע פענוח קצר מדי (חשד שאינו מגדיר את המונחים).
 *
 * אפשר להריץ ידנית על כל הבנק:  node lib/guardrail.js
 */
const katex = require('katex');

// מילות איסור בניסוח שאלת הוראה (מבקשות פעולה לא-מילולית).
const FORBIDDEN = [
  'נסח', 'נסחו',
  'כתוב משוואה', 'כתבו משוואה', 'רשום משוואה',
  'צייר', 'ציירו',
  'שרטט', 'שרטטו',
  'בנה טבלה', 'בנו טבלה', 'ערוך טבלה',
  'סמן על הגרף', 'סמנו על הגרף', 'סמן בגרף',
];

const TEACH_TYPES = new Set(['text_teach', 'text_teach_error']);

// שולף קטעי מתמטיקה מתוך טקסט: \( ... \) ו-\[ ... \]
function extractMath(str) {
  const out = [];
  if (typeof str !== 'string') return out;
  const re = /\\\((.+?)\\\)|\\\[(.+?)\\\]/gs;
  let m;
  while ((m = re.exec(str)) !== null) {
    out.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return out;
}

function checkTex(tex, where, issues) {
  try {
    katex.renderToString(tex, { throwOnError: true, strict: false });
  } catch (e) {
    issues.push({ level: 'error', message: `שגיאת KaTeX ב${where}: "${tex}" — ${e.message}` });
  }
}

// בודק שדה טקסט שעשוי להכיל מתמטיקה מוטבעת (\(...\)).
function checkInlineText(str, where, issues) {
  for (const tex of extractMath(str)) checkTex(tex, where, issues);
}

function checkForbidden(str, where, issues) {
  if (typeof str !== 'string') return;
  for (const word of FORBIDDEN) {
    if (str.includes(word)) {
      issues.push({ level: 'error', message: `מילת איסור בשאלת הוראה (${where}): "${word}"` });
    }
  }
}

function validateChapter(ch) {
  const issues = [];
  if (!ch || typeof ch !== 'object') {
    return { ok: false, issues: [{ level: 'error', message: 'הפרק אינו אובייקט תקין' }] };
  }
  // שדות חובה
  for (const field of ['chapter_id', 'subject', 'items']) {
    if (!ch[field]) issues.push({ level: 'error', message: `חסר שדה חובה: ${field}` });
  }
  if (!Array.isArray(ch.items)) {
    return { ok: false, issues: issues.concat([{ level: 'error', message: 'items חייב להיות מערך' }]) };
  }

  // מקור מוצג
  if (ch.source) {
    if (ch.source.tex) checkTex(ch.source.tex, 'מקור (source.tex)', issues);
    if (ch.source.text) checkInlineText(ch.source.text, 'מקור (source.text)', issues);
    if (ch.source.note) checkInlineText(ch.source.note, 'מקור (source.note)', issues);
  }

  // קטע פענוח קצר מדי → חשד שאינו מגדיר מונחים (אזהרה בלבד)
  if (ch.archetype === 'decode') {
    const srcText = (ch.source && (ch.source.text || ch.source.tex)) || '';
    if (srcText.length < 60) {
      issues.push({ level: 'warn', message: 'קטע פענוח קצר מאוד — ודא שכל מונח מקצועי מוגדר בתוך הקטע.' });
    }
  }

  const teachTypes = [];
  for (const it of ch.items) {
    const where = `פריט ${it.id || '?'}`;
    checkInlineText(it.stem, `${where} (stem)`, issues);
    checkInlineText(it.prompt, `${where} (prompt)`, issues);

    // שאלת הוראה — מילולית בלבד
    if (TEACH_TYPES.has(it.type)) {
      teachTypes.push(it);
      checkForbidden(it.prompt, where, issues);
      checkForbidden(it.stem, where, issues);
      if (it.answer_mode !== 'text_explanation') {
        issues.push({ level: 'error', message: `${where}: שאלת הוראה חייבת answer_mode: "text_explanation"` });
      }
    }

    // רב-ברירה — בדיוק תשובה נכונה אחת + תקינות KaTeX באפשרויות
    if (Array.isArray(it.options)) {
      let correctCount = 0;
      for (const o of it.options) {
        if (o.tex) checkTex(o.tex, `${where} אפשרות ${o.id}`, issues);
        if (o.text) checkInlineText(o.text, `${where} אפשרות ${o.id}`, issues);
        if (o.correct) correctCount++;
      }
      if ((it.type === 'mc_apply' || it.type === 'mc_error_dialogue') && correctCount !== 1) {
        issues.push({ level: 'error', message: `${where}: נדרשת בדיוק תשובה נכונה אחת (נמצאו ${correctCount})` });
      }
    }
    if (it.dialogue) {
      for (const d of it.dialogue) checkInlineText(d.line, `${where} דיאלוג`, issues);
    }
  }

  // ודא שיש לפחות פריט הוראה אחד ואחד יישום (תבנית הזוגות)
  if (!ch.items.some((i) => i.type === 'mc_apply' || i.type === 'mc_error_dialogue')) {
    issues.push({ level: 'warn', message: 'אין אף שאלת יישום/רב-ברירה בפרק.' });
  }
  if (teachTypes.length === 0) {
    issues.push({ level: 'warn', message: 'אין אף שאלת הוראה בפרק.' });
  }

  const ok = !issues.some((i) => i.level === 'error');
  return { ok, issues };
}

// ---- הרצה ידנית מהטרמינל: סריקת כל הבנק ----
if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'content');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  let errors = 0, warns = 0;
  console.log(`\nבודק ${files.length} פרקים בתיקיית content/\n${'='.repeat(50)}`);
  for (const file of files) {
    let ch;
    try {
      ch = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (e) {
      console.log(`\n✗ ${file}\n   שגיאת JSON: ${e.message}`);
      errors++;
      continue;
    }
    const { ok, issues } = validateChapter(ch);
    const mark = ok ? '✓' : '✗';
    if (issues.length === 0) {
      console.log(`${mark} ${file}  —  תקין`);
    } else {
      console.log(`${mark} ${file}`);
      for (const iss of issues) {
        console.log(`   [${iss.level === 'error' ? 'שגיאה' : 'אזהרה'}] ${iss.message}`);
        if (iss.level === 'error') errors++; else warns++;
      }
    }
  }
  console.log(`${'='.repeat(50)}\nסה"כ: ${errors} שגיאות, ${warns} אזהרות.`);
  console.log(errors ? 'יש פרקים שלא יעלו לאוויר עד לתיקון.\n' : 'כל הפרקים תקינים ומוכנים.\n');
  process.exit(errors ? 1 : 0);
}

module.exports = { validateChapter, FORBIDDEN };
