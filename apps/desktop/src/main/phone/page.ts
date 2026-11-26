/** The single page a phone loads (mobile-first, Arabic, right-to-left, no external files, no frameworks). Everything the server returns is written with textContent, never innerHTML. */
export function phonePage(nonce: string): string {
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#064E3B"><title>الشهاب</title>
<style nonce="${nonce}">
:root{--em:#064E3B;--deep:#003527;--brass:#8A6A2B;--ivory:#F4F5F0;--ink:#0F172A;--ink2:#334155;--line:#D5D9CC;--ok:#166534;--okt:#E6F2EA;--warn:#92400E;--warnt:#FBF0E1;--bad:#B42318;--badt:#FBEAE8;--teal:#0F766E;--tealt:#E1F0EE}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--ivory);color:var(--ink);font:17px/1.6 "Noto Sans Arabic","Segoe UI",Tahoma,system-ui,sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--deep);color:#fff;padding:12px 16px;display:flex;align-items:center;gap:12px}
header h1{margin:0;font-size:18px;flex:1}header button{background:transparent;color:#fff;border:1px solid #fff5;border-radius:8px;padding:6px 12px;font:inherit}
main{padding:16px 16px 96px;max-width:640px;margin:0 auto}
h2{font-size:18px;color:var(--em);margin:18px 0 8px}
.card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:10px 0}
button.row,a.row{display:flex;width:100%;text-align:start;gap:8px;align-items:center;justify-content:space-between;background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px;margin:8px 0;font:inherit;color:inherit;min-height:56px}
.btn{min-height:48px;border-radius:10px;border:1px solid var(--em);background:#fff;color:var(--em);padding:0 16px;font:inherit;font-weight:600}.btn.primary{background:var(--em);color:#fff}.btn:disabled{opacity:.45}
input,select,textarea{width:100%;min-height:48px;border:1px solid #8a948a;border-radius:10px;padding:8px 12px;font:inherit;background:#fff;color:var(--ink)}
label{display:block;font-weight:600;margin:12px 0 4px}
.muted{color:var(--ink2);font-size:15px}.err{background:var(--badt);color:var(--bad);border-radius:10px;padding:10px 12px;margin:10px 0}.info{background:var(--tealt);color:var(--teal);border-radius:10px;padding:10px 12px;margin:10px 0}
.pill{display:inline-block;border-radius:99px;padding:0 10px;font-size:14px;font-weight:600}.p-done{background:var(--okt);color:var(--ok)}.p-part{background:var(--warnt);color:var(--warn)}.p-none{background:var(--warnt);color:var(--warn)}.p-can{background:#eee;color:var(--ink2)}
.st{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:8px}.st button{min-height:46px;border:1px solid var(--line);border-radius:8px;background:#fff;font:inherit;font-size:15px}
.st button[aria-pressed=true].present{background:var(--okt);color:var(--ok);border-color:var(--ok)}.st button[aria-pressed=true].late{background:var(--warnt);color:var(--warn);border-color:var(--warn)}
.st button[aria-pressed=true].absent{background:var(--badt);color:var(--bad);border-color:var(--bad)}.st button[aria-pressed=true].excused{background:var(--tealt);color:var(--teal);border-color:var(--teal)}
.bar{position:fixed;inset-inline:0;bottom:0;background:#fff;border-top:1px solid var(--line);padding:10px 16px calc(10px + env(safe-area-inset-bottom));display:flex;gap:10px}.bar .btn{flex:1}
.num{direction:ltr;unicode-bidi:isolate;display:inline-block}.rec{display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--line)}.rec.v{text-decoration:line-through;color:var(--ink2)}
.tabs{display:flex;gap:8px;margin:8px 0}.tabs button{flex:1;min-height:46px;border-radius:10px;border:1px solid var(--line);background:#fff;font:inherit}.tabs button[aria-selected=true]{background:var(--em);color:#fff;border-color:var(--em)}
.sum{display:flex;flex-wrap:wrap;gap:16px;margin:8px 0}.sum b{display:block;font-size:24px;color:var(--em);line-height:1.2}
</style></head><body>
<header><h1 id="title">الشهاب</h1><button id="out" hidden>خروج</button></header>
<main id="app" aria-live="polite"></main>
<script nonce="${nonce}">
(function(){
'use strict';
var app=document.getElementById('app'),title=document.getElementById('title'),outBtn=document.getElementById('out');
var TOKEN=null;try{TOKEN=localStorage.getItem('mishkat_phone_token')}catch(e){}
var ME=null,QURAN=null,STATUS={present:'حاضر',late:'متأخر',absent:'غائب',excused:'بعذر'},ORDER=['present','late','absent','excused'];
var ERR={bad_code:'الرمز غير صحيح أو انتهت صلاحيته. اطلبوا رمزاً جديداً من الحاسوب.',name_required:'اكتبوا اسم هذا الهاتف.',too_many_attempts:'محاولات كثيرة. انتظروا خمس دقائق.',future_date:'لا يمكن تسجيل يوم لم يأتِ بعد.',outside_year:'هذا التاريخ خارج العام الدراسي.',group_closed:'الفوج مغلق.',cancelled:'هذا اليوم مُعلَّم «بلا حصة».',already_recorded:'سُجّل حضور بعض الطلاب من قبل. أعيدوا فتح الورقة.',not_enrolled:'بعض الطلاب لم يكونوا في الفوج في ذلك اليوم.',forbidden:'لا صلاحية لهذا الإجراء.',not_found:'غير متاح.',invalid:'راجعوا البيانات.',invalid_range:'المدى غير صحيح: تأكدوا من الآيتين وأن البداية قبل النهاية.',eval_required:'التقدير مطلوب للحفظ الجديد.',not_enrolled_memo:'الطالب لم يكن في فوج في هذا التاريخ.'};
function el(t,a,k){var e=document.createElement(t);if(a)for(var x in a){if(x==='text')e.textContent=a[x];else if(x==='class')e.className=a[x];else if(x.slice(0,2)==='on')e.addEventListener(x.slice(2),a[x]);else e.setAttribute(x,a[x])}(k||[]).forEach(function(c){if(c!=null)e.appendChild(typeof c==='string'?document.createTextNode(c):c)});return e}
function clear(n){while(n.firstChild)n.removeChild(n.firstChild)}
function msg(c,t){return el('div',{class:c,text:t,role:'alert'})}
function today(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function api(method,path,body){return fetch(path,{method:method,headers:Object.assign({'Content-Type':'application/json'},TOKEN?{Authorization:'Bearer '+TOKEN}:{}),body:body?JSON.stringify(body):undefined}).then(function(r){return r.json().then(function(j){return{status:r.status,body:j}})}).catch(function(){return{status:0,body:{error:'network'}}})}
function errText(j){var e=j&&j.error;return ERR[e]||(e==='network'?'تعذّر الاتصال بالحاسوب. تأكدوا أنه يعمل وأنكم على شبكة الواي فاي نفسها.':'تعذّر تنفيذ الإجراء.')}
function signOut(){try{localStorage.removeItem('mishkat_phone_token')}catch(e){}TOKEN=null;ME=null;pairView()}
outBtn.addEventListener('click',signOut);

function pairView(msgText){title.textContent='الشهاب';outBtn.hidden=true;clear(app);
 var code=el('input',{id:'code',inputmode:'numeric',autocomplete:'one-time-code',maxlength:'6',placeholder:'••••••'});var name=el('input',{id:'dev',maxlength:'40',placeholder:'مثال: هاتف الأستاذ أحمد'});
 var go=el('button',{class:'btn primary',text:'ربط هذا الهاتف',onclick:function(){go.disabled=true;api('POST','/api/pair',{code:code.value,name:name.value}).then(function(r){go.disabled=false;if(r.status===200){TOKEN=r.body.token;try{localStorage.setItem('mishkat_phone_token',TOKEN)}catch(e){}boot()}else pairView(errText(r.body))})}});
 app.appendChild(el('h2',{text:'ربط الهاتف بالحاسوب'}));app.appendChild(el('p',{class:'muted',text:'في برنامج الشهاب على الحاسوب: الإعدادات ← نسخة الهاتف ← «رمز ربط جديد». اكتبوا الرمز هنا. يصلح مرة واحدة لدقائق قليلة.'}));
 if(msgText)app.appendChild(msg('err',msgText));app.appendChild(el('label',{for:'code',text:'الرمز (6 أرقام)'}));app.appendChild(code);app.appendChild(el('label',{for:'dev',text:'اسم هذا الهاتف'}));app.appendChild(name);app.appendChild(el('p',null,[go]))}

function boot(){api('GET','/api/me').then(function(r){if(r.status===401){signOut();return}if(r.status!==200){clear(app);app.appendChild(msg('err',errText(r.body)));return}ME=r.body;homeView()})}

function homeView(){title.textContent=ME.association||'الشهاب';outBtn.hidden=false;clear(app);
 app.appendChild(el('p',{class:'muted',text:ME.device.name+' — '+ME.branches.map(function(b){return b.name}).join('، ')}));
 app.appendChild(el('div',{class:'tabs'},[el('button',{id:'t1','aria-selected':'true',text:'الحضور'}),el('button',{id:'t2','aria-selected':'false',text:'الطلاب والحفظ'})]));
 var body=el('div',null);app.appendChild(body);var t1=document.getElementById('t1'),t2=document.getElementById('t2');
 function sel(a){t1.setAttribute('aria-selected',a===1);t2.setAttribute('aria-selected',a===2);a===1?groupsView(body):studentsView(body)}
 t1.addEventListener('click',function(){sel(1)});t2.addEventListener('click',function(){sel(2)});sel(1)}

function groupsView(body){clear(body);body.appendChild(el('p',{class:'muted',text:'جارٍ التحميل…'}));
 api('GET','/api/groups').then(function(r){clear(body);if(r.status!==200){body.appendChild(msg('err',errText(r.body)));return}
  body.appendChild(el('h2',{text:'اليوم '+r.body.today}));var any=false;
  r.body.groups.forEach(function(g){any=true;var st=g.state==='done'?['سُجّل الحضور','p-done']:g.state==='partial'?['ناقص: '+g.recorded+' من '+g.members,'p-part']:g.state==='cancelled'?['بلا حصة','p-can']:['لم يُسجَّل بعد','p-none'];
   body.appendChild(el('button',{class:'row',onclick:function(){sheetView(g.groupId,r.body.today)}},[el('span',null,[el('b',{text:g.groupName}),el('br'),el('span',{class:'muted',text:g.branchName+' — '+g.members+' طالباً'})]),el('span',{class:'pill '+st[1],text:st[0]})]))});
  if(!any)body.appendChild(el('p',{class:'muted',text:'لا أفواج فيها طلاب اليوم.'}))})}

function sheetView(gid,date){clear(app);title.textContent='ورقة الحضور';outBtn.hidden=true;
 var back=el('button',{class:'btn',text:'← رجوع',onclick:function(){homeView()}});var d=el('input',{type:'date',value:date,max:today()});d.addEventListener('change',function(){if(d.value)sheetView(gid,d.value)});
 app.appendChild(el('p',null,[back]));app.appendChild(d);var box=el('div',null,[el('p',{class:'muted',text:'جارٍ التحميل…'})]);app.appendChild(box);
 api('GET','/api/sheet?group='+encodeURIComponent(gid)+'&date='+encodeURIComponent(date)).then(function(r){clear(box);if(r.status!==200){box.appendChild(msg('err',errText(r.body)));return}var s=r.body;
  box.appendChild(el('h2',{text:s.group.name+' — '+s.group.branchName}));
  if(s.session&&s.session.status==='cancelled')box.appendChild(msg('info','يوم بلا حصة: '+(s.session.cancelReason||'')));
  if(s.group.status==='closed')box.appendChild(msg('info','الفوج مغلق.'));
  if(!s.rows.length){box.appendChild(el('p',{class:'muted',text:'لا طلاب في هذا اليوم.'}));return}
  var draft={};var open=s.rows.filter(function(x){return!x.recorded});var canSave=!(s.session&&s.session.status==='cancelled')&&s.group.status!=='closed'&&open.length>0;
  var save=el('button',{class:'btn primary',text:'حفظ الحضور',disabled:'disabled'});var allB=el('button',{class:'btn',text:'الكل حاضر'});
  function refresh(){var left=open.filter(function(x){return!draft[x.studentId]||!draft[x.studentId].status}).length;save.disabled=left>0;save.textContent=left>0?'بقي '+left+' بلا تحديد':'حفظ الحضور';allB.disabled=left===0}
  s.rows.forEach(function(row){var c=el('div',{class:'card'});c.appendChild(el('div',null,[el('b',{text:row.name}),' ',el('span',{class:'muted num',text:row.studentNo})]));
   if(row.recorded){c.appendChild(el('div',{class:'pill '+(row.status==='present'?'p-done':row.status==='absent'?'p-none':'p-part'),text:STATUS[row.status]+(row.status==='late'&&row.lateMinutes?' '+row.lateMinutes+' د':'')}));box.appendChild(c);return}
   if(!canSave){c.appendChild(el('span',{class:'muted',text:'لم يُسجَّل'}));box.appendChild(c);return}
   var late=el('input',{inputmode:'numeric',placeholder:'دقائق التأخر',hidden:'hidden',maxlength:'3'});late.addEventListener('input',function(){late.value=late.value.replace(/\\D/g,'').slice(0,3);draft[row.studentId].late=late.value});
   var g=el('div',{class:'st',role:'group'});ORDER.forEach(function(k){var b=el('button',{class:k,'aria-pressed':'false',text:STATUS[k]});b.addEventListener('click',function(){draft[row.studentId]=draft[row.studentId]||{};draft[row.studentId].status=k;Array.prototype.forEach.call(g.children,function(x){x.setAttribute('aria-pressed',x===b)});late.hidden=k!=='late';refresh()});g.appendChild(b)});
   c.appendChild(g);c.appendChild(late);box.appendChild(c)});
  if(canSave){var times={s:'16:00',e:'17:00'};
   if(!s.session){box.appendChild(el('div',{class:'card'},[el('b',{text:'وقت الحصة'}),el('label',{for:'ts',text:'من'}),el('input',{id:'ts',type:'time',value:times.s,onchange:function(e){times.s=e.target.value}}),el('label',{for:'te',text:'إلى'}),el('input',{id:'te',type:'time',value:times.e,onchange:function(e){times.e=e.target.value}})]))}else{times.s=s.session.startTime;times.e=s.session.endTime}
   allB.addEventListener('click',function(){open.forEach(function(x){draft[x.studentId]=draft[x.studentId]||{};if(!draft[x.studentId].status)draft[x.studentId].status='present'});box.querySelectorAll('.st').forEach(function(g,i){var x=open[i];if(!x)return;Array.prototype.forEach.call(g.children,function(b){b.setAttribute('aria-pressed',draft[x.studentId].status===b.className)})});refresh()});
   save.addEventListener('click',function(){save.disabled=true;var entries=open.map(function(x){var dd=draft[x.studentId];return{studentId:x.studentId,status:dd.status,lateMinutes:dd.status==='late'&&dd.late?Number(dd.late):null}});
    api('POST','/api/attendance',{groupId:gid,date:date,startTime:times.s,endTime:times.e,entries:entries}).then(function(r){if(r.status===200){sheetView(gid,date)}else{save.disabled=false;var m=msg('err',errText(r.body));box.insertBefore(m,box.firstChild);window.scrollTo(0,0)}})});
   app.appendChild(el('div',{class:'bar'},[allB,save]));refresh()}})}

function studentsView(body){clear(body);var q=el('input',{type:'search',placeholder:'ابحثوا بالاسم أو الرقم'});var list=el('div',null);body.appendChild(q);body.appendChild(list);var timer=null;
 function run(){api('GET','/api/students?search='+encodeURIComponent(q.value)).then(function(r){clear(list);if(r.status!==200){list.appendChild(msg('err',errText(r.body)));return}
  r.body.rows.forEach(function(s){list.appendChild(el('button',{class:'row',onclick:function(){memoView(s)}},[el('span',null,[el('b',{text:s.name}),el('br'),el('span',{class:'muted',text:s.branchName})]),el('span',{class:'muted num',text:s.studentNo})]))});
  if(!r.body.rows.length)list.appendChild(el('p',{class:'muted',text:'لا نتائج.'}));else if(r.body.total>r.body.rows.length)list.appendChild(el('p',{class:'muted',text:'تظهر أول '+r.body.rows.length+' نتيجة. دقّقوا البحث.'}))})}
 q.addEventListener('input',function(){clearTimeout(timer);timer=setTimeout(run,250)});run()}

function memoView(s){clear(app);title.textContent=s.name;outBtn.hidden=true;app.appendChild(el('p',null,[el('button',{class:'btn',text:'← رجوع',onclick:function(){homeView()}})]));var box=el('div',null,[el('p',{class:'muted',text:'جارٍ التحميل…'})]);app.appendChild(box);
 Promise.all([QURAN?Promise.resolve({status:200,body:QURAN}):api('GET','/api/quran'),api('GET','/api/memo?student='+encodeURIComponent(s.id))]).then(function(rs){clear(box);if(rs[0].status!==200||rs[1].status!==200){box.appendChild(msg('err',errText(rs[1].body)));return}QURAN=rs[0].body;var m=rs[1].body;
  var sm=m.summary;box.appendChild(el('div',{class:'sum'},[el('div',null,[el('b',{class:'num',text:String(sm.memorizedAyat)}),'آية محفوظة']),el('div',null,[el('b',{class:'num',text:String(sm.wholeSurahs)}),'سورة كاملة']),el('div',null,[el('b',{class:'num',text:String(sm.counts.new)}),'حفظ جديد']),el('div',null,[el('b',{class:'num',text:String(sm.counts.revision)}),'مراجعة'])]));
  var tn={new:'حفظ جديد',revision:'مراجعة',consolidation:'تثبيت'};box.appendChild(el('h2',{text:'آخر السجلات'}));m.records.forEach(function(r){box.appendChild(el('div',{class:'rec'+(r.voided?' v':'')},[el('span',null,[el('b',{text:tn[r.type]+' — '+r.rangeText}),el('br'),el('span',{class:'muted num',text:r.date})]),el('span',{text:r.evalLabel||'—'})]))});if(!m.records.length)box.appendChild(el('p',{class:'muted',text:'لا سجلات بعد.'}));
  box.appendChild(el('h2',{text:'تسجيل جديد'}));var f={type:'new',s1:1,a1:'',s2:1,a2:'',rank:String(QURAN.passRank+1),date:today()};var out=el('div',null);
  var type=el('select',null,QURAN.types.map(function(t){return el('option',{value:t,text:tn[t]})}));type.addEventListener('change',function(){f.type=type.value;rank.firstChild.hidden=f.type==='new'});
  function surahSel(k){var x=el('select',null,QURAN.surahs.map(function(z){return el('option',{value:String(z[0]),text:z[0]+'. '+z[1]})}));x.addEventListener('change',function(){f['s'+k]=Number(x.value);if(k===1&&f.a2===''){f.s2=f.s1;s2.value=String(f.s1)}});return x}
  var s1=surahSel(1),s2=surahSel(2);var a1=el('input',{inputmode:'numeric',placeholder:'رقم الآية',maxlength:'3'}),a2=el('input',{inputmode:'numeric',placeholder:'رقم الآية',maxlength:'3'});a1.addEventListener('input',function(){a1.value=a1.value.replace(/\\D/g,'');f.a1=a1.value});a2.addEventListener('input',function(){a2.value=a2.value.replace(/\\D/g,'');f.a2=a2.value});
  var rank=el('div',null,[el('div',null,[el('label',{text:'التقدير'}),el('select',null,[el('option',{value:'',text:'بلا تقدير'})].concat(QURAN.scale.map(function(z){return el('option',{value:String(z.rank),text:z.label})})))])]);var rsel=rank.querySelector('select');rsel.value=f.rank;rsel.addEventListener('change',function(){f.rank=rsel.value});
  var dt=el('input',{type:'date',value:f.date,max:today()});dt.addEventListener('change',function(){if(dt.value)f.date=dt.value});
  var go=el('button',{class:'btn primary',text:'حفظ السجل',onclick:function(){if(!f.a1||!f.a2){clear(out);out.appendChild(msg('err','اكتبوا رقمَي الآيتين.'));return}go.disabled=true;
   api('POST','/api/memo',{studentId:s.id,date:f.date,type:f.type,start:{surah:f.s1,ayah:Number(f.a1)},end:{surah:f.s2,ayah:Number(f.a2)},evalRank:f.rank===''?null:Number(f.rank)}).then(function(r){go.disabled=false;clear(out);if(r.status===200){memoView(s)}else out.appendChild(msg('err',(r.body.error==='not_enrolled'?ERR.not_enrolled_memo:errText(r.body))))})}});
  [el('label',{text:'النوع'}),type,el('label',{text:'من'}),s1,a1,el('label',{text:'إلى'}),s2,a2,rank,el('label',{text:'التاريخ'}),dt,out,el('p',null,[go])].forEach(function(n){box.appendChild(n)})})}

if(TOKEN)boot();else pairView();
})();
</script></body></html>`;
}
