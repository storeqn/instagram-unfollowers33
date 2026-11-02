'use strict';
const C=ReviewCore,$=id=>document.getElementById(id),KEY='unfollowers-pro-v1';
let state=C.initial(),page=0,session=false,departure=null,hidden=false,installPrompt=null,storageBlocked=false;
const APP_VERSION='1.1.0';
let lastOpenCheck=null,lastAttemptDiagnostics=null;
const labels={pending:'لم تتم مراجعتها',reviewed:'تمت مراجعتها',unfollowed:'ألغيت متابعتها يدوياً',skipped:'تم تخطيها',kept:'الاحتفاظ بالمتابعة'};
function message(text){$('message').textContent=text;}
try{const raw=localStorage.getItem(KEY);if(raw)state=C.validate(JSON.parse(raw));}catch{storageBlocked=true;message('تعذّر قراءة الحفظ السابق. لم نستبدله. استورد نسخة احتياطية أو صدّر البيانات المتاحة قبل المتابعة.');}
function save(next=state){if(storageBlocked){message('الحفظ السابق غير قابل للقراءة. استورد نسخة احتياطية صالحة لاستعادة الحفظ دون استبداله بقائمة فارغة.');return false;}try{localStorage.setItem(KEY,JSON.stringify(next));state=next;return true;}catch{message('تعذّر الحفظ على الجهاز. قد تكون المساحة ممتلئة أو التخزين محظوراً. صدّر نسخة احتياطية قبل إغلاق الموقع.');return false;}}
function status(u){return state.records[u]?.status||'pending';}
function pending(){return state.accounts.filter(u=>status(u)==='pending');}
function select(u){if(!state.accounts.includes(u))return false;if(!save({...state,current:u}))return false;departure=null;hidden=false;render();return true;}
function nextPending(){return C.nextPending(state);}
function navigate(step){const i=state.accounts.indexOf(state.current),u=state.accounts[i+step];if(u)select(u);}
function render(){const accounts=state.accounts,done=accounts.filter(u=>status(u)!=='pending').length,skipped=accounts.filter(u=>status(u)==='skipped').length;
$('fc').textContent=state.counts.followers;$('fg').textContent=state.counts.following;$('nf').textContent=accounts.length;$('progressText').textContent=`${done} مكتملة · ${accounts.length-done} متبقية · ${skipped} متخطاة`;$('percent').textContent=accounts.length?Math.round(done/accounts.length*100)+'٪':'0٪';$('progress').max=accounts.length||1;$('progress').value=done;
const u=state.current;$('currentCard').hidden=!u;$('empty').hidden=!!u;$('start').disabled=!pending().length;$('start').textContent=session?'استئناف المراجعة':'بدء المراجعة';
if(u){$('position').textContent=`الحساب ${accounts.indexOf(u)+1} من ${accounts.length}`;$('username').textContent='@'+u;const r=state.records[u];$('recordDate').textContent=labels[status(u)]+(r?.at?' · '+new Date(r.at).toLocaleString('ar'):'');const href=C.username(u)?profile(u):'';for(const id of ['open','web']){const link=$(id);if(href)link.href=href;else link.removeAttribute('href');link.dataset.username=u;} $('open').textContent='فتح في Instagram';$('prev').disabled=accounts.indexOf(u)<=0;$('next').disabled=accounts.indexOf(u)>=accounts.length-1;}
renderList();renderDiagnostics();}
function renderList(){let list=state.accounts.filter(u=>u.includes($('search').value.trim().toLowerCase().replace(/^@/,'')));const f=$('filter').value;if(f!=='all')list=list.filter(u=>f==='done'?status(u)!=='pending':status(u)===f);const sort=$('sort').value;if(sort==='asc'||sort==='desc')list.sort((a,b)=>sort==='asc'?a.localeCompare(b):b.localeCompare(a));if(sort==='recent')list.sort((a,b)=>(state.records[b]?.at||'').localeCompare(state.records[a]?.at||''));const pages=Math.max(1,Math.ceil(list.length/50));page=Math.min(page,pages-1);$('listCount').textContent=`${list.length} حساب · عرض 50 حساباً كحد أقصى لكل صفحة`;$('pageInfo').textContent=`${page+1} / ${pages}`;$('pagePrev').disabled=page===0;$('pageNext').disabled=page>=pages-1;const frag=document.createDocumentFragment();for(const u of list.slice(page*50,page*50+50)){const li=document.createElement('li'),info=document.createElement('div'),name=document.createElement('b'),detail=document.createElement('small'),view=document.createElement('button');info.className='account';name.dir='ltr';name.textContent='@'+u;detail.textContent=labels[status(u)];info.append(name,detail);view.textContent='مراجعة';view.onclick=()=>{if(select(u))$('review').scrollIntoView({behavior:'smooth',block:'start'});};li.append(info,view);if(status(u)!=='pending'){const reset=document.createElement('button');reset.textContent='إعادة للقائمة';reset.onclick=()=>{save({...state,records:{...state.records,[u]:{status:'pending',at:null}}});render();};li.append(reset);}frag.append(li);}$('list').replaceChildren(frag);}
function profile(u){return C.profile(u);}
function parseProfileInput(value){const v=value.trim();return /^https?:\/\//i.test(v)?C.fromHref(v)||null:C.username(v)||null;}
function setMethod(method){const link=method==='link';$('linkMethod').hidden=!link;$('fileMethod').hidden=link;$('methodLink').classList.toggle('selected',link);$('methodFiles').classList.toggle('selected',!link);$('methodLink').setAttribute('aria-pressed',String(link));$('methodFiles').setAttribute('aria-pressed',String(!link));}
$('methodLink').onclick=()=>setMethod('link');$('methodFiles').onclick=()=>setMethod('files');$('checkProfile').onclick=()=>{const u=parseProfileInput($('profileUrl').value);if(!u){message('أدخل اسم مستخدم صحيحاً أو رابط حساب Instagram رسمي بصيغة https.');return;}message('تم التحقق من صيغة الرابط فقط. لا يمكن استخراج قوائم المتابعين من الرابط وحده؛ استخدم ملفات التصدير للمقارنة.');window.open(profile(u),'_blank','noopener,noreferrer');};
// Resolve exactly once from the rendered card and stored identity. Never reuse a
// departure URL or let lifecycle callbacks select another account.
function checkedTarget(id='open') {
  const name=state.current,link=$(id);
  const valid=!!name&&state.accounts.includes(name)&&!!C.username(name);
  const matches=valid&&$('username').textContent==='@'+name&&link.dataset.username===name&&C.matchesProfile(name,link.href);
  lastOpenCheck={validName:valid,displayAndLinkMatch:!!matches};
  if(!matches){message('تم منع الفتح: الاسم المعروض والرابط غير متطابقين. أعد اختيار الحساب أو أبلغ عن الرابط.');return null;}
  if(state.importMeta?.parserVersion!==C.PARSER_VERSION){message('هذه القائمة مستخرجة بالمحلّل السابق. أعد استيراد ملفات Instagram الحديثة للتحقق من الأسماء؛ سجل قراراتك سيبقى محفوظاً.');return null;}
  return {name,url:profile(name)};
}
function prepareOpen(id='open') {
  const target=checkedTarget(id);
  if(!target||!save())return null;
  departure={user:target.name,handled:false};hidden=false;
  return target;
}
function openProfile(){const target=prepareOpen();if(target)location.assign(target.url);}
$('open').onclick=e=>{e.preventDefault();openProfile();};
$('web').onclick=e=>{const target=prepareOpen('web');if(!target){e.preventDefault();return;} // Keep the native anchor gesture, with a freshly verified official URL.
  e.currentTarget.href=target.url;
};
$('start').onclick=()=>{const u=status(state.current)==='pending'?state.current:nextPending();if(!u)return;if(select(u)){session=true;openProfile();}};
function returnToSite(){
  if(!departure||departure.handled||!hidden)return;
  departure.handled=true;const previous=departure.user;departure=null;hidden=false;
  if(state.current!==previous)return;
  message('عدت إلى الحساب نفسه. لم يُسجّل أي قرار ولم يُفتح حساب آخر. اختر تمت المراجعة أو تخطي أو قرار المتابعة للانتقال.');
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)hidden=true;else returnToSite();});
window.addEventListener('pagehide',()=>{hidden=true;});window.addEventListener('pageshow',returnToSite);
document.querySelectorAll('[data-status]').forEach(button=>button.onclick=()=>{
  const u=state.current;if(!u)return;
  const nextState={...state,records:{...state.records,[u]:{status:button.dataset.status,at:new Date().toISOString()}}};
  const next=C.nextPending(nextState,u);
  if(!save({...nextState,current:next||u}))return;
  departure=null;hidden=false;render();
  message(next?'تم حفظ قرارك. الحساب التالي جاهز.':'اكتملت مراجعة القائمة. يمكنك إعادة أي حساب إلى المراجعة.');
  // This is a fresh user gesture, never an automatic navigation on return.
  if(next&&$('auto').checked)openProfile();
});
$('prev').onclick=()=>navigate(-1);$('next').onclick=()=>navigate(1);
for(const id of ['search','filter','sort'])$(id).addEventListener(id==='search'?'input':'change',()=>{page=0;renderList();});$('pagePrev').onclick=()=>{page--;renderList();};$('pageNext').onclick=()=>{page++;renderList();};
async function readFiles(files,kind){
  if(!files.length)throw Error('اختر ملفات المتابعين والمتابَعين أولاً.');
  const users=new Set(),diagnostics=C.emptyStats();
  for(const file of files){
    if(file.size>50*1024*1024)throw Error('الملف أكبر من 50 ميغابايت. استخدم أجزاء التصدير الأصغر.');
    let data;try{data=JSON.parse(await file.text());}catch{throw Error('ملف JSON غير صالح. اختر ملف التصدير الرسمي.');}
    const result=C.extract(data,kind);
    for(const key of Object.keys(diagnostics))if(key!=='unique')diagnostics[key]+=result.diagnostics[key];
    for(const u of result.users){if(users.has(u))diagnostics.duplicates++;users.add(u);}
    // File modification dates are only a heuristic; relationship timestamps are
    // NOT export dates and must not trigger stale-export claims.
    if(file.lastModified>0&&Date.now()-file.lastModified>30*86400000)diagnostics.oldFiles++;
  }
  diagnostics.unique=users.size;
  if(diagnostics.unique!==diagnostics.validRows-diagnostics.duplicates)diagnostics.countMismatch++;
  return {users:[...users],diagnostics};
}
$('analyze').onclick=async()=>{
  $('analyze').disabled=true;
  try{
    const followers=await readFiles($('followers').files,'followers'),following=await readFiles($('following').files,'following');
    lastAttemptDiagnostics={followers:followers.diagnostics,following:following.diagnostics};
    if([followers,following].some(result=>result.diagnostics.rows&&!result.users.length))throw Error('لم نجد أسماء موثوقة في أحد الملفين. لم نغيّر قائمتك أو سجلك. افحص ملخص التحقق واختر تصديراً حديثاً.');
    const next={...C.merge(state,followers.users,following.users),importMeta:{parserVersion:C.PARSER_VERSION,...lastAttemptDiagnostics}};
    if(!save(next))return;
    session=false;departure=null;hidden=false;page=0;render();
    const partial=[followers,following].some(r=>r.diagnostics.missing+r.diagnostics.invalid+r.diagnostics.conflicts>0);
    message(`${partial?'نتائج جزئية: استُبعدت سجلات غير موثوقة؛ قد تتأثر دقة المقارنة.':'اكتمل التحليل محلياً.'} ${state.accounts.length} حساب لا يتابعك حسب البيانات الصالحة. راجع ملخص التحقق.`);
  }catch(e){message(e.message);renderDiagnostics();}finally{$('analyze').disabled=false;}
};
function renderDiagnostics(){
  const d=C.diagnose(state),parts=[];
  if(d.legacyImport)parts.push('القائمة محفوظة بالمحلّل السابق: أعد استيراد الملفات قبل الفتح، مع بقاء القرارات.');
  if(d.invalidNames||d.duplicateAccounts)parts.push(`قائمة محفوظة: ${d.invalidNames} اسم غير صالح، ${d.duplicateAccounts} تكرار.`);
  if(d.oldImport)parts.push('مرّ أكثر من 30 يوماً على الاستيراد؛ يُنصح بتصدير بيانات حديثة.');
  if(d.countsMismatch)parts.push('يوجد اختلاف في أعداد البيانات. أعد الاستيراد وتأكد من جميع أجزاء المتابعين.');
  const stats=lastAttemptDiagnostics||state.importMeta;
  if(lastAttemptDiagnostics)parts.push('ملخص آخر محاولة استيراد؛ إذا رُفضت فلا يمثل القائمة المحفوظة.');
  for(const [kind,label] of [['followers','المتابعون'],['following','المتابَعون']]){
    const v=stats?.[kind];if(!v)continue;
    parts.push(`${label}: ${v.files} ملفات، ${v.rows} سجلات، ${v.unique} أسماء فريدة، ${v.duplicates} تكرار، ${v.missing} ناقصة، ${v.invalid} غير صالحة، ${v.conflicts} متعارضة، ${v.invalidLinks} روابط غير صالحة.`);
    if(v.countMismatch)parts.push(`${label}: عدد السجلات لا يطابق العدد المعلن أو المحسوب.`);
    if(v.oldFiles)parts.push(`${label}: ${v.oldFiles} ملفات بتاريخ تعديل أقدم من 30 يوماً؛ التاريخ مؤشر غير مؤكد لعمر التصدير.`);
  }
  parts.push('الأعداد تخص الأسماء الصالحة الفريدة في الملفات المختارة، ولا تثبت اكتمال جميع الأجزاء أو تطابق عدد Instagram الحالي. تواريخ المتابعة ليست تاريخ التصدير.');
  $('diagnostics').textContent=parts.join('\n');
}
function diagnosticReport(){
  return JSON.stringify({app:'Instagram Unfollowers Pro',version:APP_VERSION,...C.diagnose(state),currentLinkMatches:!!state.current&&C.matchesProfile(state.current,$('open').href),currentDisplayMatches:!!state.current&&$('username').textContent==='@'+state.current,lastOpenCheck,lastImportAttempt:lastAttemptDiagnostics,externalAppVerified:false},null,2);
}
async function copyText(text,title){
  try{if(!navigator.clipboard?.writeText)throw Error('unavailable');await navigator.clipboard.writeText(text);message(title+' — تم النسخ.');}
  catch{$('copyTitle').textContent=title;$('copyText').value=text;$('copyDialog').showModal();$('copyText').focus();$('copyText').select();$('copyText').setSelectionRange(0,text.length);}
}
$('copyUsername').onclick=()=>{const name=C.username(state.current);if(!name){message('اسم مستخدم غير صالح.');return;}copyText(name,'نسخ اسم المستخدم');};
$('reportLink').onclick=()=>copyText(diagnosticReport(),'تشخيص الرابط (دون أسماء أو روابط أو ملفات شخصية)');
$('closeCopy').onclick=()=>$('copyDialog').close();
$('export').onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='unfollowers-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('backup').onchange=async()=>{const file=$('backup').files[0];if(!file)return;try{if(file.size>50*1024*1024)throw Error('النسخة الاحتياطية كبيرة جداً.');const incoming=C.validate(JSON.parse(await file.text()));const records=Object.assign(Object.create(null),state.records);for(const [u,r] of Object.entries(incoming.records)){if(!records[u]||(r.at||'')>(records[u].at||''))records[u]=r;}const base=state.importedAt?state:incoming;storageBlocked=false;if(save({...base,records})){session=false;departure=null;render();message('تم دمج النسخة الاحتياطية مع الاحتفاظ بأحدث قرار لكل حساب.');}}catch(e){message('تعذّر استيراد النسخة الاحتياطية: '+e.message);}finally{$('backup').value='';}};
window.addEventListener('storage',e=>{if(e.key===KEY&&e.newValue){try{state=C.validate(JSON.parse(e.newValue));session=false;departure=null;render();message('تم تحديث التقدم من نافذة أخرى.');}catch{message('تعذّر قراءة التحديث من النافذة الأخرى.');}}});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});$('install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;}else $('installDialog').showModal();};$('closeInstall').onclick=()=>$('installDialog').close();
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>message('تعذّر تجهيز العمل دون اتصال. يمكنك الاستمرار متصلاً بالإنترنت.'));
render();
