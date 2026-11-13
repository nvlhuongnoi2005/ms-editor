// Read-only verification against the real running server; also reproduce a broken legacy asset endpoint.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.EDITOR_URL||'http://127.0.0.1:4173';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-unsafe-swiftshader']});
try{
  for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    const legacy=[],errors=[],assets=[],glyphs=[];
    await context.route('**/enc/assets/**',route=>{legacy.push(route.request().url());return route.fulfill({status:404,json:{error:'ENC sprite assets are not installed.'}});});
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{
      if(/simplified.*\.(png|json)/.test(response.url()))assets.push({url:response.url(),status:response.status()});
      if(/\/assets\/0-255-[^/]+\.pbf$/.test(response.url()))glyphs.push(response.status());
    });
    await page.goto(origin+'/?mode=enc');
    // Wait for the chart itself, not just the catalog image: glyph requests happen
    // after vector tiles arrive and were missed by the earlier catalog-only check.
    await page.waitForFunction(()=>{
      const element=document.querySelector('.maplibregl-map');
      if(!element)return false;
      let fiber=element[Object.keys(element).find(key=>key.startsWith('__reactFiber$'))];
      for(;fiber;fiber=fiber.return)for(let hook=fiber.memoizedState;hook;hook=hook.next){
        const map=hook.memoizedState?.current;
        if(map && typeof map.getSource==='function' && typeof map.loaded==='function')
          return Boolean(map.getSource('enc') && map.loaded() && map.queryRenderedFeatures().some(feature=>feature.source==='enc'));
      }
      return false;
    },undefined,{timeout:60000});
    await page.waitForFunction(()=>performance.getEntriesByType('resource').some(entry=>/\/assets\/0-255-[^/]+\.pbf$/.test(entry.name)),undefined,{timeout:30000});
    await page.getByRole('button',{name:'Bảng ký hiệu',exact:true}).click();
    const search=page.getByLabel('Tìm mã hoặc giải thích');
    await search.fill('BOYSAW12');
    await page.getByRole('img',{name:'Ký hiệu BOYSAW12',exact:true}).waitFor();
    assert.equal(await page.getByText('Không tải được hình ảnh ký hiệu.',{exact:false}).count(),0);
    const image=await page.locator('.enc-symbol-atlas-loader').evaluate(element=>({loaded:element.complete,width:element.naturalWidth,height:element.naturalHeight,url:element.currentSrc}));
    assert.ok(image.loaded && image.width>0 && image.height>0);
    assert.ok(image.url.includes('/assets/'));
    const preview=page.getByRole('img',{name:'Ký hiệu BOYSAW12',exact:true});
    assert.ok(await preview.evaluate(element=>getComputedStyle(element).backgroundImage.includes('simplified')));
    assert.equal(legacy.length,0,'all map and catalog sprites/glyphs bypass the broken API asset root');
    assert.deepEqual(errors,[]);
    assert.ok(assets.length>0 && assets.every(asset=>asset.status===200));
    assert.ok(glyphs.length>0 && glyphs.every(status=>status===200),'chart labels load bundled glyphs despite a broken legacy API');
    if(process.env.REVIEW_SCREENSHOTS){await mkdir(process.env.REVIEW_SCREENSHOTS,{recursive:true});await page.screenshot({path:`${process.env.REVIEW_SCREENSHOTS}/enc-symbol-boysaw12-${width}.png`});}
    console.log(`PASS ${width}px: BOYSAW12 visible from ${image.width}x${image.height} bundled PNG; legacy asset endpoint forced to 404; no page errors.`);
    await context.close();
  }
}finally{await browser.close();}
