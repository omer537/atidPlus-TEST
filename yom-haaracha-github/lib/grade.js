'use strict';
/* =========================================================================
   בדיקת AI (אחרי האירוע, לא בזמן אמת).
   קורא את התשובות (מקובץ ייצוא או ישירות מבסיס הנתונים), נותן ציון לכל שאלה,
   מחשב ציון למקצוע, ציון מרוכב 0–100, דירוג ואחוזון, והמלצה מילולית.

   הרצה:
     node lib/grade.js                      → קורא מ-DB, מצב הדגמה אם אין מפתח
     node lib/grade.js exported.json        → קורא מקובץ ייצוא
     node lib/grade.js --out reports        → תיקיית פלט (ברירת מחדל: exports)

   מפתח Claude API (למצב אמיתי): הגדר משתנה סביבה ANTHROPIC_API_KEY,
   או צור קובץ config.local.json עם { "apiKey": "sk-ant-...", "model": "claude-sonnet-5" }.
   ========================================================================= */
const fs = require('fs');
const path = require('path');
const content = require('./content');

// ---------- הגדרות ----------
function loadConfig() {
  let cfg = {};
  const local = path.join(__dirname, '..', 'config.local.json');
  if (fs.existsSync(local)) {
    try { cfg = JSON.parse(fs.readFileSync(local, 'utf8')); } catch (e) {}
  }
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || cfg.apiKey || null;
  const model = process.env.CLAUDE_MODEL || cfg.model || 'claude-sonnet-5';
  return { apiKey, model };
}

// ---------- משקלים לציון המרוכב ----------
const ARCHETYPE_WEIGHT = { prior_knowledge: 1.2, decode: 1.0, robotics: 0.9 };
const MATH_LEVEL_FACTOR = { '5': 1.5, '4': 1.2, '3': 1.0 };

function chapterWeight(chapter) {
  if (!chapter) return 1.0;
  let w = ARCHETYPE_WEIGHT[chapter.archetype] || 1.0;
  if (chapter.subject === 'מתמטיקה' && chapter.level) w *= (MATH_LEVEL_FACTOR[chapter.level] || 1.0);
  return w;
}

// ---------- בדיקת שאלת רב-ברירה ----------
function gradeMC(chapterId, itemId, answer) {
  const ok = content.isCorrectChoice(chapterId, itemId, answer);
  return { score100: ok ? 100 : 0, correct: !!ok };
}

// ---------- בדיקת שאלת הוראה (טקסט) ----------
const RUBRIC_LABEL = {
  correctness: 'נכונות',
  clarity: 'בהירות ההסבר',
  fit_to_student: 'התאמה לרמת התלמיד',
  identifies_error: 'זיהוי הטעות',
};

function demoGradeTeach(item, answer) {
  // ציון הדגמה דטרמיניסטי לפי אורך ומהות התשובה (ללא אקראיות) — רק כדי להראות את המבנה.
  const text = String(answer || '').trim();
  const len = text.length;
  const base = len === 0 ? 1 : Math.max(1, Math.min(5, 2 + Math.floor(len / 120)));
  const rubric = item.rubric || ['correctness', 'clarity', 'fit_to_student'];
  const scores = {};
  rubric.forEach(function (r, i) { scores[r] = Math.max(1, Math.min(5, base - (i % 2))); });
  const avg = Object.values(scores).reduce((a, b) => a + b, 0) / rubric.length;
  return {
    demo: true,
    scores: scores,
    score100: Math.round((avg / 5) * 100),
    feedback: len === 0 ? 'לא נכתבה תשובה.' : 'ציון הדגמה (ללא מפתח API): מבוסס על אורך ומבנה התשובה בלבד. עם מפתח Claude API תתקבל בדיקה אמיתית של התוכן.',
  };
}

