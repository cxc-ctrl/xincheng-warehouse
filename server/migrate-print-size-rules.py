"""Add empty reusable size rules, preserving every existing business cell."""
import argparse, datetime, gzip, hashlib, json, pathlib, sqlite3

p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--migration',required=True);p.add_argument('--backup-dir',required=True);a=p.parse_args()
c=sqlite3.connect(a.db,timeout=30)
names=[r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
def digest():
 h=hashlib.sha256()
 for name in sorted(names):
  rows=c.execute('SELECT * FROM "'+name.replace('"','""')+'" ORDER BY rowid').fetchall();h.update(repr((name,rows)).encode())
 return h.hexdigest()
backup=None
if 'print_size_rules' not in names:
 folder=pathlib.Path(a.backup_dir);folder.mkdir(parents=True,exist_ok=True);backup=folder/('before-print-size-rules-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'.sqlite.gz')
 copy=sqlite3.connect(':memory:');c.backup(copy)
 with gzip.open(backup,'wb') as f:f.write(copy.serialize())
 copy.close();c.execute('BEGIN IMMEDIATE');before=digest()
 try:
  c.execute(pathlib.Path(a.migration).read_text(encoding='utf-8'));assert before==digest(),'Existing business data changed';c.commit()
 except Exception:c.rollback();raise
assert {'scope','size_cm','per_sheet','sheet_cost','sheet_weight_g','enabled','updated_at'}.issubset({r[1] for r in c.execute('PRAGMA table_info(print_size_rules)')})
assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
print(json.dumps({'ready':True,'existing_business_data_preserved':True,'backup':str(backup) if backup else None}));c.close()
