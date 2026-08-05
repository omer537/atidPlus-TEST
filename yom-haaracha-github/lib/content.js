'use strict';
/*
 * טעינת בנק התוכן.
 * כל פרק הוא קובץ JSON נפרד בתיקיית content/ — עריכת שאלות = עריכת נתונים,
 * בלי לגעת בקוד. בעת הטעינה כל פרק עובר את "שומר הסף" (guardrail);
 * פרק שנפסל אינו עולה לאוויר (מסומן invalid), כדי לאכוף את כללי התוכן הנעולים.
 */
const fs = require('fs');
const path = require('path');
const { validateChapter } = require('./guardrail');

const CONTENT_DIR = path.join(__dirname, '..', 'content');

let byId = new Map();          // chapter_id -> chapter
let bySubject = new Map();      // subject -> [chapter, ...] (רק תקינים)
let problems = [];             // רשימת בעיות שנמצאו בטעינה

function load() {
  byId = new Map();
  bySubject = new Map();
  problems = [];

  if (!fs.existsSync(CONTENT_DIR)) return { byId, bySubject, problems };

  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const full = path.join(CONTENT_DIR, file);
    let chapter;
    try {
      chapter = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (e) {
      problems.push({ file, level: 'error', message: 'קובץ JSON שגוי: ' + e.message });
      continue;
    }
    const result = validateChapter(chapter);
    chapter._file = file;
    chapter._valid = result.ok;
    chapter._issues = result.issues;
    for (const iss of result.issues) {
      problems.push({ file, chapter_id: chapter.chapter_id, ...iss });
    }
    byId.set(chapter.chapter_id, chapter);
    if (result.ok) {
      const subj = chapter.subject;
      if (!bySubject.has(subj)) bySubject.set(subj, []);
      bySubject.get(subj).push(chapter);
    }
  }

  loadArchive();
  return { byId, bySubject, problems };
}

// ---------- ארכיון: פרקים שירדו מהאוויר אבל נענו בימי הערכה שכבר היו ----------
// ⚠ נכנסים ל-byId בלבד — כדי שהבדיקה תדע את נוסח השאלה ואת התשובה הנכונה —
// ואף פעם לא ל-bySubject, כך שלא ייבחרו לנבחן במבחן חדש.
// בלי זה, תשובות של נבחנים אמיתיים לפרקים שנמחקו נזרקות בשקט מהניקוד.
function loadArchive() {
  const dir = path.join(CONTENT_DIR, 'archive');
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    let chapter;
    try {
      chapter = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (e) {
      problems.push({ file: 'archive/' + file, level: 'error', message: 'קובץ ארכיון שגוי: ' + e.message });
      continue;
    }
    if (!chapter.chapter_id || byId.has(chapter.chapter_id)) continue;  // פרק חי גובר על ארכיון
    chapter._file = 'archive/' + file;
    chapter._archived = true;
    chapter._valid = true;      // לא עובר שומר-סף: תפקידו רק לספק נוסח ותשובה נכונה לבדיקה
    chapter._issues = [];
    byId.set(chapter.chapter_id, chapter);
  }
}

load();

function getChapter(id) {
  return byId.get(id) || null;
}

// מקצועות זמינים (רק כאלה שיש להם לפחות פרק תקין אחד)
function listSubjects() {
  return Array.from(bySubject.keys()).sort();
}

// פרק לפי מקצוע ורמה (הרמה רלוונטית למתמטיקה בלבד).
// מחזיר את הפרק המתאים ביותר, ואם אין ברמה המבוקשת — הקרוב ביותר.
function findChapter(subject, level, variantIndex) {
  const list = bySubject.get(subject) || [];
  if (list.length === 0) return null;
  if (subject === 'מתמטיקה' && level) {
    const exact = list.filter((c) => c.level === String(level));
    if (exact.length) return pickVariant(exact, variantIndex);
    // אין ברמה המבוקשת — נבחר את הרמה הקרובה ביותר מלמטה, אחרת כלשהי.
    const sorted = list
      .filter((c) => c.level)
      .sort((a, b) => Number(b.level) - Number(a.level));
    const lower = sorted.find((c) => Number(c.level) <= Number(level));
    return lower || sorted[0] || list[0];
  }
  return pickVariant(list, variantIndex);
}

function pickVariant(list, variantIndex) {
  if (!list.length) return null;
  const idx = ((variantIndex || 0) % list.length + list.length) % list.length;
  return list[idx];
}

// גרסה נקייה לנבחן: בלי הערות מתכנן, בלי סימוני "correct", בלי rubric.
function sanitizeForExaminee(chapter) {
  if (!chapter) return null;
  const clean = {
    chapter_id: chapter.chapter_id,
    subject: chapter.subject,
    level: chapter.level,
    topic: chapter.topic,
    display_title: chapter.display_title,
    source: chapter.source,
    items: (chapter.items || []).map((it) => {
      const item = {
        id: it.id,
        pair: it.pair,
        type: it.type,
        stem: it.stem,
        prompt: it.prompt,
      };
      if (it.dialogue) item.dialogue = it.dialogue;
      if (it.options) {
        item.options = it.options.map((o) => ({
          id: o.id,
          text: o.text,
          tex: o.tex,
        }));
      }
      return item;
    }),
  };
  return clean;
}

// בדיקת נכונות של שאלת רב-ברירה (בצד השרת בלבד).
function isCorrectChoice(chapterId, itemId, optionId) {
  const ch = getChapter(chapterId);
  if (!ch) return null;
  const item = (ch.items || []).find((i) => i.id === itemId);
  if (!item || !item.options) return null;
  const opt = item.options.find((o) => o.id === optionId);
  if (!opt) return false;
  return !!opt.correct;
}

module.exports = {
  load,
  getChapter,
  listSubjects,
  findChapter,
  sanitizeForExaminee,
  isCorrectChoice,
  getProblems: () => problems,
  get byId() { return byId; },
  get bySubject() { return bySubject; },
};
