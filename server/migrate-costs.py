"""Add cost configuration tables, preserving all existing business rows."""
import argparse, gzip, hashlib, json, pathlib, sqlite3, time
p=argparse.ArgumentParser()
p.add_argument('--db',required=True);p.add_argument('--migration',required=True);p.add_argument('--backup-dir',required=True)
a=p.parse_args();c=sqlite3.connect(a.db,timeout=30)
tables=['cost_materials','freight_templates','inventory_weights']
existing=[t for t in tables if c.execute('SELECT 1 FROM sqlite_master WHERE type=? AND name=?',('table',t)).fetchone()]
if existing and len(existing)!=len(tables):raise RuntimeError('Partial schema exists; inspect before proceeding')
business=['products','physical_stocks','stock_rules','orders','order_stocks','movements','order_conflicts','order_returns','batches','warehouse_settings']
def digest():
    h=hashlib.sha256()
    for t in business:h.update(repr((t,sorted(c.execute('SELECT * FROM '+t).fetchall(),key=repr))).encode())
    return h.hexdigest()
backup=None
if not existing:
    directory=pathlib.Path(a.backup_dir);directory.mkdir(parents=True,exist_ok=True)
    backup=directory/('before-cost-modules-'+str(int(time.time()))+'.sqlite.gz')
    snapshot=sqlite3.connect(':memory:');c.backup(snapshot)
    with gzip.open(backup,'wb',compresslevel=6) as f:f.write(snapshot.serialize())
    snapshot.close()
    c.execute('BEGIN IMMEDIATE');before=digest()
    try:
        for statement in pathlib.Path(a.migration).read_text(encoding='utf-8').split('--> statement-breakpoint'):
            if statement.strip():c.execute(statement)
        assert digest()==before,'Business rows changed'
        c.commit()
    except Exception:c.rollback();raise
assert c.execute('PRAGMA quick_check').fetchone()[0]=='ok'
print(json.dumps({'schema_ready':True,'existing_business_data_preserved':True,'backup':str(backup) if backup else None,'backup_bytes':backup.stat().st_size if backup else 0,'counts':{t:c.execute('SELECT count(*) FROM '+t).fetchone()[0] for t in business}}))
c.close()
