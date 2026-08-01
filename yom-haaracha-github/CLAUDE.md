# פרויקט «יום הערכה» — הקשר לכל שיחה

מערכת ווב בעברית (RTL) לניהול יום הערכה למלגאים: ~40–50 נבחנים במקביל, כל אחד **4 פרקי מבחן + ריאיון אחד** פרוסים על **5 סבבים**. **4 הפרקים = 3 מקצועות שהנבחן בוחר + פרק «מידע כללי» חובה** (פענוח חומר חדש והסברתו לתלמיד — `GENERAL_SUBJECT` ב-`lib/schedule.js`). המקור המחייב: `בריף-בנייה-קלוד-קוד.md` (בתיקיית ההורה `~/Desktop/מבחנים ליום הערכה/`). **המשתמש אינו מתכנת — להסביר בעברית פשוטה.**

## איך מריצים
- התיקייה: `~/Desktop/מבחנים ליום הערכה/app`. סטאק: **Node + Express + `node:sqlite` מובנה** (בלי DB חיצוני), פרונט vanilla JS (בלי build).
- הרצה: דאבל-קליק על `הפעל שרת.command` (עוצר שרת קודם ואז `npm start`), או `node server.js`. פורט **3000**.
- מסך נבחן: `http://localhost:3000`. מסך מנהל: כפתור "כניסת מנהל" בפינה או `/examiner` (סיסמה: env `EXAMINER_PASSWORD`, ברירת מחדל `admin`).
- רשת מקומית: נבחנים מתחברים ל-`http://<IP-של-המחשב>:3000` (אותו Wi-Fi) — פתרון מומלץ ליום במקום אחד.
- Node 24+ נדרש ל-`node:sqlite` בלי flag (`.node-version=24`, `engines>=24`).

## ארכיטקטורה (app/)
- `server.js` — כל הלוגיקה וה-API. `db.js` — סכימה + מיגרציות (ALTER בtry/catch). `lib/schedule.js` (chapterListFor/nextChapter/pickInterviewRound), `lib/content.js` (טעינת בנק), `lib/guardrail.js` (שומר סף + `npm run check-content`), `lib/grade.js` (בדיקת AI).
- `content/*.json` — 8 פרקי זרעים (מתמטיקה5, אנגלית, לשון, היסטוריה, רובוטיקה, מדעים-חטיבה, פיזיקה, ביולוגיה). `public/` — index.html (נבחן), examiner.html, css/style.css, js/{app.js, examiner.js, render.js}, img/logo.svg. KaTeX מוגש מ-`node_modules/katex/dist` ב-`/vendor/katex` (לא CDN).
- `scripts/rehearsal.js` (`npm run rehearsal`, env `N=`, `BASE=`), `scripts/build_guide.py` (בונה `public/guide.pdf` מ-README; דורש venv עם reportlab+python-bidi).

## המנוע — «מודל סבב חי» (הליבה, אל תחזור למודל הקבוע!)
- לכל סבב 1..5 יש `rounds.state ∈ {planned, running, ended}`. סבב אחד רץ בכל רגע; מתקדמים 1→5.
- **הריאיונות נקבעים ידנית, הפרקים אוטומטית** (החלטת המשתמש). טבלה `interview_marks(round, code)` = מי בריאיון בכל סבב.
- **התחל סבב** (`/api/examiner/start-round`): לכל נבחן `active` נבנית שורת `slots(code,round)` חיה דרך `resolveActivity(ex,round)` — אם מסומן לריאיון ולא התראיין→interview, אחרת→`nextChapter` (הפרק הבא שטרם עשה מרשימת `chapterListForEx`), אחרת idle (בלי slot). **אין בניית slots מראש** ברישום.
- **סיים סבב** (`end-round`): interview→`examinees.interviewed=1`; כל השורות→`done`; state=ended. **אפס סבב** (`reset-round`, רק לסבב הפעיל/אחרון): מוחק slots של הסבב, מבטל interviewed למי שהריאיון היה בו, state=planned (תשובות נשמרות). גיבוי אוטומטי לפני כל פעולה הרסנית (`makeBackup`).
- דגלי מפתח על `examinees`: `interviewed` (דגל, לא נגזר מ-slots!), `in_interview` (כרגע בריאיון → הטיימר מושהה), `status ∈ {registered, active, left}`. `hasInterviewed` קורא את הדגל.
- **תשובות** (`answers`) ממופתחות `(code, chapter_id, item_id)` — לא לפי סבב, כך שאיפוס/הגשה-מחדש שומרים אותן.
- **זהות לפי שם (לא קוד!):** `examinees.code` הוא מזהה פנימי קבוע ונסתר (נוצר ב-`genCode`), משמש ככל מפתחות ההצטרפות. הזהות המחייבת היא **השם** (ייחודי, מנורמל דרך `normName` = trim+כיווץ רווחים; חיפוש דרך `findByName`). ה«קוד האישי» שהנבחן מקליד נשמר ב-`examinees.pin` והוא **לא ייחודי** — כל אחד בוחר חופשי; משמש רק לחזרה (שם+קוד). `pin` ריק = נבחן שנפתח לפי שם בלבד ומאמץ את הקוד הראשון שיקליד. `/login` מחזיר 200(restore)/404(שם לא קיים→נבחן חדש)/409(שם תפוס+קוד שגוי, הודעה בדף ההתחברות). המנהל עורך שם+קוד דרך `edit-examinee` (לא נוגע ב-code הפנימי → אין cascade). `add-examinee`/bulk: קוד אופציונלי.

