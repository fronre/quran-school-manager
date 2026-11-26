// THROWAWAY S2b: backup while writing + kill mid-write recovery
const { spawn } = require('child_process'); const fs=require('fs'), path=require('path');
const Database=require('better-sqlite3');
const f=path.join(__dirname,'out','crash.db');
for (const x of fs.readdirSync('out')) if (/^crash|^bk/.test(x)) fs.rmSync(path.join('out',x));
if (process.argv[2]==='writer') {
  const db=new Database(f); db.pragma('journal_mode=WAL'); db.pragma('synchronous=FULL');
  db.exec('CREATE TABLE IF NOT EXISTS t(i INTEGER PRIMARY KEY, v TEXT NOT NULL) STRICT');
  const ins=db.prepare('INSERT INTO t(v) VALUES (?)'); let n=0;
  setInterval(()=>{ db.transaction(()=>{for(let k=0;k<50;k++)ins.run('سجل '+(n++));})(); process.stdout.write(n+'\n'); },1);
} else {
  const p=spawn(process.execPath,[__filename,'writer']); let last=0; p.stdout.on('data',d=>last=+String(d).trim().split('\n').pop());
  setTimeout(async()=>{
    const r=new Database(f,{readonly:false}); // second connection while writer active
    await r.backup(path.join('out','bk.db')); r.close();
    const b=new Database(path.join('out','bk.db'),{readonly:true});
    console.log('backup-during-writes:',b.pragma('integrity_check',{simple:true}),'rows',b.prepare('select count(*) c from t').get().c); b.close();
    setTimeout(()=>{ p.kill('SIGKILL'); setTimeout(()=>{
      const d=new Database(f); const c=d.prepare('select count(*) c from t').get().c;
      console.log('after-kill:',d.pragma('integrity_check',{simple:true}),'rows',c,'last-reported',last,'committed-lost',last-c); d.close();},500);},700);
  },1500);
}
