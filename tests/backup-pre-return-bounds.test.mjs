// [pc2-codex-41] NEW successor tests only. Existing node:sqlite in-memory mechanism; no cloud/native Worker runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readBackupSnapshot,runBackup,snapshotStatsSql,boundedTableSql,PRE_RETURN_LIMITS} from '../workers/backup/candidates/pre-return-bounded.mjs';
function adapter(sqlite,mutate){
 const batches=[];return {batches,prepare(sql){return {sql};},async batch(statements){
  batches.push(statements.map(s=>s.sql));if(batches.length===3&&mutate)mutate();
  sqlite.exec('BEGIN');try{const values=statements.map(s=>({success:true,results:sqlite.prepare(s.sql).all()}));sqlite.exec('COMMIT');return values;}catch(error){sqlite.exec('ROLLBACK');throw error;}
 }};
}
test('full fidelity for NULL/control Unicode/JSON-like text/safe integers and difficult REALs in one final batch',async()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE alpha(id INTEGER,note TEXT,nullvalue TEXT,amount REAL);CREATE TABLE d1_migrations(name TEXT)');
  const numbers=[Math.PI,1.0000000000000002,Number.MIN_VALUE,Number.MAX_VALUE,Number.EPSILON,-123.45678901234567];
  for(const [i,n]of numbers.entries())db.prepare('INSERT INTO alpha VALUES(?,?,?,?)').run(i===0?Number.MAX_SAFE_INTEGER:i,'\uFEFF\u0000\u0001🌎[true]é',null,n);
  db.prepare('INSERT INTO d1_migrations VALUES(?)').run('0020_fixture.sql');
  const binding=adapter(db),snapshot=await readBackupSnapshot(binding),rows=snapshot.tables.find(t=>t.name==='alpha').rows;
  assert.equal(binding.batches.length,3);assert.equal(binding.batches[2].length,4);assert.equal(binding.batches[2].filter(s=>s.includes('AS envelope')).length,2);assert.ok(!binding.batches.flat().some(s=>/SELECT \*/.test(s)));
  for(const [i,row]of rows.entries()){assert.equal(row.note,'\uFEFF\u0000\u0001🌎[true]é');assert.equal(row.nullvalue,null);assert.equal(row.amount,numbers[i]);}assert.equal(rows[0].id,Number.MAX_SAFE_INTEGER);
  assert.equal(snapshot.tables.find(t=>t.name==='d1_migrations').rows[0].name,'0020_fixture.sql');
  db.exec("DELETE FROM alpha;INSERT INTO alpha(note) VALUES(CAST(X'80' AS TEXT))");let writes=0;await assert.rejects(runBackup({DB:adapter(db),BACKUPS:{async head(){return null;},async put(){writes++;}}}),/UTF8 text/);assert.equal(writes,0);
 }finally{db.close();}
});
test('CURRENT capture row/byte/type growth yields NULL HOLD marker, never truncation or a partial R2 write',async()=>{
 for(const mutate of [db=>db.exec("INSERT INTO alpha VALUES('second')"),db=>db.prepare('UPDATE alpha SET value=?').run('X'.repeat(12000)),db=>db.exec("UPDATE alpha SET value=X'010203'")]){
  const db=new DatabaseSync(':memory:');try{db.exec('CREATE TABLE alpha(value TEXT)');db.prepare('INSERT INTO alpha VALUES(?)').run('a');const binding=adapter(db,()=>mutate(db));let writes=0,encoderCalls=0;db.function('json_array',{varargs:true},()=>{encoderCalls++;throw Error('Rejected payload must not be encoded');});
   await assert.rejects(runBackup({DB:binding,BACKUPS:{async head(){return null;},async put(){writes++;},async list(){assert.fail('no pruning after refusal');}}}),/bounded snapshot/);assert.equal(writes,0);assert.equal(binding.batches.length,3);
   const gate=binding.batches[2].find(s=>s.includes('AS envelope'));assert.equal(db.prepare(gate).get().envelope,null);assert.equal(encoderCalls,0);
  }finally{db.close();}
 }
});
test('row/cell/total encoded allocation and unsupported BLOB/unsafe integer/infinite REAL refuse before content return',async()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE alpha(value)');const table={name:'alpha',columns:['value']};
  for(const insert of [()=>db.exec("INSERT INTO alpha VALUES(X'01')"),()=>db.exec('INSERT INTO alpha VALUES(9223372036854775807)'),()=>db.exec('INSERT INTO alpha VALUES(1e999)')]){db.exec('DELETE FROM alpha');insert();await assert.rejects(readBackupSnapshot(adapter(db)),/scalar limits/);}
  db.exec('DELETE FROM alpha');const stmt=db.prepare('INSERT INTO alpha VALUES(?)');for(let i=0;i<2049;i++)stmt.run(null);const stats=db.prepare(snapshotStatsSql(table)).get();assert.equal(stats.row_count,2049);assert.equal(db.prepare(boundedTableSql(table,{rows:2048,cells:2048,bytes:1048576})).get().envelope,null);await assert.rejects(readBackupSnapshot(adapter(db)),/scalar limits/);
  db.exec('DELETE FROM alpha');for(let i=0;i<120;i++)stmt.run('x'.repeat(2000));await assert.rejects(readBackupSnapshot(adapter(db)),/total allocation/);
  assert.throws(()=>boundedTableSql(table,{rows:1,cells:65537,bytes:1000}));
 }finally{db.close();}
});
test('100-column typed arrays preserve trailing NULLs within32 argument limits and bounded SQL',async()=>{
 const db=new DatabaseSync(':memory:');try{db.exec(`CREATE TABLE wide(${Array.from({length:100},(_,i)=>'c'+i).join(',')})`);db.exec('INSERT INTO wide DEFAULT VALUES');const snap=await readBackupSnapshot(adapter(db)),row=snap.tables[0].rows[0];assert.equal(Object.keys(row).length,100);assert.equal(row.c99,null);
  const sql=boundedTableSql({name:'wide',columns:Array.from({length:100},(_,i)=>'c'+i)},{rows:1,cells:100,bytes:10000});assert.ok(Buffer.byteLength(sql)<PRE_RETURN_LIMITS.sqlBytes);assert.ok(sql.includes('json_insert('));assert.ok(!sql.includes('json_patch('));
 }finally{db.close();}
});
test('schema drift/generated/oversize DDL and identifiers explicitly refuse without silently omitting columns',async()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE alpha(value TEXT)');db.exec("INSERT INTO alpha VALUES('a')");await assert.rejects(readBackupSnapshot(adapter(db,()=>db.exec('ALTER TABLE alpha ADD COLUMN extra TEXT'))),/catalog\/schema changed/);
  db.exec('DROP TABLE alpha;CREATE TABLE alpha(value INTEGER,computed INTEGER AS (value+1))');await assert.rejects(readBackupSnapshot(adapter(db)),/column metadata/);
  db.exec('DROP TABLE alpha');db.exec(`CREATE TABLE alpha(value TEXT DEFAULT '${'x'.repeat(4200)}')`);await assert.rejects(readBackupSnapshot(adapter(db)),/catalog/);
  assert.throws(()=>snapshotStatsSql({name:'alpha;DROP TABLE alpha',columns:['value']}));
 }finally{db.close();}
});
test('successful full capture preserves unchanged R2 ordering/history/integrity and completion after all table bytes',async()=>{
 const db=new DatabaseSync(':memory:');try{db.exec("CREATE TABLE alpha(value TEXT);INSERT INTO alpha VALUES('a');CREATE TABLE d1_migrations(name TEXT);INSERT INTO d1_migrations VALUES('0020_fixture.sql')");const events=[],stored=new Map();
  const result=await runBackup({DB:adapter(db),BACKUPS:{async head(){events.push('head');return null;},async put(key,payload){events.push(key.endsWith('manifest.json')?'manifest':'table');stored.set(key,JSON.parse(payload));},async list(){events.push('prune');return {objects:[],truncated:false};}}},{now:new Date('2026-10-16T03:00:00Z')});
  assert.deepEqual(events,['head','table','table','manifest','prune']);assert.equal(result.manifest.latest_migration,'0020_fixture.sql');assert.equal(result.manifest.snapshot.mechanism,'d1-bounded-typed-read-batch-v2');assert.equal(result.manifest.total_rows,2);assert.deepEqual(stored.get('legacy-hub/2026-10-16/alpha.json'),[{value:'a'}]);
 }finally{db.close();}
});
