/*
 * רינדור טקסט מעורב: עברית רגילה + מתמטיקה ב-KaTeX + שבר עברי.
 *  - \( ... \)  → מתמטיקה בשורה
 *  - \[ ... \]  → מתמטיקה בבלוק
 *  - [[frac:מונה|מכנה]] → שבר עם קו שבר אמיתי (למונחים בעברית, בלי לוכסן)
 * חשוב: תווי ה-backslash נשמרים לכל אורך השרשרת (JSON → כאן → KaTeX).
 */
(function () {
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function katexHtml(tex, display) {
    if (typeof katex === 'undefined') return esc(tex);
    try {
      return katex.renderToString(tex, { throwOnError: false, strict: false, displayMode: !!display });
    } catch (e) {
      return '<span class="tex-err">' + esc(tex) + '</span>';
    }
  }

  function fracHtml(top, bottom) {
    return '<span class="hfrac"><span class="hfrac-num">' + esc(top.trim()) +
      '</span><span class="hfrac-den">' + esc(bottom.trim()) + '</span></span>';
  }

  function renderMathText(str) {
    if (str == null) return '';
    str = String(str);
    var re = /\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\[\[frac:([^|\]]+)\|([^\]]+)\]\]/g;
    var out = '', last = 0, m;
    while ((m = re.exec(str)) !== null) {
      out += esc(str.slice(last, m.index));
      if (m[1] !== undefined) out += katexHtml(m[1], false);
      else if (m[2] !== undefined) out += katexHtml(m[2], true);
      else out += fracHtml(m[3], m[4]);
      last = re.lastIndex;
    }
    out += esc(str.slice(last));
    return out;
  }

  window.renderMathText = renderMathText;
})();
