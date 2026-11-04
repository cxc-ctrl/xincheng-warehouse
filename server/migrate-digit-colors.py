"""Add colour fulfillment tables without replaying or changing business data."""
import argparse, gzip, hashlib, json, pathlib, sqlite3, time
p=argparse.ArgumentParser()
p.add_argument('--db',required=True);p.add_argument('--migration',required=True);p.add_argument('--backup-dir',required=True)
a=p.parse_args();c=sqlite3.connect(a.db,timeout=30)
tables=['products','physical_stocks','stock_rules','orders','order_stocks','movements','order_returns','batches','warehouse_settings']
def digest():
 h=hashlib.sha256()
 for t in tables:
  cols=[r[1] for r in c.execute('PRAGMA table_info('+t+')') if r[1] not in ['buyer_remark','seller_remark','remarks_available']]
  h.update(repr((t,sorted(c.execute('SELECT '+','.join(cols)+' FROM '+t).fetchall(),key=repr))).encode())
 return h.hexdigest()
backup=None
if not c.execute("SELECT 1 FROM sqlite_master WHERE name='digit_fulfillments'").fetchone():
 directory=pathlib.Path(a.backup_dir);directory.mkdir(parents=True,exist_ok=True)
 backup=directory/('before-digit-colors-'+str(int(time.time()))+'.sqlite.gz')
 snapshot=sqlite3.connect(':memory:');c.backup(snapshot)
 with gzip.open(backup,'wb') as f:f.write(snapshot.serialize())
 snapshot.close()
 c.execute('BEGIN IMMEDIATE');before=digest()
 try:
  statement=''
  for line in pathlib.Path(a.migration).read_text(encoding='utf-8').splitlines(True):
   statement+=line
   if sqlite3.complete_statement(statement):c.execute(statement);statement=''
  assert not statement.strip(),'Incomplete migration'
  assert before==digest(),'Business data changed'
  c.commit()
 except Exception:c.rollback();raise
assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
print(json.dumps({'schema_ready':True,'business_data_preserved':True,'backup':str(backup) if backup else None,'counts':{t:c.execute('SELECT count(*) FROM '+t).fetchone()[0] for t in tables}}))
c.close()
