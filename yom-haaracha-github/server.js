'use strict';
/*
 * שרת יום ההערכה.
 * ארכיטקטורה פשוטה ואמינה: Express + node:sqlite (קובץ יחיד).
 * הטיימר מנוהל בשרת (server-authoritative) — שורד ריענון/יציאה/סגירת דפדפן.
 * כל תשובה נשמרת מיד ל-DB (שמירה אוטומטית).
 */
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const XLSX = require('xlsx');
const { db, DB_PATH } = require('./db');
const content = require('./lib/content');
const schedule = require('./lib/schedule');

const app = express();
const PORT = process.env.PORT || 3000;
const EXAMINER_PASSWORD = process.env.EXAMINER_PASSWORD || 'admin';
const SLOT_DURATION_SEC = Number(process.env.SLOT_DURATION_SEC || 1200); // 20:00

app.use(express.json({ limit: '1mb' }));

// ---------- כלי עזר ----------
const now = () => Date.now();
const examinerTokens = new Set();

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

// זיהוי אנונימי של הקוד (לא חושף את הקוד עצמו בקובץ הבדיקה)
function codeRef(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex').slice(0, 10);
}

const getExamineeByToken = db.prepare('SELECT * FROM examinees WHERE token = ?');
const getExamineeByCode = db.prepare('SELECT * FROM examinees WHERE code = ?');

function authExaminee(req, res, next) {
  const token = (req.headers['x-token'] || '').trim();
  const ex = token && getExamineeByToken.get(token);
  if (!ex) return res.status(401).json({ error: 'לא מחובר. יש להתחבר מחדש עם שם וקוד.' });
  req.examinee = ex;
  next();
}

function authExaminer(req, res, next) {
  const token = (req.headers['x-token'] || '').trim();
  if (!examinerTokens.has(token)) return res.status(401).json({ error: 'גישת בוחן נדחתה.' });
  next();
}

function logEvent(code, type, detail) {
  db.prepare('INSERT INTO events (code, type, detail, at) VALUES (?, ?, ?, ?)')
    .run(code || null, type, detail ? String(detail).slice(0, 500) : null, now());
}