async function realGradeTeach(cfg, chapter, item, answer) {
  const rubric = item.rubric || ['correctness', 'clarity', 'fit_to_student'];
  const sourceText = chapter && chapter.source ? (chapter.source.text || chapter.source.tex || '') : '';
  const sys = 'אתה בודק/ת מומחה/ית ביום הערכה למורים לעתיד. מטרת ההערכה: יכולת הנבחן ללמד חומר לתלמיד. ' +
    'קרא/י את שאלת ההוראה ואת תשובת הנבחן, ותן/י ציון 1–5 לכל קריטריון במחוון. החזר/י JSON בלבד.';
  const criteria = rubric.map((r) => '"' + r + '" (' + (RUBRIC_LABEL[r] || r) + ')').join(', ');
  const user =
    'מקצוע: ' + chapter.subject + '\n' +
    (sourceText ? 'קטע מוצג: ' + sourceText + '\n' : '') +
    'שאלת ההוראה: ' + (item.prompt || item.stem || '') + '\n' +
    'תשובת הנבחן: """' + String(answer || '') + '"""\n\n' +
    'דרג/י את הקריטריונים הבאים בסולם 1–5: ' + criteria + '. ' +
    'החזר/י אך ורק JSON בצורה: {"scores": {"<קריטריון>": <1-5>, ...}, "feedback": "<משפט קצר בעברית>"}';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 512,
      system: sys,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('Claude API ' + res.status + ': ' + t.slice(0, 200));
  }
  const data = await res.json();
  const textOut = (data.content || []).map((c) => c.text || '').join('');
  let parsed;
  try {
    const m = textOut.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : textOut);
  } catch (e) {
    return { demo: false, scores: {}, score100: 0, feedback: 'לא ניתן היה לפענח את תשובת המודל: ' + textOut.slice(0, 120) };
  }
  const scores = parsed.scores || {};
  const vals = Object.values(scores).map(Number).filter((n) => !isNaN(n));
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  return { demo: false, scores: scores, score100: Math.round((avg / 5) * 100), feedback: parsed.feedback || '' };
}

// ---------- קריאת נתונים ----------
function loadFromExport(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return raw.examinees || [];
}
function loadFromDB() {
  const { db } = require('../db');
  const crypto = require('crypto');
  const examinees = db.prepare('SELECT * FROM examinees ORDER BY created_at').all();
  return examinees.map((ex) => {
    const slots = db.prepare('SELECT * FROM slots WHERE code = ? ORDER BY round').all(ex.code);
    const answers = db.prepare('SELECT * FROM answers WHERE code = ? ORDER BY round, item_id').all(ex.code);
    return {
      examinee: ex.name,
      code_ref: crypto.createHash('sha256').update(ex.code).digest('hex').slice(0, 10),
      subjects: JSON.parse(ex.subjects || '[]'),
      math_level: ex.math_level,
      slots: slots.map((s) => ({ round: s.round, kind: s.kind, subject: s.subject, level: s.level, chapter_id: s.chapter_id })),
      answers: answers.map((a) => ({ round: a.round, chapter_id: a.chapter_id, item_id: a.item_id, type: a.type, answer: a.answer })),
    };
  });
}

// ---------- מיפוי מיומנות באנגלית ----------
function englishSkill(item) {
  if (!item) return null;
  if (item.type === 'text_teach_error' || item.type === 'mc_error_dialogue') return 'זיהוי ותיקון טעות';
  if (item.type === 'text_teach') return 'הסבר לתלמיד';
  return 'הבנת החוק';
}

// ---------- ציון לנבחן ----------
async function gradeExaminee(cfg, ex) {
  const chapterScores = {};   // chapter_id -> { subject, level, weight, items:[], score100 }
  const englishSkills = {};   // skill -> [score100]

  for (const ans of ex.answers) {
    const chapter = content.getChapter(ans.chapter_id);
    const item = chapter && (chapter.items || []).find((i) => i.id === ans.item_id);
    let result;
    if (ans.type === 'mc_apply' || ans.type === 'mc_error_dialogue') {
      result = gradeMC(ans.chapter_id, ans.item_id, ans.answer);
    } else if (item) {
      result = cfg.apiKey ? await realGradeTeach(cfg, chapter, item, ans.answer) : demoGradeTeach(item, ans.answer);
    } else {
      result = { score100: 0, feedback: 'פריט לא נמצא בבנק.' };
    }

    if (!chapterScores[ans.chapter_id]) {
      chapterScores[ans.chapter_id] = {
        subject: chapter ? chapter.subject : (ans.chapter_id || 'לא ידוע'),
        level: chapter ? chapter.level : null,
        weight: chapterWeight(chapter),
        items: [],
      };
    }
    chapterScores[ans.chapter_id].items.push({ item_id: ans.item_id, type: ans.type, score100: result.score100, feedback: result.feedback, scores: result.scores, demo: result.demo });

    if (chapter && chapter.subject === 'אנגלית') {
      const skill = englishSkill(item);
      if (skill) { (englishSkills[skill] = englishSkills[skill] || []).push(result.score100); }
    }
  }

  // ציון לכל פרק = ממוצע הפריטים
  const subjectScores = {};
  let weightedSum = 0, weightTotal = 0;
  for (const chId of Object.keys(chapterScores)) {
    const c = chapterScores[chId];
    const avg = c.items.length ? c.items.reduce((a, b) => a + b.score100, 0) / c.items.length : 0;
    c.score100 = Math.round(avg);
    subjectScores[c.subject] = c.score100;
    weightedSum += c.score100 * c.weight;
    weightTotal += c.weight;
  }
  const composite = weightTotal ? Math.round(weightedSum / weightTotal) : 0;

  const englishSubScores = {};
  for (const s of Object.keys(englishSkills)) {
    const arr = englishSkills[s];
    englishSubScores[s] = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  }

  return {
    examinee: ex.examinee,
    code_ref: ex.code_ref,
    subjects: ex.subjects,
    math_level: ex.math_level,
    chapter_scores: chapterScores,
    subject_scores: subjectScores,
    english_sub_scores: Object.keys(englishSubScores).length ? englishSubScores : undefined,
    composite: composite,
  };
}

