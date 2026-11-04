"""Add nullable print recipes; verify every pre-existing cell is preserved."""
import argparse,datetime,gzip,hashlib,json,pathlib,sqlite3
p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--migration',required=True);p.add_argument('--backup-dir',required=True);a=p.parse_args()
c=sqlite3.connect(a.db,timeout=30)
tables={r[0]:[v[1] for v in c.execute('PRAGMA table_info("'+r[0].replace('"','""')+'")')] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()}
def quote(s):return '"'+s.replace('"','""')+'"'
def digest():
 h=hashlib.sha256()
 for name,columns in sorted(tables.items()):h.update(repr((name,c.execute('SELECT '+','.join(map(quote,columns))+' FROM '+quote(name)+' ORDER BY rowid').fetchall())).encode())
 return h.hexdigest()
backup=None
if not c.execute("SELECT 1 FROM sqlite_master WHERE name='print_paper_settings'").fetchone():
 directory=pathlib.Path(a.backup_dir);directory.mkdir(parents=True,exist_ok=True);backup=directory/('before-print-recipes-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'.sqlite.gz')
 snapshot=sqlite3.connect(':memory:');c.backup(snapshot)
 with gzip.open(backup,'wb') as f:f.write(snapshot.serialize())
 snapshot.close();c.execute('BEGIN IMMEDIATE');before=digest()
 try:
  statement=''
  for line in pathlib.Path(a.migration).read_text(encoding='utf-8').splitlines(True):
   statement+=line
   if sqlite3.complete_statement(statement):c.execute(statement);statement=''
  assert not statement.strip();assert before==digest(),'Existing business records changed';c.commit()
 except Exception:c.rollback();raise
assert {'per_pack','per_sheet','sheet_cost','sheet_weight_g','layout_mode'}.issubset({r[1] for r in c.execute('PRAGMA table_info(print_catalog)')})
assert {'actual_weight_g','estimate_snapshot'}.issubset({r[1] for r in c.execute('PRAGMA table_info(print_jobs)')})
assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
print(json.dumps({'ready':True,'existing_business_data_preserved':True,'backup':str(backup) if backup else None}))
c.close()
