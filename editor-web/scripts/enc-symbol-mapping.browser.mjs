// Read-only live-chart check: use the real Manitowoc Marina, never a synthetic HRBFAC.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-unsafe-swiftshader']});
try {
  for(const width of [1440,390]) {
    const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto((process.env.EDITOR_URL||'http://127.0.0.1:4173')+'/?mode=enc');
    await page.waitForFunction(()=>{
      const element=document.querySelector('.maplibregl-map'); if(!element)return false;
      let fiber=element[Object.keys(element).find(key=>key.startsWith('__reactFiber$'))];
      for(;fiber;fiber=fiber.return)for(let hook=fiber.memoizedState;hook;hook=hook.next){
        const map=hook.memoizedState?.current;
        if(map && typeof map.queryRenderedFeatures==='function'){
          window.testMap=map;
          return map.loaded() && Boolean(map.getSource('enc'));
        }
      }
      return false;
    },undefined,{timeout:60000});
    await page.evaluate(()=>testMap.jumpTo({center:[-87.6498503,44.0966824],zoom:16}));
    await page.waitForFunction(()=>testMap.loaded() && testMap.queryRenderedFeatures().some(feature=>feature.properties.OBJNAM==='Manitowoc Marina'),undefined,{timeout:60000});
    const position=await page.evaluate(()=>{
      const feature=testMap.queryRenderedFeatures().find(feature=>feature.properties.OBJNAM==='Manitowoc Marina' && feature.geometry.type==='Point');
      if(!feature)throw Error('Marina point symbol missing');
      const point=testMap.project(feature.geometry.coordinates),rect=testMap.getCanvas().getBoundingClientRect();
      return {x:point.x+rect.left,y:point.y+rect.top};
    });
    await page.mouse.click(position.x,position.y);
    await page.getByRole('region',{name:'Thuộc tính đối tượng'}).getByRole('img',{name:'Ký hiệu SMCFAC02',exact:true}).waitFor();
    assert.equal(await page.locator('.enc-properties-row').filter({has:page.locator('dt',{hasText:/^CATHAF$/})}).locator('dd').innerText(),'["5"]');
    if(process.env.REVIEW_SCREENSHOTS){await mkdir(process.env.REVIEW_SCREENSHOTS,{recursive:true});await page.screenshot({path:`${process.env.REVIEW_SCREENSHOTS}/enc-marina-properties-${width}.png`});}
    await page.getByRole('button',{name:'Đóng bảng thuộc tính',exact:true}).click();
    await page.getByRole('button',{name:'Bảng ký hiệu',exact:true}).click();
    await page.getByLabel('Tìm mã hoặc giải thích').fill('HRBFAC');
    const rows=page.locator('.enc-symbol-table tbody tr');
    await rows.first().waitFor();
    assert.deepEqual((await rows.locator('th').allTextContents()).sort(),['CHINFO07','HRBFAC09','ROLROL01','SMCFAC02']);
    assert.ok((await rows.filter({hasText:'SMCFAC02'}).innerText()).includes('du thuyền'));
    assert.ok((await rows.filter({hasText:'HRBFAC09'}).innerText()).includes('Cảng cá'));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(process.env.REVIEW_SCREENSHOTS)await page.screenshot({path:`${process.env.REVIEW_SCREENSHOTS}/enc-harbour-search-${width}.png`});
    assert.deepEqual(errors,[]);
    console.log(`PASS ${width}px: real marina click selects SMCFAC02; HRBFAC search includes all four variants; no page errors.`);
    await page.close();
  }
}finally{await browser.close();}
