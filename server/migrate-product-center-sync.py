"""Create product source profiles, preserving every existing business record."""
import argparse,datetime,gzip,hashlib,json,pathlib,sqlite3
p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--migration',required=True);p.add_argument('--backup-dir',required=True);a=p.parse_args()
c=sqlite3.connect(a.db,timeout=30)
tables=[r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
def digest():
 h=hashlib.sha256()
 for name in sorted(tables):h.update(repr((name,c.execute('SELECT * FROM "'+name.replace('"','""')+'" ORDER BY rowid').fetchall())).encode())
 return h.hexdigest()
backup=None
if not c.execute("SELECT 1 FROM sqlite_master WHERE name='product_supply_profiles'").fetchone():
 directory=pathlib.Path(a.backup_dir);directory.mkdir(parents=True,exist_ok=True);backup=directory/('before-product-center-sync-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'.sqlite.gz')
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
for name in ['product_supply_profiles']:assert c.execute("SELECT 1 FROM sqlite_master WHERE name=?",(name,)).fetchone()
assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
print(json.dumps({'ready':True,'existing_business_data_preserved':True,'backup':str(backup) if backup else None}))
c.close()