function getConfig(key) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : null;
}
function setConfig(key, value) {
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

// ---------- מצב סבבים (מודל חי) ----------
function roundState(r) {
  const row = db.prepare('SELECT state FROM rounds WHERE round = ?').get(r);
  return row ? row.state : 'planned';
}
// הסבב שרץ כרגע (0 אם אין)
function currentRunningRound() {
  const row = db.prepare("SELECT MAX(round) AS r FROM rounds WHERE state = 'running'").get();
  return row && row.r ? row.r : 0;
}
// הסבב הגבוה ביותר שכבר התחיל (running/ended)
function latestActiveRound() {
  const row = db.prepare("SELECT MAX(round) AS r FROM rounds WHERE state != 'planned'").get();
  return row && row.r ? row.r : 0;
}

// ---------- התקדמות פר-נבחן (נגזרת מ-slots + interview_marks) ----------
function servedChapterIds(code, exceptRound) {
  const rows = exceptRound
    ? db.prepare("SELECT DISTINCT chapter_id FROM slots WHERE code = ? AND kind = 'chapter' AND round != ?").all(code, exceptRound)
    : db.prepare("SELECT DISTINCT chapter_id FROM slots WHERE code = ? AND kind = 'chapter'").all(code);
  return new Set(rows.map((r) => r.chapter_id));
}
function doneChapterIds(code) {
  return new Set(db.prepare("SELECT DISTINCT chapter_id FROM slots WHERE code = ? AND kind = 'chapter' AND status = 'done'").all(code).map((r) => r.chapter_id));
}
function hasInterviewed(code) {
  return !!db.prepare("SELECT 1 FROM slots WHERE code = ? AND kind = 'interview' AND status = 'done' LIMIT 1").get(code);
}
function isMarkedInterview(round, code) {
  return !!db.prepare('SELECT 1 FROM interview_marks WHERE round = ? AND code = ?').get(round, code);
}
function chapterListForEx(ex) {
  return schedule.chapterListFor(JSON.parse(ex.subjects || '[]'), ex.math_level);
}

// מה נבחן עושה בסבב נתון (מחושב בעת התחלת הסבב). מחזיר תיאור משבצת או null (idle).
function resolveActivity(ex, round) {
  if (isMarkedInterview(round, ex.code) && !hasInterviewed(ex.code)) {
    return { kind: 'interview', subject: null, level: null, chapter_id: null };
  }
  const list = chapterListForEx(ex);
  const next = schedule.nextChapter(servedChapterIds(ex.code, round), list);
  if (next) return { kind: 'chapter', subject: next.subject, level: next.level, chapter_id: next.chapter_id };
  return null; // אין פרק נותר — idle (צריך ריאיון או שסיים)
}

// חישוב מצב טיימר עבור משבצת
function computeTimer(slot) {
  if (!slot || slot.kind !== 'chapter') {
    return { state: 'none', remaining_sec: 0, duration_sec: 0 };
  }
  if (!slot.started_at || slot.status === 'pending') {
    return { state: 'not_started', remaining_sec: slot.duration_sec, duration_sec: slot.duration_sec };
  }
  const t = now();
  let pausedSec = slot.paused_accum_sec;
  if (slot.paused && slot.paused_at) pausedSec += Math.floor((t - slot.paused_at) / 1000);
  const elapsed = Math.floor((t - slot.started_at) / 1000) - pausedSec;
  const remaining = Math.max(0, slot.duration_sec - elapsed);
  return {
    state: slot.paused ? 'paused' : (remaining <= 0 ? 'expired' : 'running'),
    remaining_sec: remaining,
    duration_sec: slot.duration_sec,
  };
}

function getSlot(code, round) {
  return db.prepare('SELECT * FROM slots WHERE code = ? AND round = ?').get(code, round);
}

// מפעיל את הטיימר של משבצת פרק ברגע שהנבחן נכנס אליה בפעם הראשונה.
function ensureSlotStarted(code, round) {
  const slot = getSlot(code, round);
  if (!slot || slot.kind !== 'chapter') return slot;
  if (slot.status === 'pending' && !slot.started_at) {
    db.prepare('UPDATE slots SET started_at = ?, status = ? WHERE code = ? AND round = ?')
      .run(now(), 'active', code, round);
    return getSlot(code, round);
  }
  return slot;
}

// ---------- בניית מצב מלא לנבחן (לשחזור מדויק) ----------
function buildExamineeState(ex) {
  const running = currentRunningRound();
  const totalRounds = schedule.NUM_ROUNDS;
  const state = {
    examinee: {
      name: ex.name,
      code: ex.code,
      subjects: JSON.parse(ex.subjects || '[]'),
      math_level: ex.math_level,
    },
    rounds: { current: running, total: totalRounds },
    server_now: now(),
  };

  // המבחן הסתיים על-ידי הבוחן
  if (getConfig('exam_ended') === '1') {
    state.phase = 'ended';
    state.message = 'המבחן הסתיים. תודה רבה! אפשר לסגור את החלון.';
    return state;
  }

  // נבחן שעדיין לא בחר מקצועות — צריך להשלים הרשמה
  const subjectsArr = JSON.parse(ex.subjects || '[]');
  if (!subjectsArr.length) {
    state.phase = 'needs_setup';
    state.message = 'ברוך הבא! יש להשלים שאלון הצהרה ובחירת נושאים כדי להתחיל.';
    return state;
  }

  // סיים הכול (התראיין + כל הפרקים) — מסך סיום
  const chapterList = chapterListForEx(ex);
  const done = doneChapterIds(ex.code);
  const allChaptersDone = chapterList.length > 0 && chapterList.every((c) => done.has(c.chapter_id));
  if (running === 0 && hasInterviewed(ex.code) && allChaptersDone) {
    state.phase = 'finished';
    state.message = 'סיימת את כל המשבצות — תודה רבה!';
    return state;
  }

  if (running === 0) {
    state.phase = 'waiting';
    state.message = 'ממתינים לתחילת הסבב הבא על-ידי הבוחן.';
    return state;
  }

  let slot = getSlot(ex.code, running);
  if (!slot) {
    // אין משבצת לנבחן בסבב הרץ (הצטרף מאוחר / סיים / ממתין לתורו)
    if (hasInterviewed(ex.code) && allChaptersDone) {
      state.phase = 'finished';
      state.message = 'סיימת את כל המשבצות — תודה רבה!';
    } else {
      state.phase = 'waiting';
      state.message = 'ממתינים לתחילת הסבב הבא.';
    }
    return state;
  }

  if (slot.kind === 'interview') {
    state.phase = 'interview';
    state.slot = { round: slot.round, kind: 'interview' };
    state.message = 'זהו סבב הריאיון שלך — צא/צאי לריאיון. הטיימר מושהה עד לחזרה.';
    return state;
  }

  // הנבחן כבר הגיש את הפרק (או שהבוחן סיים אותו) — ממתין לסבב הבא
  if (slot.status === 'done') {
    state.phase = 'submitted';
    state.slot = { round: slot.round, kind: 'chapter', subject: slot.subject };
    state.message = 'הפרק הוגש. ממתינים לתחילת הסבב הבא על-ידי הבוחן.';
    return state;
  }

  // משבצת פרק — מפעילים טיימר בכניסה ראשונה
  slot = ensureSlotStarted(ex.code, running);
  const chapter = content.getChapter(slot.chapter_id);
  state.phase = 'chapter';
  state.slot = {
    round: slot.round,
    kind: 'chapter',
    subject: slot.subject,
    level: slot.level,
    chapter_id: slot.chapter_id,
    not_comfortable: !!slot.not_comfortable,
  };
  state.chapter = content.sanitizeForExaminee(chapter);
  state.timer = computeTimer(slot);
  // תשובות שכבר נשמרו (לשחזור)
  state.answers = db.prepare(
    'SELECT item_id, type, answer, time_spent_sec FROM answers WHERE code = ? AND chapter_id = ?'
  ).all(ex.code, slot.chapter_id);
  return state;
}

// ============================================================
//  נקודות קצה — נבחן
// ============================================================

// רשימת המקצועות הזמינים (לבחירה ולשאלון ההצהרה)
app.get('/api/subjects', (req, res) => {
  res.json({ subjects: content.listSubjects() });
});

// רישום נבחן חדש (או שחזור אם הקוד כבר קיים עם אותו שם)
app.post('/api/register', (req, res) => {
  const { name, code, declaration, subjects, math_level } = req.body || {};
  if (!name || !code) return res.status(400).json({ error: 'נדרשים שם וקוד אישי.' });
  const cleanName = String(name).trim();
  const cleanCode = String(code).trim();

  const existing = getExamineeByCode.get(cleanCode);
  if (existing) {
    if (existing.name.trim() !== cleanName) {
      return res.status(409).json({ error: 'הקוד הזה כבר בשימוש. בחר/י קוד אחר.' });
    }
    // התחברות חוזרת — מחזירים אסימון חדש ומצב קיים
    const token = newToken();
    db.prepare('UPDATE examinees SET token = ? WHERE code = ?').run(token, cleanCode);
    logEvent(cleanCode, 'login', 'register-existing');
    return res.json({ token, restored: true, state: buildExamineeState(getExamineeByCode.get(cleanCode)) });
  }

  const chosenSubjects = Array.isArray(subjects) ? subjects.filter(Boolean).slice(0, 4) : [];
  if (chosenSubjects.length === 0) return res.status(400).json({ error: 'יש לבחור לפחות מקצוע אחד.' });
  const mathLevel = chosenSubjects.includes('מתמטיקה') ? (math_level || '5') : null;

  const token = newToken();
  db.prepare(`INSERT INTO examinees (code, name, token, declaration, subjects, math_level, interview_round, created_at, status)
              VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'active')`).run(
    cleanCode, cleanName, token,
    JSON.stringify(declaration || null),
    JSON.stringify(chosenSubjects),
    mathLevel, now()
  );
  // אין בניית slots מראש — הן נבנות חי כשהמנהל מתחיל סבב.
  logEvent(cleanCode, 'register', cleanName);
  return res.json({ token, restored: false, state: buildExamineeState(getExamineeByCode.get(cleanCode)) });
});

// השלמת הרשמה לנבחן שנפתח לו משתמש מראש (בחירת מקצועות + הצהרה)
app.post('/api/complete-setup', authExaminee, (req, res) => {
  const { subjects, math_level, declaration } = req.body || {};
  const chosenSubjects = Array.isArray(subjects) ? subjects.filter(Boolean).slice(0, 4) : [];
  if (chosenSubjects.length === 0) return res.status(400).json({ error: 'יש לבחור לפחות מקצוע אחד.' });
  const ex = req.examinee;
  const mathLevel = chosenSubjects.includes('מתמטיקה') ? (math_level || '5') : null;
  db.prepare('UPDATE examinees SET subjects = ?, math_level = ?, declaration = ?, status = ? WHERE code = ?')
    .run(JSON.stringify(chosenSubjects), mathLevel, JSON.stringify(declaration || null), 'active', ex.code);
  // אין בניית slots מראש — נבנות חי בהתחלת סבב.
  logEvent(ex.code, 'complete_setup', ex.name);
  res.json({ ok: true, state: buildExamineeState(getExamineeByCode.get(ex.code)) });
});

// התחברות/שחזור עם שם + קוד
app.post('/api/login', (req, res) => {
  const { name, code } = req.body || {};
  if (!name || !code) return res.status(400).json({ error: 'נדרשים שם וקוד.' });
  const ex = getExamineeByCode.get(String(code).trim());
  if (!ex || ex.name.trim() !== String(name).trim()) {
    return res.status(404).json({ error: 'לא נמצא נבחן עם השם והקוד האלה.' });
  }
  const token = newToken();
  db.prepare('UPDATE examinees SET token = ? WHERE code = ?').run(token, ex.code);
  logEvent(ex.code, 'login', 'restore');
  res.json({ token, state: buildExamineeState(getExamineeByCode.get(ex.code)) });
});

// מצב נוכחי (הלקוח מבצע polling כדי לזהות שחרור סבב ולסנכרן טיימר)
app.get('/api/state', authExaminee, (req, res) => {
  res.json(buildExamineeState(req.examinee));
});

// שמירה אוטומטית של תשובה (idempotent — נקרא תדיר)
app.post('/api/save-answer', authExaminee, (req, res) => {
  const { round, chapter_id, item_id, type, answer, time_spent_sec } = req.body || {};
  if (!chapter_id || !item_id) return res.status(400).json({ error: 'חסר מזהה פרק או פריט.' });
  const t = now();
  const existing = db.prepare('SELECT started_at FROM answers WHERE code = ? AND chapter_id = ? AND item_id = ?')
    .get(req.examinee.code, chapter_id, item_id);
  db.prepare(`INSERT INTO answers (code, round, chapter_id, item_id, type, answer, started_at, updated_at, time_spent_sec)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(code, chapter_id, item_id) DO UPDATE SET
                answer = excluded.answer,
                type = excluded.type,
                updated_at = excluded.updated_at,
                time_spent_sec = excluded.time_spent_sec`).run(
    req.examinee.code, round || 0, chapter_id, item_id, type || null,
    typeof answer === 'string' ? answer : JSON.stringify(answer ?? ''),
    existing ? existing.started_at : t, t, Number(time_spent_sec) || 0
  );
  res.json({ ok: true, saved_at: t });
});

// "החלף שאלה" — וריאנט אחר של אותו פריט (אם קיים בבנק)
app.post('/api/swap-question', authExaminee, (req, res) => {
  const { round } = req.body || {};
  const slot = getSlot(req.examinee.code, round);
  if (!slot || slot.kind !== 'chapter') return res.status(400).json({ error: 'אין פרק פעיל בסבב זה.' });
  const chapter = content.getChapter(slot.chapter_id);
  const variants = (chapter && chapter.variants) || [];
  if (variants.length === 0) {
    return res.json({ swapped: false, message: 'כרגע אין שאלה חלופית זמינה לנושא זה. (וריאנטים יתווספו בסבב הבא.)' });
  }
  const nextIdx = (slot.variant_index + 1) % (variants.length + 1);
  db.prepare('UPDATE slots SET variant_index = ? WHERE code = ? AND round = ?').run(nextIdx, req.examinee.code, round);
  logEvent(req.examinee.code, 'swap', `round ${round}`);
  res.json({ swapped: true, state: buildExamineeState(getExamineeByCode.get(req.examinee.code)) });
});

// "לא בנוח" — מתמטיקה: הורדת רמה בפרק הבא; שאר: החלפת שאלה
app.post('/api/not-comfortable', authExaminee, (req, res) => {
  const { round } = req.body || {};
  const slot = getSlot(req.examinee.code, round);
  if (!slot || slot.kind !== 'chapter') return res.status(400).json({ error: 'אין פרק פעיל בסבב זה.' });
  db.prepare('UPDATE slots SET not_comfortable = 1 WHERE code = ? AND round = ?').run(req.examinee.code, round);
  logEvent(req.examinee.code, 'not_comfortable', `${slot.subject} round ${round}`);

  if (slot.subject === 'מתמטיקה') {
    // מורידים רמה בפרק המתמטיקה הבא (אם קיים)
    const nextMath = db.prepare(
      "SELECT * FROM slots WHERE code = ? AND round > ? AND subject = 'מתמטיקה' AND kind = 'chapter' ORDER BY round ASC LIMIT 1"
    ).get(req.examinee.code, round);
    if (nextMath) {
      const newLevel = schedule.lowerLevel(nextMath.level);
      const ch = content.findChapter('מתמטיקה', newLevel, nextMath.variant_index);
      db.prepare('UPDATE slots SET level = ?, chapter_id = ? WHERE code = ? AND round = ?')
        .run(newLevel, ch ? ch.chapter_id : nextMath.chapter_id, req.examinee.code, nextMath.round);
      return res.json({ ok: true, effect: 'level_down', next_round: nextMath.round, new_level: newLevel });
    }
    return res.json({ ok: true, effect: 'noted', message: 'נרשם. אין פרק מתמטיקה נוסף להורדת רמה.' });
  }
  // שאר המקצועות — ניסיון החלפת שאלה
  const chapter = content.getChapter(slot.chapter_id);
  const variants = (chapter && chapter.variants) || [];
  if (variants.length > 0) {
    const nextIdx = (slot.variant_index + 1) % (variants.length + 1);
    db.prepare('UPDATE slots SET variant_index = ? WHERE code = ? AND round = ?').run(nextIdx, req.examinee.code, round);
    return res.json({ ok: true, effect: 'swap', state: buildExamineeState(getExamineeByCode.get(req.examinee.code)) });
  }
  return res.json({ ok: true, effect: 'noted', message: 'נרשם. שאלה חלופית תתווסף בסבב הבא.' });
});

// הגשת פרק — הנבחן סיים והגיש. המשבצת נסגרת והוא ממתין לסבב הבא.
app.post('/api/submit-slot', authExaminee, (req, res) => {
  const { round } = req.body || {};
  const r = Number(round) || currentRunningRound();
  const slot = getSlot(req.examinee.code, r);
  if (!slot || slot.kind !== 'chapter') return res.status(400).json({ error: 'אין פרק פעיל להגשה.' });
  db.prepare('UPDATE slots SET status = ? WHERE code = ? AND round = ?').run('done', req.examinee.code, r);
  logEvent(req.examinee.code, 'submit', `round ${r}`);
  res.json({ ok: true, state: buildExamineeState(getExamineeByCode.get(req.examinee.code)) });
});

// דיווח אירוע (מעבר טאב / יציאת מיקוד / ניסיון הדבקה) — אנטי-העתקה קל
app.post('/api/event', authExaminee, (req, res) => {
  const { type, detail } = req.body || {};
  if (!type) return res.status(400).json({ error: 'חסר סוג אירוע.' });
  logEvent(req.examinee.code, type, detail);
  res.json({ ok: true });
});

// ============================================================
//  נקודות קצה — בוחן
// ============================================================

app.post('/api/examiner/login', (req, res) => {
  const { password } = req.body || {};
  if (String(password || '') !== EXAMINER_PASSWORD) {
    return res.status(401).json({ error: 'סיסמת בוחן שגויה.' });
  }
  const token = newToken();
  examinerTokens.add(token);
  res.json({ token });
});

app.get('/api/examiner/rounds', authExaminer, (req, res) => {
  res.json({ rounds: db.prepare('SELECT round, code, released, released_at FROM rounds ORDER BY round').all() });
});

app.post('/api/examiner/set-round-code', authExaminer, (req, res) => {
  const { round, code } = req.body || {};
  db.prepare('UPDATE rounds SET code = ? WHERE round = ?').run(String(code || ''), Number(round));
  res.json({ ok: true });
});

// פתיחת משתמש לנבחן מראש (יחיד). אם לא נבחרו מקצועות — הנבחן ישלים בעצמו בכניסה.
app.post('/api/examiner/add-examinee', authExaminer, (req, res) => {
  const { name, code, subjects, math_level, interview_round } = req.body || {};
  if (!name || !code) return res.status(400).json({ error: 'נדרשים שם וקוד.' });
  const cleanName = String(name).trim(), cleanCode = String(code).trim();
  if (getExamineeByCode.get(cleanCode)) return res.status(409).json({ error: 'הקוד כבר קיים: ' + cleanCode });
  const chosen = Array.isArray(subjects) ? subjects.filter(Boolean).slice(0, 4) : [];
  const mathLevel = chosen.includes('מתמטיקה') ? (math_level || '5') : null;
  db.prepare(`INSERT INTO examinees (code, name, token, declaration, subjects, math_level, interview_round, created_at, status)
              VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`).run(
    cleanCode, cleanName, newToken(), JSON.stringify(null), JSON.stringify(chosen), mathLevel, now(),
    chosen.length ? 'active' : 'registered');
  const r = Number(interview_round);
  if (r >= 1 && r <= schedule.NUM_ROUNDS) db.prepare('INSERT OR IGNORE INTO interview_marks (round, code) VALUES (?, ?)').run(r, cleanCode);
  logEvent(cleanCode, 'preregister', cleanName);
  res.json({ ok: true, code: cleanCode, needs_setup: chosen.length === 0 });
});

// פתיחת משתמשים מרשימה. פורמט כל שורה: "שם, קוד" או "שם, קוד, סבב-ריאיון" (סבב אופציונלי 1..5).
// בלי סבב — נשאר לא-משובץ, כדי שהמנהל ישבץ לפי שם בפאנל התכנון.
app.post('/api/examiner/add-examinees-bulk', authExaminer, (req, res) => {
  const text = String((req.body && req.body.text) || '');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let added = 0; const skipped = [];
  for (const line of lines) {
    const parts = line.split(/[,\t;]/).map((s) => s.trim());
    const name = parts[0], code = parts[1];
    const roundRaw = parts[2] !== undefined ? Number(parts[2]) : null;
    const iRound = roundRaw && roundRaw >= 1 && roundRaw <= schedule.NUM_ROUNDS ? roundRaw : null;
    if (!name || !code) { skipped.push(line + ' (חסר שם או קוד)'); continue; }
    if (getExamineeByCode.get(code)) { skipped.push(code + ' (כבר קיים)'); continue; }
    db.prepare(`INSERT INTO examinees (code, name, token, declaration, subjects, math_level, interview_round, created_at, status)
                VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'registered')`).run(
      code, name, newToken(), JSON.stringify(null), JSON.stringify([]), null, now());
    if (iRound) db.prepare('INSERT OR IGNORE INTO interview_marks (round, code) VALUES (?, ?)').run(iRound, code);
    added++;
  }
  logEvent(null, 'bulk_preregister', `נוספו ${added}`);
  res.json({ ok: true, added, skipped });
});

// סימון/ביטול נבחן לריאיון בסבב מסוים (רק כשהסבב עדיין 'planned')
app.post('/api/examiner/mark-interview', authExaminer, (req, res) => {
  const { code, round, on } = req.body || {};
  const r = Number(round);
  if (!r || r < 1 || r > schedule.NUM_ROUNDS) return res.status(400).json({ error: 'מספר סבב לא תקין.' });
  if (roundState(r) !== 'planned') return res.status(400).json({ error: 'אפשר לסמן רק סבב שעדיין לא התחיל.' });
  const ex = getExamineeByCode.get(code);
  if (!ex) return res.status(404).json({ error: 'נבחן לא נמצא.' });
  if (on) {
    if (hasInterviewed(code)) return res.json({ ok: false, warn: 'נבחן זה כבר התראיין — אין צורך לסמן שוב.' });
    db.prepare('INSERT OR IGNORE INTO interview_marks (round, code) VALUES (?, ?)').run(r, code);
    // ריאיון פעם אחת: מסירים סימון מכל סבב planned אחר
    db.prepare("DELETE FROM interview_marks WHERE code = ? AND round != ? AND round IN (SELECT round FROM rounds WHERE state = 'planned')").run(code, r);
  } else {
    db.prepare('DELETE FROM interview_marks WHERE round = ? AND code = ?').run(r, code);
  }
  logEvent(code, 'mark_interview', `round ${r} ${on ? 'on' : 'off'}`);
  res.json({ ok: true });
});

// העלאת לוח תכנון בהדבקה: כל שורה "קוד/שם, סבב" → מסמן ריאיונות מראש
app.post('/api/examiner/set-interview-plan', authExaminer, (req, res) => {
  const lines = String((req.body && req.body.text) || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let marked = 0; const skipped = [];
  for (const line of lines) {
    const parts = line.split(/[,\t;]/).map((s) => s.trim());
    const key = parts[0]; const r = Number(parts[1]);
    if (!key || !(r >= 1 && r <= schedule.NUM_ROUNDS)) { skipped.push(line); continue; }
    const ex = getExamineeByCode.get(key) || db.prepare('SELECT * FROM examinees WHERE name = ?').get(key);
    if (!ex) { skipped.push(line + ' (לא נמצא)'); continue; }
    if (roundState(r) !== 'planned') { skipped.push(line + ' (הסבב כבר התחיל)'); continue; }
    db.prepare('INSERT OR IGNORE INTO interview_marks (round, code) VALUES (?, ?)').run(r, ex.code);
    marked++;
  }
  logEvent(null, 'set_interview_plan', `סומנו ${marked}`);
  res.json({ ok: true, marked, skipped });
});

// הסרת נבחן (שימושי לניקוי נבחני בדיקה)
app.post('/api/examiner/remove-examinee', authExaminer, (req, res) => {
  const { code } = req.body || {};
  if (!getExamineeByCode.get(code)) return res.status(404).json({ error: 'נבחן לא נמצא.' });
  db.prepare('DELETE FROM examinees WHERE code = ?').run(code); // slots + answers נמחקים ב-CASCADE
  logEvent(null, 'remove_examinee', code);
  res.json({ ok: true });
});

// התחלת סבב — בונה חי לכל נבחן פעיל את המשבצת שלו (ריאיון לפי סימון, אחרת הפרק הבא)
app.post('/api/examiner/start-round', authExaminer, (req, res) => {
  const r = Number((req.body || {}).round);
  if (!r || r < 1 || r > schedule.NUM_ROUNDS) return res.status(400).json({ error: 'מספר סבב לא תקין.' });
  if (roundState(r) !== 'planned') return res.status(400).json({ error: 'הסבב כבר התחיל.' });
  if (r > 1 && roundState(r - 1) !== 'ended') return res.status(400).json({ error: `יש לסיים קודם את סבב ${r - 1}.` });
  const running = currentRunningRound();
  if (running) return res.status(400).json({ error: `סבב ${running} עדיין פועל — סיים אותו קודם.` });

  const examinees = db.prepare("SELECT * FROM examinees WHERE status = 'active'").all();
  const insSlot = db.prepare(`INSERT INTO slots (code, round, kind, subject, level, chapter_id, duration_sec)
                              VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(code, round) DO NOTHING`);
  let chapters = 0, interviews = 0;
  for (const ex of examinees) {
    if (JSON.parse(ex.subjects || '[]').length === 0) continue; // עדיין לא בחר מקצועות
    const act = resolveActivity(ex, r);
    if (!act) continue; // idle — אין משבצת
    insSlot.run(ex.code, r, act.kind, act.subject, act.level, act.chapter_id, SLOT_DURATION_SEC);
    if (act.kind === 'interview') interviews++; else chapters++;
  }
  db.prepare("UPDATE rounds SET state = 'running', started_at = ?, released = 1, released_at = ? WHERE round = ?").run(now(), now(), r);
  logEvent(null, 'start_round', `round ${r} · ${interviews} ריאיון · ${chapters} פרק`);
  res.json({ ok: true, round: r, interviews, chapters });
});

// סיום סבב — כל המשבצות נסגרות (done), הסבב עובר ל-ended
app.post('/api/examiner/end-round', authExaminer, (req, res) => {
  const r = Number((req.body || {}).round) || currentRunningRound();
  if (!r || roundState(r) !== 'running') return res.status(400).json({ error: 'אין סבב פעיל לסיום.' });
  makeBackup('pre-end-round');
  db.prepare("UPDATE slots SET status = 'done' WHERE round = ? AND status != 'done'").run(r);
  db.prepare("UPDATE rounds SET state = 'ended' WHERE round = ?").run(r);
  logEvent(null, 'end_round', String(r));
  res.json({ ok: true, round: r });
});

// איפוס סבב — מבטל את הסבב הנוכחי (מוחק את המשבצות שלו) ומחזיר ל-planned. התשובות נשמרות.
app.post('/api/examiner/reset-round', authExaminer, (req, res) => {
  const r = Number((req.body || {}).round);
  if (!r || roundState(r) === 'planned') return res.status(400).json({ error: 'אין מה לאפס בסבב זה.' });
  if (latestActiveRound() !== r) return res.status(400).json({ error: `אפס קודם את סבב ${latestActiveRound()} (המאוחר יותר).` });
  makeBackup('pre-reset-round');
  db.prepare('DELETE FROM slots WHERE round = ?').run(r);
  db.prepare("UPDATE rounds SET state = 'planned', started_at = NULL, released = 0, released_at = NULL WHERE round = ?").run(r);
  logEvent(null, 'reset_round', String(r));
  res.json({ ok: true, round: r });
});

// איפוס המשבצת של כל הנבחנים בסבב הרץ (טיימר מחדש)
app.post('/api/examiner/reset-all-current', authExaminer, (req, res) => {
  const r = currentRunningRound();
  if (!r) return res.status(400).json({ error: 'אין סבב פעיל.' });
  makeBackup('pre-reset-all');
  db.prepare("UPDATE slots SET started_at = NULL, status = 'pending', paused = 0, paused_at = NULL, paused_accum_sec = 0 WHERE round = ?").run(r);
  logEvent(null, 'reset_all_current', String(r));
  res.json({ ok: true, round: r });
});

// איפוס יום מלא — מחזיר את כל הסבבים ל-planned ומוחק את כל המשבצות והתשובות (שומר נבחנים, מקצועות ותכנון)
app.post('/api/examiner/full-reset', authExaminer, (req, res) => {
  makeBackup('pre-full-reset');
  db.prepare('DELETE FROM slots').run();
  db.prepare('DELETE FROM answers').run();
  db.prepare("UPDATE rounds SET state = 'planned', started_at = NULL, released = 0, released_at = NULL").run();
  setConfig('exam_ended', '0');
  logEvent(null, 'full_reset', '');
  res.json({ ok: true });
});

// סטטוס חי של כל הנבחנים + מצב הסבבים + סימוני ריאיון
app.get('/api/examiner/status', authExaminer, (req, res) => {
  const running = currentRunningRound();
  const roundsArr = db.prepare('SELECT round, state, started_at FROM rounds ORDER BY round').all();
  const marks = db.prepare('SELECT round, code FROM interview_marks').all();
  const examinees = db.prepare('SELECT * FROM examinees ORDER BY created_at').all();
  const list = examinees.map((ex) => {
    const subjects = JSON.parse(ex.subjects || '[]');
    const setup = subjects.length > 0;
    const chapterList = setup ? chapterListForEx(ex) : [];
    const done = doneChapterIds(ex.code);
    const interviewed = hasInterviewed(ex.code);
    const slot = running ? getSlot(ex.code, running) : null;
    const timer = slot ? computeTimer(slot) : { state: 'none', remaining_sec: 0 };
    const answered = slot && slot.chapter_id
      ? db.prepare('SELECT COUNT(*) AS c FROM answers WHERE code = ? AND chapter_id = ?').get(ex.code, slot.chapter_id).c : 0;
    const flags = db.prepare("SELECT COUNT(*) AS c FROM events WHERE code = ? AND type IN ('blur','tabhide','paste_blocked')").get(ex.code).c;
    const doneNames = chapterList.filter((c) => done.has(c.chapter_id)).map((c) => c.subject);
    const remaining = chapterList
      .filter((c) => !done.has(c.chapter_id) && (!slot || slot.chapter_id !== c.chapter_id))
      .map((c) => c.subject);
    const current = slot ? {
      round: slot.round, kind: slot.kind, subject: slot.subject, level: slot.level,
      status: slot.status, not_comfortable: !!slot.not_comfortable,
    } : null;
    const finished = setup && interviewed && chapterList.length > 0 && chapterList.every((c) => done.has(c.chapter_id));
    return {
      code: ex.code, name: ex.name, setup, subjects,
      chapters_total: chapterList.length,
      chapters_done: doneNames,
      remaining_chapters: remaining,
      interviewed, needs_interview: setup && !interviewed && !finished, finished,
      current, timer, answered, flags,
      marked_rounds: marks.filter((m) => m.code === ex.code).map((m) => m.round),
    };
  });
  res.json({ running, total_rounds: schedule.NUM_ROUNDS, rounds: roundsArr, examinees: list });
});

// עקיפות ידניות: הוספת זמן / השהיה / המשך / איפוס משבצת
app.post('/api/examiner/override', authExaminer, (req, res) => {
  const { code, round, action, seconds } = req.body || {};
  const r = Number(round) || currentRunningRound();
  const slot = getSlot(code, r);
  if (!slot) return res.status(404).json({ error: 'לא נמצאה משבצת.' });
  const t = now();
  switch (action) {
    case 'add_time':
      db.prepare('UPDATE slots SET duration_sec = duration_sec + ? WHERE code = ? AND round = ?')
        .run(Number(seconds) || 60, code, r);
      break;
    case 'pause':
      if (!slot.paused) db.prepare('UPDATE slots SET paused = 1, paused_at = ? WHERE code = ? AND round = ?').run(t, code, r);
      break;
    case 'resume':
      if (slot.paused) {
        const add = slot.paused_at ? Math.floor((t - slot.paused_at) / 1000) : 0;
        db.prepare('UPDATE slots SET paused = 0, paused_at = NULL, paused_accum_sec = paused_accum_sec + ? WHERE code = ? AND round = ?')
          .run(add, code, r);
      }
      break;
    case 'reset_slot':
      db.prepare('UPDATE slots SET started_at = NULL, status = ?, paused = 0, paused_at = NULL, paused_accum_sec = 0 WHERE code = ? AND round = ?')
        .run('pending', code, r);
      break;
    case 'start':
      db.prepare('UPDATE slots SET started_at = ?, status = ? WHERE code = ? AND round = ?').run(t, 'active', code, r);
      break;
    case 'finish': // סיום מוקדם של המשבצת (לפני הטיימר) — הנבחן עובר להמתנה
      db.prepare('UPDATE slots SET status = ? WHERE code = ? AND round = ?').run('done', code, r);
      break;
    default:
      return res.status(400).json({ error: 'פעולה לא מוכרת.' });
  }
  logEvent(code, 'override', `${action} round ${r}`);
  res.json({ ok: true });
});

// השהיה/המשך של כל הנבחנים בסבב הנוכחי בבת אחת
app.post('/api/examiner/pause-all', authExaminer, (req, res) => {
  const pause = req.body && req.body.pause !== false; // ברירת מחדל: השהה
  const r = currentRunningRound();
  const t = now();
  const slots = db.prepare("SELECT * FROM slots WHERE round = ? AND kind = 'chapter' AND status = 'active'").all(r);
  let n = 0;
  for (const s of slots) {
    if (pause && !s.paused) {
      db.prepare('UPDATE slots SET paused = 1, paused_at = ? WHERE code = ? AND round = ?').run(t, s.code, r);
      n++;
    } else if (!pause && s.paused) {
      const add = s.paused_at ? Math.floor((t - s.paused_at) / 1000) : 0;
      db.prepare('UPDATE slots SET paused = 0, paused_at = NULL, paused_accum_sec = paused_accum_sec + ? WHERE code = ? AND round = ?').run(add, s.code, r);
      n++;
    }
  }
  logEvent(null, pause ? 'pause_all' : 'resume_all', `round ${r} · ${n} נבחנים`);
  res.json({ ok: true, affected: n, paused: pause });
});

// סיום המבחן כולו (לפני הזמן) — כל הנבחנים עוברים למסך "המבחן הסתיים"
app.post('/api/examiner/end-exam', authExaminer, (req, res) => {
  const ended = !(req.body && req.body.ended === false);
  setConfig('exam_ended', ended ? '1' : '0');
  logEvent(null, ended ? 'end_exam' : 'reopen_exam', '');
  res.json({ ok: true, ended });
});

// מצב המבחן (האם הסתיים)
app.get('/api/examiner/exam-state', authExaminer, (req, res) => {
  res.json({ ended: getConfig('exam_ended') === '1' });
});

// בונה מבנה ייצוא מלא (משמש גם לייצוא ידני וגם לגיבוי אוטומטי)
function buildFullExport() {
  const examinees = db.prepare('SELECT * FROM examinees ORDER BY created_at').all();
  const out = examinees.map((ex) => {
    const slots = db.prepare('SELECT * FROM slots WHERE code = ? ORDER BY round').all(ex.code);
    const answers = db.prepare('SELECT * FROM answers WHERE code = ? ORDER BY round, item_id').all(ex.code);
    return {
      examinee: ex.name,
      code: ex.code,
      code_ref: codeRef(ex.code),
      subjects: JSON.parse(ex.subjects || '[]'),
      math_level: ex.math_level,
      interview_round: ex.interview_round,
      declaration: JSON.parse(ex.declaration || 'null'),
      slots: slots.map((s) => ({ round: s.round, kind: s.kind, subject: s.subject, level: s.level, chapter_id: s.chapter_id })),
      answers: answers.map((a) => ({
        round: a.round, chapter_id: a.chapter_id, item_id: a.item_id, type: a.type, answer: a.answer,
        started_at: a.started_at ? new Date(a.started_at).toISOString() : null,
        updated_at: a.updated_at ? new Date(a.updated_at).toISOString() : null,
        time_spent_sec: a.time_spent_sec,
      })),
    };
  });
  return { exported_at: new Date().toISOString(), examinees: out };
}

// ---------- מנגנון גיבוי אוטומטי (פועל גם בשרת, לדיסק הקבוע) ----------
const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'backups');
const BACKUP_INTERVAL_MIN = Number(process.env.BACKUP_INTERVAL_MIN || 5);

function ensureBackupDir() { if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true }); }