// ---------- המלצה מילולית (דטרמיניסטית, עובדת גם בהדגמה) ----------
function buildRecommendation(r) {
  const entries = Object.entries(r.subject_scores).sort((a, b) => b[1] - a[1]);
  const strengths = entries.filter(([, v]) => v >= 75).map(([k]) => k);
  const weaknesses = entries.filter(([, v]) => v < 55).map(([k]) => k);
  let text = '';
  if (strengths.length) text += 'חוזקות: ' + strengths.join(', ') + '. ';
  if (weaknesses.length) text += 'לחיזוק: ' + weaknesses.join(', ') + '. ';
  // דפוס מתמטיקה 5 חלש
  const mathCh = Object.values(r.chapter_scores).find((c) => c.subject === 'מתמטיקה');
  if (mathCh && mathCh.level === '5' && mathCh.score100 < 60) {
    text += 'ביצועים חלשים ב-5 יח"ל — ייתכן שמתאים ללמד ברמת 4 יח"ל, או שאינו מתאים ללמד מקצוע זה. ';
  }
  if (!text) text = 'ביצועים תקינים על פני המקצועות שנבחרו.';
  return text.trim();
}

// ---------- ריצה ראשית ----------
async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(__dirname, '..', 'exports');
  const inputFile = args.find((a) => a.endsWith('.json') && a !== outDir);
  const cfg = loadConfig();

  console.log('\n===== בדיקת AI — יום הערכה =====');
  console.log(cfg.apiKey ? `מצב: אמיתי (מודל ${cfg.model})` : 'מצב: הדגמה (לא הוגדר מפתח API — ציוני ההוראה הם הדגמה בלבד)');

  const examinees = inputFile ? loadFromExport(inputFile) : loadFromDB();
  console.log(`נבחנים לבדיקה: ${examinees.length}\n`);
  if (examinees.length === 0) { console.log('אין נתונים לבדיקה.'); return; }

  const results = [];
  for (const ex of examinees) {
    process.stdout.write(`בודק: ${ex.examinee} ... `);
    const r = await gradeExaminee(cfg, ex);
    results.push(r);
    console.log(`ציון מרוכב ${r.composite}`);
  }

  // דירוג ואחוזון בתוך הקבוצה
  const sorted = [...results].sort((a, b) => b.composite - a.composite);
  sorted.forEach((r, i) => {
    r.rank = i + 1;
    r.percentile = Math.round(((results.length - i) / results.length) * 100);
    r.recommendation = buildRecommendation(r);
  });

  // כתיבת פלט
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'report-all.json'), JSON.stringify({ graded_at: new Date().toISOString(), demo: !cfg.apiKey, results: sorted }, null, 2), 'utf8');
  for (const r of sorted) {
    const safe = (r.code_ref || r.examinee).replace(/[^\w֐-׿-]/g, '_');
    fs.writeFileSync(path.join(outDir, `report-${safe}.json`), JSON.stringify(r, null, 2), 'utf8');
  }

  console.log(`\nהדוחות נכתבו לתיקייה: ${outDir}`);
  console.log('  report-all.json — כל הנבחנים (מדורג)');
  console.log('  report-<קוד>.json — דוח לכל נבחן\n');

  console.log('טבלת דירוג:');
  sorted.forEach((r) => console.log(`  #${r.rank}  ${r.examinee} — ${r.composite} (אחוזון ${r.percentile})`));
  console.log('');
}

if (require.main === module) {
  main().catch((e) => { console.error('\nשגיאה:', e.message); process.exit(1); });
}

module.exports = { gradeExaminee, chapterWeight, loadConfig };