## API עיקרי (מנהל, כולם authExaminer)
- מחזור סבב: `start-round`, `end-round`, `reset-round`, `reset-all-current`, `full-reset` (מוחק slots+answers, שומר נבחנים+תכנון), `pause-all`, `end-exam`+`exam-state`.
- תכנון: `mark-interview{code,round,on}` (רק סבב planned; ריאיון פעם אחת — מסיר סימון מסבבים planned אחרים; מתריע אם כבר התראיין), `set-interview-plan{text}` (הדבקת `קוד/שם,סבב`), `autosplit-interviews` (חלוקה שווה לסבבים פתוחים).
- טיפול פרטני: `advance-examinee{code}` (משבץ נבחן לסבב הרץ אם אין לו slot — למאחרים), `interview-out`/`interview-return` (השהיה/חידוש טיימר + interviewed=1 בחזרה), `reopen-submit`, `set-left{code,left}`, `override{action: add_time|pause|resume|reset_slot|start|finish}`, `remove-examinee`.
- נבחנים: `add-examinee`, `add-examinees-bulk` (`שם,קוד[,סבב]`), `status` (מחזיר running, rounds[], וכל נבחן עם setup/interviewed/in_interview/left/current/timer/chapters_done/remaining_chapters/marked_rounds/needs_interview/finished).
- ייצוא/גיבוי: `export-excel` (xlsx קריא), `export-all` (JSON ל-AI), `backups`/`backup-now`/`backup/:name` (גיבוי אוטו' כל 5 דק' ל-`data/backups`, גם בשרת). נבחן: `/api/{register,login,complete-setup,state,save-answer,submit-slot,swap-question,not-comfortable,event}`, ציבורי `/api/subjects`.

## מצבי מסך הנבחן (`buildExamineeState`, phase)
`ended` → `needs_setup` (אין subjects) → `in_interview` → (אין סבב רץ: `finished`/`waiting`) → לפי slot: `interview`/`submitted`(done)/`chapter`. הלקוח (app.js) עושה polling כל 5 שניות, טיימר server-authoritative, שמירה אוטומטית debounced, חסימת הדבקה + דיווח blur/tabhide, כפתור "הגש פרק", שם+"יציאה".