function pruneBackups(prefix, keep) {
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith(prefix)).sort();
  while (files.length > keep) { const f = files.shift(); try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (e) {} }
}

function makeBackup(reason) {
  try {
    ensureBackupDir();
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    // (1) גיבוי לוגי קריא (JSON) — עקבי תמיד
    fs.writeFileSync(path.join(BACKUP_DIR, `backup-${ts}.json`), JSON.stringify(buildFullExport()));
    // (2) עותק פיזי של קובץ ה-DB (לשחזור מהיר) — אחרי איחוד ה-WAL
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); fs.copyFileSync(DB_PATH, path.join(BACKUP_DIR, `snapshot-${ts}.db`)); } catch (e) {}
    pruneBackups('backup-', 72);   // ~6 שעות בקצב של 5 דק'
    pruneBackups('snapshot-', 24);
    return { ok: true, ts, reason: reason || 'auto' };
  } catch (e) {
    console.error('גיבוי נכשל:', e.message);
    return { ok: false, error: e.message };
  }
}

// הורדת כל התשובות כקובץ JSON (רשת ביטחון + מקור לבדיקת AI)
app.get('/api/examiner/export-all', authExaminer, (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="assessment-answers.json"');
  res.send(JSON.stringify(buildFullExport(), null, 2));
});

