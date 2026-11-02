const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const BASE=process.env.TEST_BASE_URL||'http://127.0.0.1:8000';
const KEY='unfollowers-pro-v1';
const file=(name,data)=>({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
const fixture=name=>path.join(__dirname,'fixtures',name+'.json');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844}});
    const page=await context.newPage(),errors=[],opened=[];
    page.on('pageerror',e=>errors.push(e.message));
    await context.route('https://www.instagram.com/**',route=>{
      opened.push(route.request().url());
      return route.fulfill({contentType:'text/html',body:'<title>Local Instagram test double</title><p>Navigation captured locally. No request sent to Instagram.</p>'});
    });
    const snapshot=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
    async function checkCard(expected){
      assert.equal(await page.locator('#username').textContent(),'@'+expected);
      for(const id of ['open','web'])assert.equal(await page.locator('#'+id).getAttribute('href'),'https://www.instagram.com/'+expected+'/');
      assert.equal((await snapshot()).current,expected);
    }
    await page.goto(BASE);
    const legacy={version:1,accounts:['dave._four','erin_five'],current:'dave._four',records:{bob_two:{status:'kept',at:'2026-10-31T10:00:00Z'}},counts:{followers:3,following:4},importedAt:'2026-10-31T10:00:00Z'};
    await page.evaluate(([key,s])=>localStorage.setItem(key,JSON.stringify(s)),[KEY,legacy]);
    await page.reload();await checkCard('dave._four');
    await page.click('#open');assert.equal(opened.length,0);
    assert.match(await page.locator('#message').textContent(),/المحلّل السابق/);
    assert.equal((await snapshot()).records.bob_two.status,'kept');

    await page.locator('#followers').setInputFiles([fixture('followers_1'),fixture('followers_2')]);
    await page.locator('#following').setInputFiles(fixture('following'));
    await page.click('#analyze');
    await page.waitForFunction(()=>document.querySelector('#nf').textContent==='2');
    assert.equal(await page.locator('#fc').textContent(),'3');
    assert.equal(await page.locator('#fg').textContent(),'4');
    assert.match(await page.locator('#diagnostics').textContent(),/1 تكرار/);
    await checkCard('dave._four');assert.equal((await snapshot()).records.bob_two.status,'kept');

    // Actual anchor/start navigation, intercepted before reaching Instagram.
    await page.click('#start');await page.waitForURL('https://www.instagram.com/dave._four/');
    assert.deepEqual(opened,['https://www.instagram.com/dave._four/']);
    await page.goBack();await page.waitForSelector('#username');await checkCard('dave._four');
    assert.equal((await snapshot()).records['dave._four'],undefined);

    // Both visibility and BFCache lifecycle paths must be idempotent.
    await page.locator('#auto').check();
    await page.evaluate(()=>{session=true;departure={user:state.current,handled:false};hidden=false;
      Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));
      delete document.hidden;window.dispatchEvent(new Event('pageshow'));window.dispatchEvent(new Event('pageshow'));
    });
    await checkCard('dave._four');assert.equal(opened.length,1);
    assert.equal((await snapshot()).records['dave._four'],undefined);

    // A mismatched DOM link blocks navigation rather than opening the previous URL.
    await page.evaluate(()=>document.getElementById('open').href='https://www.instagram.com/erin_five/');
    await page.click('#open');assert.equal(opened.length,1);
    assert.match(await page.locator('#message').textContent(),/تم منع الفتح/);
    await page.evaluate(()=>render());await checkCard('dave._four');

    // Decision commits both the status and next identity before the next gesture.
    await page.locator('#auto').uncheck();await page.click('[data-status=reviewed]');
    await checkCard('erin_five');assert.equal((await snapshot()).records['dave._four'].status,'reviewed');
    await page.reload();await checkCard('erin_five');
    assert.equal((await snapshot()).records['dave._four'].status,'reviewed');

    // Native browser fallback receives exactly the card's identity.
    const popupPromise=context.waitForEvent('page');await page.click('#web');const popup=await popupPromise;
    await popup.waitForURL('https://www.instagram.com/erin_five/');await popup.close();
    assert.equal(opened.at(-1),'https://www.instagram.com/erin_five/');
    await checkCard('erin_five');

    // Clipboard success and fallback; diagnostics must contain no identities/URLs.
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{globalThis.copied=text;}}}));
    await page.click('#copyUsername');assert.equal(await page.evaluate(()=>globalThis.copied),'erin_five');
    await page.click('#reportLink');const report=await page.evaluate(()=>globalThis.copied);
    for(const secret of ['erin_five','dave._four','bob_two','instagram.com','followers_1.json'])assert.equal(report.includes(secret),false,secret);
    assert.equal(JSON.parse(report).externalAppVerified,false);
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Denied')}}}));
    await page.click('#copyUsername');assert.equal(await page.locator('#copyDialog').isVisible(),true);
    assert.equal(await page.locator('#copyText').inputValue(),'erin_five');await page.click('#closeCopy');

    // Old faulty value/title inputs are excluded and cannot create alternate accounts.
    await page.locator('#followers').setInputFiles([fixture('followers_1'),fixture('followers_2')]);
    await page.locator('#following').setInputFiles(file('following.json',{relationships_following:[
      {title:'wrong_display',string_list_data:[{value:'wrong_name',href:'https://instagram.com/correct_name/'}]},
      {title:'display_name_only'},
      {string_list_data:[{value:'erin_five',href:'https://instagram.com/erin_five/'}]}
    ]}));
    await page.click('#analyze');await page.waitForFunction(()=>document.querySelector('#nf').textContent==='1');
    await checkCard('erin_five');assert.deepEqual((await snapshot()).accounts,['erin_five']);
    assert.equal((await snapshot()).records['dave._four'].status,'reviewed');
    assert.match(await page.locator('#diagnostics').textContent(),/1 متعارضة/);
    const before=await snapshot();
    await page.locator('#following').setInputFiles(file('bad.json',{bad:true}));await page.click('#analyze');
    await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('غير مدعومة'));
    assert.deepEqual(await snapshot(),before);
    await page.locator('#following').setInputFiles(file('ambiguous.json',{relationships_following:[{string_list_data:[{value:'wrong',href:'https://instagram.com/other/'}]}]}));
    await page.click('#analyze');await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('لم نجد أسماء موثوقة'));
    assert.deepEqual(await snapshot(),before);

    // Staleness is based only on file metadata, never on following timestamps.
    const stale=await page.evaluate(async()=>readFiles([{size:100,lastModified:1,text:async()=>JSON.stringify([{string_list_data:[{value:'test_name',timestamp:1}]}])}],'followers'));
    assert.equal(stale.diagnostics.oldFiles,1);
    const recent=await page.evaluate(async()=>readFiles([{size:100,lastModified:Date.now(),text:async()=>JSON.stringify([{string_list_data:[{value:'test_name',timestamp:1}]}])}],'followers'));
    assert.equal(recent.diagnostics.oldFiles,0);
    // List selection, skip, backup restore, old records and layout stability.
    await page.locator('#following').setInputFiles(fixture('following'));await page.click('#analyze');
    await page.waitForFunction(()=>document.querySelector('#nf').textContent==='2');
    await page.locator('#list li').filter({hasText:'dave._four'}).getByRole('button',{name:'مراجعة',exact:true}).click();
    await checkCard('dave._four');await page.locator('#auto').check();await page.click('[data-status=skipped]');
    await page.waitForURL('https://www.instagram.com/erin_five/');await page.goBack();await page.waitForSelector('#username');await checkCard('erin_five');
    assert.equal((await snapshot()).records['dave._four'].status,'skipped');
    await page.locator('#backup').setInputFiles(file('backup.json',{...legacy,records:{bob_two:{status:'unfollowed',at:'2026-11-02T10:00:00Z'}}}));
    await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('تم دمج'));
    assert.equal((await snapshot()).records.bob_two.status,'unfollowed');
    assert.equal((await snapshot()).importMeta.parserVersion,2);await checkCard('erin_five');
    await page.reload();await checkCard('erin_five');
    for(const width of [390,1280]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
    await page.click('#install');assert.equal(await page.locator('#installDialog').isVisible(),true);await page.click('#closeInstall');
    await page.evaluate(()=>navigator.serviceWorker.ready);
    await page.reload();await context.setOffline(true);await page.reload();await checkCard('erin_five');await context.setOffline(false);
    await page.click('#methodLink');await page.locator('#profileUrl').fill('https://evil.test/alice/');
    const beforeInvalid=opened.length;await page.click('#checkProfile');assert.equal(opened.length,beforeInvalid);
    await page.locator('#profileUrl').fill('https://www.instagram.com/_u/BOB_TWO/');
    const inputPopupPromise=context.waitForEvent('page');await page.click('#checkProfile');const inputPopup=await inputPopupPromise;
    await inputPopup.waitForURL('https://www.instagram.com/bob_two/');await inputPopup.close();
    assert.equal(opened.at(-1),'https://www.instagram.com/bob_two/');
    assert.deepEqual(errors,[]);
    await context.close();
    console.log('PASS: identity/link invariants, actual intercepted navigation, stable return, decisions, reload, imports, legacy data, clipboard privacy, backup, layout and offline shell.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
