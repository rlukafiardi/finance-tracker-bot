"""Source of docs/architecture.excalidraw and docs/architecture.svg. Edit the layout here, then run:

    python3 docs/architecture.py

Uses the architecture-diagram skill of the radikal-ai-agent workspace (excalidraw_lib, render_svg).
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.join(HERE, '..', '..', '..', '.claude', 'skills', 'architecture-diagram', 'scripts')
sys.path.insert(0, SKILL)
from excalidraw_lib import Diagram  # noqa: E402

d = Diagram(seed=11)
d.title('Finance Tracker Bot · architecture', 'Telegram → Cloudflare → Google Apps Script, all on free tiers')
d.lane(20, 0, 1820, 250, 'SCHEDULED · time triggers')
d.lane(20, 280, 1820, 640, 'CHAT · every message')

# Scheduled lane
d.box(50, 97, 190, 56, 'service', 'TIME TRIGGERS', 'Mon 09 · 1st 09 · daily 06')
d.box(290, 30, 200, 56, 'code', 'DASHBOARD REFRESH', 'daily + after each change')
d.box(290, 97, 200, 56, 'code', 'BACKUP', '1st · values-only copy')
d.box(290, 164, 200, 56, 'code', 'RECAPS', 'weekly · monthly · alert')
d.cylinder(560, 80, 150, 90, 'service', label='Google Drive', cap=30)
d.arrow([(242, 125), (266, 125), (266, 58), (288, 58)])
d.arrow([(242, 125), (288, 125)])
d.arrow([(242, 125), (266, 125), (266, 192), (288, 192)])
d.arrow([(492, 125), (558, 125)], 'save', at=(508, 108))
d.arrow([(492, 58), (1510, 58), (1510, 218), (1558, 218)], 'rebuild dashboard tab', at=(800, 40))

# Bank email import: Gmail (read-only) -> parse, dedupe, category -> batch preview in the chat flow
d.box(980, 60, 190, 56, 'service', 'GMAIL', 'BNI · BCA notifications')
d.box(1230, 150, 200, 56, 'code', 'EMAIL IMPORT', 'parse · dedupe · category')
d.arrow([(1172, 88), (1195, 88), (1195, 165), (1228, 165)], 'read-only', at=(1128, 126), style='dotted')
d.arrow([(145, 155), (145, 240), (1210, 240), (1210, 191), (1228, 191)], 'email · 09 12 15 18 21 · /email', at=(700, 222))
d.arrow([(1390, 208), (1390, 343)], 'batch preview', at=(1290, 262))
d.arrow([(1432, 185), (1470, 185), (1470, 298), (1558, 298)], 'handled ids', at=(1474, 304), style='dotted')

# The Sheet spans both lanes, its tabs inside
d.cylinder(1540, 110, 240, 680, 'store', title='Google Sheet')
d.box(1560, 190, 200, 56, 'output', 'dashboard', 'KPI cards · charts · bars')
d.box(1560, 270, 200, 56, 'plain', 'email_log', 'handled bank emails')
d.box(1560, 350, 200, 56, 'plain', 'categories · budgets')
d.box(1560, 511, 200, 56, 'plain', 'accounts', 'live balance formula')
d.box(1560, 672, 200, 56, 'plain', 'transactions', 'one row per entry')

# Chat lane
d.person(58, 492, 'Me')
d.box(300, 345, 180, 70, 'service', 'TELEGRAM', 'Bot API · Finance topic')
d.box(560, 345, 180, 70, 'service', 'CLOUDFLARE WORKER', 'relay · answers 200')
d.box(820, 345, 180, 70, 'code', 'doPost', 'secret · owner · topic')
d.diamond(910, 540, 56, 'route')
d.box(1060, 345, 180, 70, 'ai', 'GEMINI', 'intent + JSON · quip')
d.box(1060, 505, 180, 70, 'code', 'SLASH COMMANDS', 'no Gemini call')
d.box(1060, 665, 180, 70, 'code', 'YES / NO', 'ya · batal · ✅/❌ tap')
d.box(1300, 345, 180, 70, 'code', 'PREPARE', 'validate · preview · answer')
d.box(1300, 505, 180, 70, 'service', 'PENDING', '1 action · 15 min')
d.box(1300, 665, 180, 70, 'code', 'COMMIT', 'write rows · fee buttons')
d.box(1060, 815, 180, 70, 'code', 'REPLY', 'sendMessage → topic')

d.arrow([(390, 222), (390, 343)], 'recap to the topic', at=(398, 262), style='dashed')
d.arrow([(124, 530), (200, 530), (200, 380), (298, 380)], 'message\n✅/❌ · fee tap', at=(208, 440))
d.arrow([(482, 380), (558, 380)], 'webhook', at=(496, 362))
d.arrow([(742, 380), (818, 380)], 'forward', at=(756, 362))
d.arrow([(910, 417), (910, 510)])
d.arrow([(940, 540), (1020, 540), (1020, 380), (1058, 380)], 'free text', at=(1026, 446))
d.arrow([(940, 540), (1058, 540)], '/command', at=(950, 546))
d.arrow([(910, 570), (910, 700), (1058, 700)], 'reply to a\npreview', at=(918, 610))
d.arrow([(1242, 380), (1298, 380)])
d.arrow([(1242, 540), (1270, 540), (1270, 398), (1298, 398)])
d.arrow([(1390, 417), (1390, 503)], 'preview ✅/❌', at=(1398, 452))
d.arrow([(1390, 577), (1390, 663)])
d.arrow([(1242, 700), (1298, 700)], 'confirm', at=(1248, 682))
d.arrow([(1482, 378), (1558, 378)], 'read', at=(1500, 360), style='dotted')
d.arrow([(1482, 700), (1558, 700)], 'write', at=(1500, 682))
d.arrow([(1390, 737), (1390, 850), (1242, 850)])
d.arrow([(1058, 850), (90, 850), (90, 556)], 'preview · answer · result · recap', at=(420, 856), style='dashed')

scene = os.path.join(HERE, 'architecture.excalidraw')
d.save(scene)
sys.exit(subprocess.run([sys.executable, os.path.join(SKILL, 'render_svg.py'), scene,
                         os.path.join(HERE, 'architecture.svg')] + sys.argv[1:]).returncode)