// רשימת הגיבויים הקיימים
app.get('/api/examiner/backups', authExaminer, (req, res) => {
  ensureBackupDir();
  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.json') || f.endsWith('.db'))
    .map((f) => { const st = fs.statSync(path.join(BACKUP_DIR, f)); return { name: f, size: st.size, at: st.mtimeMs }; })
    .sort((a, b) => b.at - a.at);
  res.json({ dir: BACKUP_DIR, interval_min: BACKUP_INTERVAL_MIN, files });
});

// גיבוי ידני מיידי
app.post('/api/examiner/backup-now', authExaminer, (req, res) => res.json(makeBackup('manual')));

// הורדת קובץ גיבוי מסוים
app.get('/api/examiner/backup/:name', authExaminer, (req, res) => {
  const name = path.basename(req.params.name || '');
  const full = path.join(BACKUP_DIR, name);
  if (!full.startsWith(BACKUP_DIR) || !fs.existsSync(full)) return res.status(404).json({ error: 'קובץ גיבוי לא נמצא.' });
  res.download(full);
});

// הורדת כל התשובות כקובץ אקסל (קריא, מוכן לבדיקה ידנית או לשליחה)
app.get('/api/examiner/export-excel', authExaminer, (req, res) => {
  const examinees = db.prepare('SELECT * FROM examinees ORDER BY created_at').all();
  const rows = [];
  for (const ex of examinees) {
    const answers = db.prepare('SELECT * FROM answers WHERE code = ? ORDER BY round, item_id').all(ex.code);
    for (const a of answers) {
      const ch = content.getChapter(a.chapter_id);
      const item = ch && (ch.items || []).find((i) => i.id === a.item_id);
      let questionText = item ? (item.stem || item.prompt || '') : '';
      let answerText = a.answer || '';
      let correct = '';
      if ((a.type === 'mc_apply' || a.type === 'mc_error_dialogue') && item && item.options) {
        const opt = item.options.find((o) => o.id === a.answer);
        answerText = opt ? (opt.text || opt.tex || a.answer) : a.answer;
        correct = opt ? (opt.correct ? 'נכון' : 'לא נכון') : '';
      }
      rows.push({
        'שם': ex.name,
        'קוד': ex.code,
        'סבב': a.round,
        'מקצוע': ch ? ch.subject : '',
        'פרק': a.chapter_id,
        'מזהה שאלה': a.item_id,
        'סוג': a.type,
        'השאלה': questionText,
        'התשובה שנתן/ה': answerText,
        'נכון (רב-ברירה)': correct,
        'זמן (שניות)': a.time_spent_sec || 0,
        'עודכן': a.updated_at ? new Date(a.updated_at).toLocaleString('he-IL') : '',
      });
    }
  }
  const header = ['שם', 'קוד', 'סבב', 'מקצוע', 'פרק', 'מזהה שאלה', 'סוג', 'השאלה', 'התשובה שנתן/ה', 'נכון (רב-ברירה)', 'זמן (שניות)', 'עודכן'];
  const ws = XLSX.utils.json_to_sheet(rows, { header });
  ws['!views'] = [{ RTL: true }];
  ws['!cols'] = [{ wch: 16 }, { wch: 8 }, { wch: 5 }, { wch: 12 }, { wch: 22 }, { wch: 10 }, { wch: 16 }, { wch: 40 }, { wch: 50 }, { wch: 14 }, { wch: 11 }, { wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'תשובות');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="assessment-answers.xlsx"');
  res.send(buf);
});

// דוח תקינות בנק התוכן (שומר הסף) — לצפייה במסך הבוחן
app.get('/api/examiner/content-health', authExaminer, (req, res) => {
  res.json({
    subjects: content.listSubjects(),
    chapters: Array.from(content.byId.values()).map((c) => ({
      chapter_id: c.chapter_id, subject: c.subject, level: c.level, valid: c._valid, issues: c._issues,
    })),
    problems: content.getProblems(),
  });
});

// ============================================================
//  קבצים סטטיים
// ============================================================
app.use('/vendor/katex', express.static(path.join(__dirname, 'node_modules', 'katex', 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/examiner', (req, res) => res.sendFile(path.join(__dirname, 'public', 'examiner.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// בדיקת בריאות (ל-Render)
app.get('/healthz', (req, res) => res.json({ ok: true, subjects: content.listSubjects().length }));

app.listen(PORT, () => {
  const problems = content.getProblems().filter((p) => p.level === 'error');
  console.log(`\n  מערכת יום הערכה פועלת:  http://localhost:${PORT}`);
  console.log(`  מסך המנהל:              כפתור "כניסת מנהל" בפינה, או ${'http://localhost:' + PORT}/examiner`);
  console.log(`  מקצועות זמינים:         ${content.listSubjects().join(', ')}`);
  if (problems.length) console.log(`  ⚠ ${problems.length} בעיות תוכן (הרץ: npm run check-content)`);
  // גיבוי אוטומטי — מיד עם העלייה ואז כל BACKUP_INTERVAL_MIN דקות
  makeBackup('startup');
  setInterval(() => makeBackup('auto'), BACKUP_INTERVAL_MIN * 60 * 1000);
  console.log(`  גיבוי אוטומטי:          כל ${BACKUP_INTERVAL_MIN} דק' → ${BACKUP_DIR}`);
  console.log('');
});
