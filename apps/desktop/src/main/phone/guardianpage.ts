/** The guardian page (prototype): the guardian types the phone number on file and the code the association handed over, then sees only their own children, read-only.
 *  Mobile-first, Arabic, right-to-left, no external files. Everything the server returns is written with textContent, never innerHTML. The session token is kept in memory only. */
export function guardianPage(nonce: string): string {
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#064E3B"><meta name="robots" content="noindex"><title>الشهاب — الأولياء</title>
<style nonce="${nonce}">
:root{--em:#064E3B;--deep:#003527;--brass:#8A6A2B;--ivory:#F4F5F0;--ink:#0F172A;--ink2:#334155;--line:#D5D9CC;--ok:#166534;--okt:#E6F2EA;--warn:#92400E;--warnt:#FBF0E1;--bad:#B42318;--badt:#FBEAE8;--teal:#0F766E;--tealt:#E1F0EE}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--ivory);color:var(--ink);font:17px/1.65 "Noto Sans Arabic","Segoe UI",Tahoma,system-ui,sans-serif}
header{background:var(--deep);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:12px}
header h1{margin:0;font-size:18px;flex:1}header button{background:transparent;color:#fff;border:1px solid #fff5;border-radius:8px;padding:6px 12px;font:inherit}
main{padding:16px 16px 48px;max-width:560px;margin:0 auto}
h2{font-size:18px;color:var(--em);margin:20px 0 8px}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:12px 0}
.card h3{margin:0 0 2px;font-size:20px;color:var(--deep)}
.btn{min-height:48px;border-radius:10px;border:1px solid var(--em);background:var(--em);color:#fff;padding:0 18px;font:inherit;font-weight:600;width:100%}.btn:disabled{opacity:.5}
input{width:100%;min-height:50px;border:1px solid #8a948a;border-radius:10px;padding:8px 12px;font:inherit;background:#fff;color:var(--ink);direction:ltr;text-align:center;letter-spacing:.06em}
label{display:block;font-weight:600;margin:14px 0 4px}
.muted{color:var(--ink2);font-size:15px}.err{background:var(--badt);color:var(--bad);border-radius:10px;padding:10px 12px;margin:12px 0}
.meter{height:12px;background:#E3E7DC;border-radius:99px;overflow:hidden;margin:10px 0 4px}.meter i{display:block;height:100%;background:var(--teal);border-radius:99px}
.big{font-size:28px;font-weight:700;color:var(--em);line-height:1.2}
.row3{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px;text-align:center}.row3 div{border-radius:10px;padding:6px 2px;font-size:14px}.row3 b{display:block;font-size:20px}
.a-p{background:var(--okt);color:var(--ok)}.a-l{background:var(--warnt);color:var(--warn)}.a-a{background:var(--badt);color:var(--bad)}.a-e{background:var(--tealt);color:var(--teal)}
.rec{display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--line);font-size:16px}.rec:last-child{border:0}
.num{direction:ltr;unicode-bidi:isolate;display:inline-block}
.note{font-size:14px;color:var(--ink2);margin-top:20px}
</style></head><body>
<header><h1 id="title">الشهاب</h1><button id="out" hidden>خروج</button></header>
<main id="app" aria-live="polite"></main>
<script nonce="${nonce}">
(function(){
'use strict';
var app=document.getElementById('app'),title=document.getElementById('title'),outBtn=document.getElementById('out');
var TOKEN=null,TYPE={new:'حفظ جديد',revision:'مراجعة',consolidation:'تثبيت'};
function el(t,a,k){var e=document.createElement(t);if(a)for(var x in a){if(x==='text')e.textContent=a[x];else if(x==='class')e.className=a[x];else if(x.slice(0,2)==='on')e.addEventListener(x.slice(2),a[x]);else e.setAttribute(x,a[x])}(k||[]).forEach(function(c){if(c!=null)e.appendChild(typeof c==='string'?document.createTextNode(c):c)});return e}
function clear(n){while(n.firstChild)n.removeChild(n.firstChild)}
function api(method,path,body){return fetch(path,{method:method,headers:Object.assign({'Content-Type':'application/json'},TOKEN?{Authorization:'Bearer '+TOKEN}:{}),body:body?JSON.stringify(body):undefined}).then(function(r){return r.json().then(function(j){return{status:r.status,body:j}})}).catch(function(){return{status:0,body:{error:'network'}}})}
function loginView(m){TOKEN=null;title.textContent='الشهاب';outBtn.hidden=true;clear(app);
 var phone=el('input',{id:'ph',inputmode:'tel',autocomplete:'tel',placeholder:'0550 12 34 56'});var code=el('input',{id:'cd',autocapitalize:'characters',autocomplete:'off',maxlength:'9',placeholder:'ABCD-EFGH'});
 var go=el('button',{class:'btn',text:'دخول',onclick:function(){go.disabled=true;api('POST','/api/g/login',{phone:phone.value,code:code.value}).then(function(r){go.disabled=false;
  if(r.status===200){TOKEN=r.body.token;code.value='';load()}else loginView(r.body.error==='bad_login'?'رقم الهاتف أو الرمز غير صحيح. تأكدوا من الرمز المكتوب على الورقة التي سلّمتها لكم الجمعية.':r.body.error==='locked'||r.body.error==='too_many_attempts'?'محاولات كثيرة. انتظروا قليلاً ثم أعيدوا المحاولة، أو اطلبوا رمزاً جديداً من الجمعية.':'تعذّر الاتصال. تأكدوا من الشبكة ثم أعيدوا المحاولة.')})}});
 app.appendChild(el('h2',{text:'متابعة ابنكم'}));app.appendChild(el('p',{class:'muted',text:'اكتبوا رقم الهاتف الذي سجّلتموه عند الجمعية، والرمز الذي سُلّم لكم.'}));
 if(m)app.appendChild(el('div',{class:'err',role:'alert',text:m}));
 app.appendChild(el('label',{for:'ph',text:'رقم الهاتف'}));app.appendChild(phone);app.appendChild(el('label',{for:'cd',text:'الرمز'}));app.appendChild(code);app.appendChild(el('p',null,[go]))}
function load(){clear(app);app.appendChild(el('p',{class:'muted',text:'جارٍ التحميل…'}));api('GET','/api/g/me').then(function(r){if(r.status===401){loginView('انتهت الجلسة. أدخلوا الرمز من جديد.');return}if(r.status!==200){loginView('تعذّر التحميل.');return}view(r.body)})}
function view(v){title.textContent=v.association||'الشهاب';outBtn.hidden=false;clear(app);
 app.appendChild(el('p',{class:'muted',text:'السلام عليكم '+v.guardianName}));
 if(!v.children.length)app.appendChild(el('p',{text:'لا يوجد طالب نشِط مرتبط برقمكم حالياً. تواصلوا مع الجمعية.'}));
 v.children.forEach(function(c){var pct=c.totalAyat?Math.max(c.memorizedAyat?1:0,Math.round(c.memorizedAyat/c.totalAyat*1000)/10):0;
  var card=el('div',{class:'card'});card.appendChild(el('h3',{text:c.name}));card.appendChild(el('div',{class:'muted',text:(c.groupName?c.groupName+' — ':'')+c.branchName}));
  card.appendChild(el('div',{class:'big num',text:c.memorizedAyat+' آية'}));
  card.appendChild(el('div',{class:'meter',role:'img','aria-label':'نسبة الحفظ '+pct+'٪'},[(function(){var b=el('i');b.style.width=pct+'%';return b})()]));
  card.appendChild(el('div',{class:'muted',text:'من '+c.totalAyat+' آية — '+c.wholeSurahs+' سورة كاملة'+(c.lastDate?' — آخر تسميع '+c.lastDate:'')}));
  card.appendChild(el('h2',{text:'الحضور'}));
  card.appendChild(el('div',{class:'row3'},[el('div',{class:'a-p'},[el('b',{class:'num',text:String(c.attendance.present)}),'حاضر']),el('div',{class:'a-l'},[el('b',{class:'num',text:String(c.attendance.late)}),'متأخر']),el('div',{class:'a-a'},[el('b',{class:'num',text:String(c.attendance.absent)}),'غائب']),el('div',{class:'a-e'},[el('b',{class:'num',text:String(c.attendance.excused)}),'بعذر'])]));
  card.appendChild(el('h2',{text:'آخر التسميع'}));
  if(!c.recent.length)card.appendChild(el('p',{class:'muted',text:'لا سجلات بعد.'}));
  c.recent.forEach(function(r){card.appendChild(el('div',{class:'rec'},[el('span',null,[el('b',{text:TYPE[r.type]+' — '+r.rangeText}),el('br'),el('span',{class:'muted num',text:r.date})]),el('span',{text:r.evalLabel||''})]))});
  app.appendChild(card)});
 app.appendChild(el('p',{class:'note',text:'هذه الصفحة للاطلاع فقط. لأي تصحيح أو استفسار تواصلوا مع الجمعية.'}))}
outBtn.addEventListener('click',function(){api('POST','/api/g/logout').then(function(){loginView()})});
loginView();
})();
</script></body></html>`;
}
