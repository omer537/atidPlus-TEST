'use strict';
/*
 * שכבת בסיס הנתונים.
 * משתמשים ב-node:sqlite המובנה ב-Node (מגרסה 22.5+, ללא צורך בהתקנה חיצונית).
 * קובץ יחיד בתיקיית data/ — פשוט, אמין, וקל לגיבוי (מעתיקים את הקובץ).
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'assessment.db');
const db = new DatabaseSync(DB_PATH);

// WAL = כתיבה עמידה יותר לקריסות ולכתיבות מקבילות (40 נבחנים ששומרים בו-זמנית).
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS examinees (
  code           TEXT PRIMARY KEY,        -- הקוד האישי (משמש לשחזור)
  name           TEXT NOT NULL,
  token          TEXT NOT NULL,           -- אסימון הפעלה (session)
  declaration    TEXT,                    -- שאלון ההצהרה (JSON)
  subjects       TEXT,                    -- המקצועות שנבחרו (JSON)
  math_level     TEXT,                    -- "5"/"4"/"3" או null
  interview_round INTEGER,                -- (לא בשימוש במודל החי; נשמר לתאימות)
  interviewed    INTEGER NOT NULL DEFAULT 0,  -- האם כבר התראיין (דגל)
  in_interview   INTEGER NOT NULL DEFAULT 0,  -- כרגע בריאיון (טיימר הפרק מושהה)
  created_at     INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'registered'  -- registered | active | left
);

CREATE TABLE IF NOT EXISTS slots (
  code            TEXT NOT NULL,
  round           INTEGER NOT NULL,       -- 1..5
  kind            TEXT NOT NULL,          -- 'chapter' | 'interview'
  subject         TEXT,
  level           TEXT,
  chapter_id      TEXT,
  variant_index   INTEGER DEFAULT 0,      -- איזה וריאנט של הפרק (0 = מקורי)
  started_at      INTEGER,                -- חותמת שרת (ms) לתחילת הטיימר
  duration_sec    INTEGER NOT NULL DEFAULT 1200,   -- 20:00
  paused          INTEGER NOT NULL DEFAULT 0,
  paused_at       INTEGER,
  paused_accum_sec INTEGER NOT NULL DEFAULT 0,
  not_comfortable INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | active | done
  PRIMARY KEY (code, round),
  FOREIGN KEY (code) REFERENCES examinees(code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS answers (
  code          TEXT NOT NULL,
  round         INTEGER NOT NULL,
  chapter_id    TEXT NOT NULL,
  item_id       TEXT NOT NULL,
  type          TEXT,
  answer        TEXT,                     -- טקסט חופשי או מזהה אפשרות נבחרת
  started_at    INTEGER,
  updated_at    INTEGER,
  time_spent_sec INTEGER DEFAULT 0,
  dont_know     INTEGER NOT NULL DEFAULT 0,  -- הנבחן/ת סימן/ה "לא יודע/ת" על הפריט
  PRIMARY KEY (code, chapter_id, item_id),
  FOREIGN KEY (code) REFERENCES examinees(code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rounds (
  round        INTEGER PRIMARY KEY,       -- 1..5
  code         TEXT,                      -- קוד הסבב (סיסמה) שהבוחן מכריז
  released     INTEGER NOT NULL DEFAULT 0,
  released_at  INTEGER,
  state        TEXT NOT NULL DEFAULT 'planned',  -- planned | running | ended
  started_at   INTEGER
);

-- מי מסומן לריאיון בכל סבב (המנהל קובע, מראש או חי)
CREATE TABLE IF NOT EXISTS interview_marks (
  round  INTEGER NOT NULL,
  code   TEXT NOT NULL,
  PRIMARY KEY (round, code),
  FOREIGN KEY (code) REFERENCES examinees(code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  code   TEXT,
  type   TEXT NOT NULL,                   -- blur | tabhide | paste_blocked | login | ...
  detail TEXT,
  at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`);

// מיגרציה עדינה לבסיסי נתונים קיימים (בשרת) — הוספת עמודות חדשות אם חסרות.
for (const alter of [
  "ALTER TABLE rounds ADD COLUMN state TEXT NOT NULL DEFAULT 'planned'",
  'ALTER TABLE rounds ADD COLUMN started_at INTEGER',
  'ALTER TABLE examinees ADD COLUMN interviewed INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE examinees ADD COLUMN in_interview INTEGER NOT NULL DEFAULT 0',
  // «קוד אישי» חופשי שהנבחן בוחר (לא ייחודי). המזהה הפנימי הקבוע נשאר בעמודת code.
  'ALTER TABLE examinees ADD COLUMN pin TEXT',
  // סימון "לא יודע/ת" פר-פריט (כפתור חדש במסך הנבחן).
  'ALTER TABLE answers ADD COLUMN dont_know INTEGER NOT NULL DEFAULT 0',
]) {
  try { db.exec(alter); } catch (e) { /* העמודה כבר קיימת */ }
}
// מילוי אחורה: לנבחנים ישנים ה«קוד האישי» הוא הקוד שאיתו נרשמו (המזהה הפנימי).
try { db.exec("UPDATE examinees SET pin = code WHERE pin IS NULL OR pin = ''"); } catch (e) {}

// אתחול 5 סבבים אם עדיין לא קיימים, עם קודי ברירת מחדל שהבוחן יכול לשנות.
const roundCount = db.prepare('SELECT COUNT(*) AS c FROM rounds').get().c;
if (roundCount === 0) {
  const insRound = db.prepare('INSERT INTO rounds (round, code, released) VALUES (?, ?, 0)');
  for (let r = 1; r <= 5; r++) insRound.run(r, 'round' + r);
}

module.exports = { db, DB_PATH };
