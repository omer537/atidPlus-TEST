#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ממיר את README.md למדריך PDF בעברית (RTL) בעיצוב עתיד פלוס.
   שימוש: /tmp/pdfvenv/bin/python scripts/build_guide.py
"""
import os, re, html
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_RIGHT, TA_LEFT, TA_CENTER
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from bidi.algorithm import get_display

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
README = os.path.join(HERE, 'README.md')
OUT = os.path.join(HERE, 'public', 'guide.pdf')

FONT = 'Heb'
pdfmetrics.registerFont(TTFont(FONT, '/Library/Fonts/Arial Unicode.ttf'))

NAVY = colors.HexColor('#1e2a5e')
TEAL = colors.HexColor('#12857a')
GREEN = colors.HexColor('#2f8f38')
BODY = colors.HexColor('#232733')
GREY = colors.HexColor('#6b7280')

MARGIN = 1.8 * cm
USABLE = A4[0] - 2 * MARGIN

st_title = ParagraphStyle('title', fontName=FONT, fontSize=24, textColor=NAVY, alignment=TA_RIGHT, leading=30, spaceAfter=4)
st_sub   = ParagraphStyle('sub', fontName=FONT, fontSize=12, textColor=TEAL, alignment=TA_RIGHT, leading=18, spaceAfter=10)
st_h2    = ParagraphStyle('h2', fontName=FONT, fontSize=16, textColor=NAVY, alignment=TA_RIGHT, leading=22, spaceBefore=16, spaceAfter=4)
st_h3    = ParagraphStyle('h3', fontName=FONT, fontSize=13, textColor=TEAL, alignment=TA_RIGHT, leading=19, spaceBefore=10, spaceAfter=2)
st_body  = ParagraphStyle('body', fontName=FONT, fontSize=10.5, textColor=BODY, alignment=TA_RIGHT, leading=17)
st_bullet= ParagraphStyle('bul', fontName=FONT, fontSize=10.5, textColor=BODY, alignment=TA_RIGHT, leading=17)
st_quote = ParagraphStyle('q', fontName=FONT, fontSize=10.5, textColor=GREY, alignment=TA_RIGHT, leading=17)
st_code  = ParagraphStyle('code', fontName='Courier', fontSize=9.5, textColor=colors.HexColor('#0b3d2e'),
                          alignment=TA_LEFT, leading=14, backColor=colors.HexColor('#eef4f2'),
                          borderPadding=(6, 6, 6, 6), leftIndent=6, rightIndent=6)

def clean_inline(t):
    t = re.sub(r'\[([^\]]+)\]\(#[^)]*\)', r'\1', t)          # internal TOC links -> text only
    t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'\1 (\2)', t)    # external links -> text (url)
    t = t.replace('**', '').replace('`', '')
    return t.strip()

def wrap_rtl(text, font, size, max_w):
    words = text.split(' ')
    lines, cur = [], ''
    for w in words:
        test = (cur + ' ' + w).strip()
        if pdfmetrics.stringWidth(test, font, size) <= max_w or not cur:
            cur = test
        else:
            lines.append(cur); cur = w
    if cur:
        lines.append(cur)
    return lines or ['']

def emit_rtl(story, text, style, prefix='', indent=0):
    """שובר לשורות ידנית, מחיל bidi על כל שורה, ושומר על סדר אנכי נכון."""
    text = clean_inline(text)
    max_w = USABLE - indent - (pdfmetrics.stringWidth(prefix, style.fontName, style.fontSize) if prefix else 0)
    lines = wrap_rtl(text, style.fontName, style.fontSize, max_w)
    for i, ln in enumerate(lines):
        disp = get_display((prefix + ln) if i == 0 else ln)
        s = ParagraphStyle('x', parent=style, rightIndent=indent)
        story.append(Paragraph(html.escape(disp), s))

def build():
    with open(README, encoding='utf-8') as f:
        raw = f.read().split('\n')

    story = []
    # כותרת עליונה
    story.append(Paragraph(get_display('עתיד פלוס · יום הערכה'), st_sub))
    story.append(HRFlowable(width='100%', color=TEAL, thickness=1.2, spaceAfter=10))

    in_code, code_lines = False, []
    for line in raw:
        s = line.rstrip()
        if s.strip().startswith('```'):
            if in_code:
                for cl in code_lines:
                    story.append(Paragraph(html.escape(cl) or '&nbsp;', st_code))
                code_lines = []
            in_code = not in_code
            continue
        if in_code:
            code_lines.append(s)
            continue
        if not s.strip():
            story.append(Spacer(1, 5)); continue
        if s.startswith('# '):
            story.append(Spacer(1, 2))
            emit_rtl(story, s[2:], st_title)
        elif s.startswith('## '):
            emit_rtl(story, s[3:], st_h2)
        elif s.startswith('### '):
            emit_rtl(story, s[4:], st_h3)
        elif re.match(r'^\s*[-*] ', s):
            emit_rtl(story, re.sub(r'^\s*[-*] ', '', s), st_bullet, prefix='•  ', indent=10)
        elif re.match(r'^\s*\d+\. ', s):
            m = re.match(r'^\s*(\d+)\. (.*)', s)
            emit_rtl(story, m.group(2), st_bullet, prefix=m.group(1) + '.  ', indent=10)
        elif s.startswith('> '):
            emit_rtl(story, s[2:], st_quote, prefix='│ ')
        elif s.startswith('|'):
            cells = [c.strip() for c in s.strip('|').split('|')]
            if set(''.join(cells)) <= set('-: '):
                continue  # separator row
            emit_rtl(story, '   ·   '.join(cells), st_body)
        elif re.match(r'^-{3,}$', s.strip()):
            story.append(Spacer(1, 3)); story.append(HRFlowable(width='100%', color=colors.HexColor('#d7dce6'), thickness=0.7)); story.append(Spacer(1, 3))
        else:
            emit_rtl(story, s, st_body)

    doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=1.6*cm, bottomMargin=1.6*cm,
                            title='מדריך יום הערכה — עתיד פלוס')
    doc.build(story)
    print('נבנה:', OUT)

if __name__ == '__main__':
    build()
