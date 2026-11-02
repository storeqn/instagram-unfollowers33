const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../core');
const fixture=name=>require('./fixtures/'+name+'.json');
const row=(value,href)=>({title:'Display Name',string_list_data:[{value,href}]});

test('official export structures: arrays, wrapped lists, href-only following, multiple parts',()=>{
  const f1=C.extract(fixture('followers_1'),'followers'),f2=C.extract(fixture('followers_2'),'followers');
  const following=C.extract(fixture('following'),'following');
  assert.deepEqual(f1.users,['alice.one','bob_two']);
  assert.deepEqual(f2.users,['alice.one','carol.three']);
  assert.deepEqual(following.users,['alice.one','bob_two','dave._four','erin_five']);
  const s=C.merge(C.initial(),[...new Set([...f1.users,...f2.users])],following.users);
  assert.deepEqual(s.accounts,['dave._four','erin_five']);
  assert.deepEqual(s.counts,{followers:3,following:4});
});
test('root cause regression: conflicting value/href is quarantined, not value-first',()=>{
  const result=C.extract([row('wrong_account','https://www.instagram.com/correct_account/'),row('safe','https://instagram.com/safe/')],'following');
  assert.deepEqual(result.users,['safe']);assert.equal(result.diagnostics.conflicts,1);
});
test('never treats title/display name or numerical ID as identity',()=>{
  const result=C.extract([{title:'valid_looking_display_name'},row('123456789','https://instagram.com/real_name/'),row(undefined,'https://instagram.com/123456789/')],'followers');
  assert.deepEqual(result.users,[]);assert.equal(result.ignored,3);
  assert.deepEqual(C.extract([{title:'wrong_display',string_list_data:[{href:'https://instagram.com/real_name/'}]}],'following').users,['real_name']);
});
test('all entries are checked, including conflicts after the first valid item',()=>{
  assert.deepEqual(C.extract([{string_list_data:[{value:'alice'},{value:'bob'}]}],'followers').users,[]);
  assert.deepEqual(C.extract([{string_list_data:[{}, {value:'alice',href:'https://instagram.com/alice/'}]}],'followers').users,['alice']);
  assert.deepEqual(C.extract([{string_list_data:[{value:'alice'}, {value:'bad name'}]}],'followers').users,[]);
});
test('invalid and non-profile URLs cannot supply identities or become navigation URLs',()=>{
  for(const href of ['http://instagram.com/alice/','https://evil.test/alice/','https://instagram.com.evil.test/alice/','https://u:p@instagram.com/alice/','https://instagram.com:444/alice/','https://instagram.com/p/abc/','https://instagram.com/stories/alice/1','https://instagram.com/_u/alice/extra','https://instagram.com//alice/','https://instagram.com/alice%2Fbob/','javascript:alert(1)','https://instagram.com/accounts/']){
    assert.equal(C.fromHref(href),'',href);
    assert.deepEqual(C.extract([row('alice',href)],'following').users,[],href);
  }
  assert.equal(C.fromHref('https://www.instagram.com/_u/Alice.One/?x=1#ignored'),'alice.one');
});
test('normalization never deletes internal characters to invent a different name',()=>{
  assert.equal(C.username(' \u200f@Alice.One\u200f '),'alice.one');
  for(const value of ['a b','a/b','a\u200fb','..foo','foo..bar','.foo','foo.',123,'<script>'])assert.equal(C.username(value),'');
  assert.equal(C.username('__proto__'),'__proto__');
  assert.equal(C.username('bob_two'),'bob_two');
});
test('canonical profile URL always matches exactly its displayed username',()=>{
  for(const name of ['alice.one','bob_two','dave._four','__proto__']){
    assert.equal(C.profile(name),'https://www.instagram.com/'+name+'/');
    assert.equal(C.matchesProfile(name,C.profile(name)),true);
    assert.equal(C.matchesProfile(name,C.profile('other_name')),false);
  }
  assert.throws(()=>C.profile('Alice'));assert.throws(()=>C.profile('123456'));assert.throws(()=>C.profile('a/b'));
});
test('duplicates, missing, invalid and optional explicit total counts reconcile',()=>{
  const result=C.extract({total_count:99,relationships_following:[row('ALICE'),row('alice'),{},row('bad name') ]},'following');
  assert.deepEqual(result.users,['alice']);
  assert.equal(result.diagnostics.duplicates,1);assert.equal(result.diagnostics.missing,1);assert.equal(result.diagnostics.invalid,1);assert.equal(result.diagnostics.countMismatch,1);
  assert.equal(result.diagnostics.rows,result.diagnostics.validRows+result.ignored);
  assert.equal(result.diagnostics.unique,result.diagnostics.validRows-result.diagnostics.duplicates);
  assert.throws(()=>C.extract({foo:[]},'followers'));assert.deepEqual(C.extract([],'followers').users,[]);
});
test('legacy review history and current survive migration, reload and new import',()=>{
  const s={...C.initial(),accounts:['bob','carol','12345'],current:'carol',records:{bob:{status:'kept',at:'2026-10-31T10:00:00Z'},'12345':{status:'unfollowed',at:'2026-10-31T10:00:00Z'}},counts:{followers:1,following:4}};
  let restored=C.validate(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(restored.accounts,s.accounts);assert.equal(restored.current,'carol');
  assert.equal(C.diagnose(restored).legacyImport,true);
  restored=C.merge(restored,['alice'],['alice','carol','dave']);
  assert.equal(restored.records.bob.status,'kept');assert.equal(restored.records['12345'].status,'unfollowed');assert.equal(restored.current,'carol');
});
test('review selection skips completed accounts only after explicit decisions, no repeat',()=>{
  const s={...C.initial(),accounts:['alice','bob','carol'],current:'alice'};
  s.records.alice={status:'reviewed',at:null};assert.equal(C.nextPending(s),'bob');
  s.current='bob';s.records.bob={status:'skipped',at:null};assert.equal(C.nextPending(s),'carol');
  s.current='carol';s.records.carol={status:'kept',at:null};assert.equal(C.nextPending(s),null);
});
test('diagnostics flag stale imports without treating relationship timestamps as export dates',()=>{
  const s=C.merge(C.initial(),[],['alice']);s.importedAt='2020-01-01T00:00:00Z';
  s.importMeta={parserVersion:2,followers:{...C.emptyStats(),unique:0},following:{...C.emptyStats(),unique:2}};
  const d=C.diagnose(s);assert.equal(d.oldImport,true);assert.equal(d.countsMismatch,true);
  const roundTrip=C.validate(JSON.parse(JSON.stringify(s)));assert.equal(roundTrip.importMeta.parserVersion,2);
  assert.equal(C.extract([row('alice')],'followers').diagnostics.oldFiles,0);
});
test('backup rejects invalid statuses, invalid dates; prototype names are safe keys',()=>{
  const s=C.initial();s.records.alice={status:'oops',at:null};assert.throws(()=>C.validate(s));
  s.records.alice={status:'kept',at:'invalid'};assert.throws(()=>C.validate(s));
  const safe=C.validate(JSON.parse('{"version":1,"accounts":["__proto__"],"records":{"__proto__":{"status":"kept","at":null}}}'));
  assert.equal(Object.getPrototypeOf(safe.records),null);assert.equal(safe.records.__proto__.status,'kept');
});
test('ten thousand accounts compare without duplicates',()=>{
  const following=Array.from({length:10000},(_,i)=>'user'+i);
  assert.equal(C.merge(C.initial(),following.slice(0,4000),following.concat(following)).accounts.length,6000);
});