## מסך המנהל (examiner.js — window.AdminApp, משובץ גם ב-index דרך "כניסת מנהל")
- **קונסולת סבב**: רצועת 5 סבבים + "התחל/סיים/בטל-אפס סבב" + שתי רשימות חיות "בריאיון"/"בפרק".
- **לוח תכנון** (5 עמודות = מי בריאיון בכל סבב) + "חלק לקבוצות".
- **טבלת נבחנים**: כפתורי סבב-ריאיון 1–5 לכל נבחן (סבב שהתחיל נעול), סטטוס "עשה/נותר/התראיין", "עכשיו"+טיימר, טריאז' (שורות דורשות-טיפול קופצות למעלה ומסומנות), כפתור **"כרטיס"**.
- **כרטיס נבחן (מודאל)**: ציר מסלול + פעולות פרטניות (קדם לפעילות הבאה · שלח/חזר מריאיון · +2 דק' · אפס משבצת · פתח הגשה מחדש · סמן עזב · הסר).
- ניהול נבחנים (יחיד/רשימה/תכנון), גיבוי ושחזור, פעולות כלליות (סיים מבחן / אפס יום מלא), Excel/JSON/תקינות.

## עיצוב ומיתוג (מחייב)
- ערכה כהה «הייטקיסטית» בצבעי **עתיד פלוס**: נייבי `#1e2a5e`, ירוק `#45b84e`, טורקיז `#23b3a4`. RTL מלא, בלי אימוג'י (למעט ✓/⚑ קיימים). לוגו: `public/img/logo.svg` — סמל 3 משושים ששוחזר; **המשתמש יכול להחליף ל-PNG הרשמי ב-`public/img/`**.
- KaTeX עם קווי שבר אמיתיים; `.katex{direction:ltr;unicode-bidi:isolate}` (תיקון RTL); שבר עברי דרך טוקן `[[frac:מונה|מכנה]]` ב-render.js (לא Hebrew בתוך `\text` של KaTeX).

## פריסה (Render)
- הקוד הוא git repo ב-`app/`. תיקיית העלאה נקייה ב-`~/Desktop/yom-haaracha-github` (נבנית מ-`git archive HEAD`). המשתמש מעלה דרך אתר GitHub (Upload files, גורר את כל התוכן).
- Render: **New → Web Service** (אין Blueprint בתפריט), חיבור למאגר. **Build:** `npm install`, **Start:** `npm start`. אם הקבצים בתת-תיקייה במאגר → **Settings → Root Directory** = שם התיקייה. Env: `EXAMINER_PASSWORD`, `DB_PATH=/var/data/assessment.db`. תוכנית Starter (לא Free) + **Disk** ב-`/var/data` לגיבוי קבוע. `render.yaml` קיים.

## לקחים/מלכודות (אל תחזור עליהן)
- **סטטיים עם `Cache-Control: no-store`** (server.js) — כדי שעדכונים ייכנסו לתוקף מיד. אחרי deploy: רענון קשיח (Cmd+Shift+R).
- **שרת כפול**: להריץ רק instance אחד על 3000 (הלאנצ'ר עוצר קודם). שני שרתים = נתונים ישנים/בלבול.
- **באג closure שתוקן**: handlers של כפתורי קונסולה חייבים לקרוא מ-`this`/data-attr, לא ממשתנה משותף.
- בדיקת שפיות מהירה: `node -c <file>.js`.
- נבחן שבחר <4 מקצועות: `chapterListFor` מרפד בחזרה על הראשי אך `nextChapter` מדלג על כפילויות → יעשה רק פרקים ייחודיים (לא באג קריטי; לתעד אם עולה).

## סטטוס נוכחי (עדכן אחרי כל סבב!)
**הושלם ונבדק (rehearsal 18/18, אימות ויזואלי):** מנוע סבב-חי מלא; קונסולת מנהל; לוח תכנון 5 עמודות + כרטיס נבחן לטיפול פרטני (קידום אישי, ריאיון-כאירוע-אישי עם השהיית טיימר, טריאז'); גיבוי אוטומטי; Excel/JSON; מדריך `guide.pdf`. הקוד commited ב-git; תיקיית ההעלאה מעודכנת.

**נוסף לאחרונה (נבדק):**
- **מטריצה מלאה** (`/api/examiner/matrix` + `renderMatrix` ב-examiner.js): נבחן×5 סבבים. עבר/הווה מ-slots, עתיד = צפי מלא (ריאיונות מסומנים + פרקים נותרים לפי הסדר; ריאיון-צפי כשנגמרים הפרקים). תא→כרטיס נבחן. CSS ב-`.matrix`/`.mx`.
- **שלב ביטחון (עמידות רשת)** ב-app.js: כל תשובה נכנסת ל-`App.outbox` (נשמר ב-localStorage `yh_outbox`) → `flushOutbox` עם retry (`scheduleRetry` 3ש') + על online/poll. מחוון `#net-status` (offline/pending/ok). `onSubmit` מרוקן תור לפני הגשה. `renderChapter` מעדיף ערך מקומי ממתין. מתאפס ב-logout.
- **גוגל שיטס לייב**: `pushToSheet` (fire-and-forget, כבוי אם `SHEETS_WEBHOOK_URL`/`sheetsWebhookUrl` ריק). `pushChapterAnswers(examinee, slot)` דוחף את **התשובות המלאות** של פרק (שאלה·תשובה מפוענחת·לא יודע/ת·נכון) — נורה ב-`submit-slot`, וב-`end-round` עבור chapter slots שלא הוגשו (בלי כפילויות). הגדרה: `docs/google-sheets-setup.md` (env `SHEETS_WEBHOOK_URL` ב-Render). נבדק מול מוק מקומי + rehearsal.
- **בנק תוכן (34 פרקים, 10 מקצועות)** ב-`content/` — 8 מקצועות "רגילים" × 3 וריאנטים (מתמטיקה 5/4/3 = 9) + «יזמות גירלס פלוס» (1) + «מידע כללי» (3). 8 פרקי הזרע הוסרו. מתמטיקה ב-KaTeX (`tex`/`\(...\)`), שבר עברי בטוקן `[[frac:...|...]]`. עבר `check-content` (0 שגיאות) + rehearsal 18/18 ל-N=30 ו-N=50, ובדיקת מקביליות אמיתית (30 בקשות בו-זמנית, 62ms).
- **"החלף שאלה" תוקן** (`swap-question` + `pickSwapChapter`): מושך פרק אחר מאותו מקצוע/רמה שהנבחן טרם עשה, ומעדכן `slot.chapter_id`. **מעקב "נעשה" עבר מ-chapter_id ל-מקצוע** (`servedSubjects`/`doneSubjects` ב-`resolveActivity`/status/matrix) — כך מקצוע שהוחלף לא חוזר בסבב מאוחר. (`not-comfortable` לא-מתמטיקה משתמש באותו pool; ענף המתמטיקה נשאר — מוריד רמה לפרק מתמטיקה עתידי אם קיים.)
- **rehearsal עודכן** למודל הזהות החדש: משתמש ב-`internalCode` (מ-`state.examinee.code`) לפעולות מנהל, וב-`code` (pin) להתחברות.

**נוסף בסבב האחרון (01/08/2026 — נבדק מקומית, טרם עלה ל-Render):**
- **פרק «מידע כללי» (חובה לכולם)**: הנבחן בוחר **3 מקצועות (לא 4)**, והפרק הרביעי הוא תמיד «מידע כללי» — decode→teach ברמת חטיבה (חומר חדש מוסבר במלואו בקטע, הנבחן מפענח ומסביר לתלמיד). מנגנון: `buildChapterSubjects` ב-`lib/schedule.js` (קבועים `NUM_CHOSEN=3`, `GENERAL_SUBJECT='מידע כללי'`). תוכן: `content/general_{sunk_cost,rule72,framing}_01.json`. מוסתר מבחירת המקצועות (`/api/subjects` מסנן אותו).
- **מקצוע «יזמות גירלס פלוס»** (בנות בלבד — תווית בלבד, אין שדה מגדר): `content/entrepreneurship_girls_plus_01.json`, וריאנט יחיד, 10 שאלות פתוחות (text_teach) מה-PDF. אזהרת check-content "אין mc" — צפויה ותקינה.
- **כפתור «לא יודע/ת»** (מחליף את מקום «לא בנוח» שהוסר): מסמן פריט + ממשיך לשאלה הבאה. שמירה עמידה דרך ה-outbox (`save-answer` + דגל `dont_know`, עמודה חדשה ב-`answers`). מוצג ב-export (Excel+JSON) ובכרטיס. UI: `.act-dontknow`/`.dk-marked`/`.dk-badge`.
- **מסך הוראות** חדש אחרי הכניסה (view `instructions` ב-app.js): login→instructions→declaration→subjects→exam.
- **שאלון הצהרה מחודש**: רשימה קבועה של 12 מקצועות (`DECL_SUBJECTS` ב-app.js) — **דיווח עצמי בלבד, נפרד מבחירת המבחן** — + רמת מתמטיקה + **שדה הערות אחד** (במקום הערה פר-מקצוע). מבנה אחסון: `{subjects, mathLevel, note}` ב-`examinees.declaration`. מוצג בכרטיס הבוחן וב-roster/JSON.
- **סבב תוספות שני**: (א) פירוט ידע-מוקדם פר-מקצוע במסך ההוראות. (ב) גיליון גוגל שיטס עם **התשובות המלאות** (ראו שורת "גוגל שיטס לייב" למטה) — הכרעת המשתמש: נקי, בהגשת פרק (+ השלמה ב-end-round).

**הבא בתור (backlog):**
1. **בדיקת AI «שילוב» (AI מציע, אדם מאשר)** — `lib/grade.js` קיים כ-CLI בלבד (batch, ממוצע/מרוכב/דירוג/אחוזון, demo בלי מפתח). חסר: מסך מנהל להרצה+הצגת הצעות+אישור/עריכה+שמירת ציון סופי.
2. **תוכן «מידע כללי» סופי**: כרגע 3 קטעים טיוטתיים (sunk cost / כלל 72 / מסגור). המשתמש עשוי להחליף לטקסט משלו.
3. **פענוח לא בנוח הישן**: `/api/not-comfortable` נשאר כקוד מת בשרת (הכפתור הוסר). אפשר לנקות אם רוצים.

## תהליך העבודה עם המשתמש
נותן רשימות תיקונים; לעבור סעיף-סעיף, לשאול על הלא-ברור (AskUserQuestion) לפני בנייה גדולה, לאמת ב-preview לפני מסירה. מעריך UI מגניב + מיתוג עתיד פלוס. mockups (visualize) לפני בנייה גדולה עוזרים לו להחליט.
