// Real Chrome, MapLibre and shared IndexedDB drafts; isolated ENC API fixtures.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.EDITOR_URL || 'http://127.0.0.1:5189';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-swiftshader'] });
const revision = 'TESTCELL-E1-U0-R1';
const attributes = [{ key: 'OBJNAM', label: 'Tên đối tượng', kind: 'text' }, { key: 'INFORM', label: 'Thông tin', kind: 'text' }, { key: 'SCAMIN', label: 'Mẫu số tỷ lệ hiển thị tối thiểu', kind: 'number' }];
const dictionary = JSON.parse(await readFile(new URL('../../editor-api/internal/enc/editing_schema.generated.json',import.meta.url),'utf8'));
let transformFeature;
try {
  for (const width of process.env.ENC_FIELDS_REVIEW_ONLY ? [390] : [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const errors = [], commits = [], receipts = new Map(), documents = new Map();
    let credentials, version = 0, loseResponse = false, creates = 0;
    let slowRequests=0, releaseSlow,markSlow;
    const slowTiles=new Promise(resolve=>releaseSlow=resolve);
    const firstSlowTile=new Promise(resolve=>markSlow=resolve);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await context.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      if (!path.startsWith('/api/')) return route.continue();
      if (path === '/api/enc/datasets') return route.fulfill({ json: { datasets: [], catalogRevision: 1 } });
      if (path === '/api/enc/cells') return route.fulfill({ json: { cells: [{ name: 'TESTCELL', description: 'Hải đồ kiểm thử', revisionId: revision, edition: 1, updateNumber: 0, bounds: [105, 21, 105.01, 21.01], focus: [105.005, 21.005] }] } });
      if (path === '/api/enc/regions') return route.fulfill({ json: { type: 'FeatureCollection', features: [] } });
      if (path.startsWith('/api/enc/tiles/')) return route.fulfill({ status: 204 });
      if (path.endsWith('/feature') && transformFeature) return route.fulfill({json:transformFeature});
      if (path.includes('/workspaces/') && path.includes('/tiles/')) {
        assert.equal(request.headers()['x-enc-workspace-token'], credentials.token);
        if(url.searchParams.has('slow-test')){slowRequests++;markSlow();await slowTiles;}
        return route.fulfill({ status: 204 });
      }
      if (path === '/api/enc/workspaces') {
        const body = request.postDataJSON();
        assert.equal(request.headers()['x-editor-import'], '1');
        if (!credentials) { credentials = body; creates++; }
        assert.deepEqual(body, credentials);
        return route.fulfill({ json: { id: credentials.id } });
      }
      if (path === `/api/enc/workspaces/${credentials?.id}`) return route.fulfill({ json: { id: credentials.id, baseRevision: revision, cellName: 'TESTCELL', version, sourceChanged: false, features: [...documents.values()], attributes, attributeDefinitions:dictionary.attributes, classAttributes:Object.fromEntries(Object.entries(dictionary.classes).map(([name,definition])=>[name,definition.attributes])), pointClasses: ['LNDMRK', 'BOYLAT', 'LIGHTS'] } });
      if (path.endsWith('/commits')) {
        const body = request.postDataJSON(); commits.push(body);
        assert.equal(request.headers()['x-enc-workspace-token'], credentials.token);
        const existing = receipts.get(body.requestId);
        if (existing) assert.deepEqual(existing.body, body);
        else {
          assert.equal(body.expectedVersion, version);
          for (const change of body.changes) if (change.after) documents.set(change.key, change.after); else documents.delete(change.key);
          version++; receipts.set(body.requestId, { body, version });
        }
        if (loseResponse) { loseResponse = false; return route.abort('failed'); }
        return route.fulfill({ json: { version: receipts.get(body.requestId).version, requestId: body.requestId } });
      }
      return route.fulfill({ status: 404, json: { error: 'Unknown fixture route ' + path } });
    });
    // Only use local assets; basemap is optional for editing tests.
    await context.route('**/datas/**', route => route.fulfill({ status: 204 }));
    await context.route('**/enc/basemap/**', route => route.fulfill({ status: 204 }));
    await context.route('**/enc/assets/sprites/**', async route => {
      const name = new URL(route.request().url()).pathname.split('/').at(-1);
      const file = name.includes('@2x') ? name : name.replace(/\.(png|json)$/, '@2x.$1');
      return route.fulfill({ body: await readFile(new URL(`../../Presentation_Library/assets/sprites/${file}`, import.meta.url)), contentType: name.endsWith('.json') ? 'application/json' : 'image/png' });
    });
    await context.route('**/enc/assets/fonts/**', async route => {
      const relative = new URL(route.request().url()).pathname.split('/fonts/')[1];
      return route.fulfill({ body: await readFile(new URL(`../../Presentation_Library/assets/fonts/${relative}`, import.meta.url)), contentType: 'application/x-protobuf' });
    });
    await page.addInitScript(() => localStorage.setItem('enc:presentation-settings:v1', JSON.stringify({ category: 'base', names: false, soundings: false, quality: false })));
    await page.goto(origin + '/?mode=enc');
    await page.locator('.maplibregl-map').waitFor();
    if (width < 700) await page.getByRole('button', { name: 'Mở bảng hiển thị hải đồ' }).click();
    await page.getByLabel('Phạm vi hiển thị').click();
    await page.getByRole('option', { name: 'Hải đồ kiểm thử · TESTCELL' }).click();
    assert.equal(await page.locator('.enc-presentation-controls').count(), 0);
    if (width < 700) await page.getByRole('button', { name: 'Thu gọn bảng hải đồ' }).click();
    assert.equal(await page.getByRole('region', { name: 'Biên tập ENC', exact: true }).count(), 0);
    const launcher = page.getByRole('button', { name: 'Mở công cụ biên tập ENC' });
    const launchBounds = await launcher.boundingBox();
    const navigatorBounds = await page.locator('.maplibregl-ctrl-top-right .maplibregl-ctrl-group').first().boundingBox();
    assert.ok(launchBounds.y >= navigatorBounds.y + navigatorBounds.height, 'editing launcher sits below the navigator');
    assert.ok(launchBounds.width <= 44 && launchBounds.height <= 44);
    if (process.env.REVIEW_SCREENSHOTS) await page.screenshot({ path: `${process.env.REVIEW_SCREENSHOTS}/enc-edit-launcher-${width}.png` });
    await launcher.click();
    await page.getByRole('button', { name: 'Thu gọn công cụ biên tập ENC' }).click();
    await launcher.click();
    await page.evaluate(()=>{
      const element=document.querySelector('.maplibregl-map');
      let fiber=element[Object.keys(element).find(key=>key.startsWith('__reactFiber$'))];
      for(;fiber;fiber=fiber.return)for(let hook=fiber.memoizedState;hook;hook=hook.next){
        const map=hook.memoizedState?.current;
        if(map && typeof map.getSource==='function'){
          window.encTestMap=map;window.encPerformance={setStyle:0,setFilter:0};
          for(const method of ['setStyle','setFilter']){const original=map[method].bind(map);map[method]=(...args)=>{window.encPerformance[method]++;return original(...args);};}
          return;
        }
      }
      throw Error('Map ref not found');
    });
    const reviewOverlap=async editing=>{
      await page.evaluate(({revision,editing})=>{
        const map=window.encTestMap,position=map.unproject([innerWidth<700?170:800,innerWidth<700?310:290]);
        const features=[4,5].map((category,index)=>({type:'Feature',id:`HRBFAC/overlap-${index}`,geometry:{type:'Point',coordinates:[position.lng,position.lat]},properties:{edit_key:`HRBFAC/overlap-${index}`,revision_id:revision,object_class:'HRBFAC',OBJNAM:`Bến ${index+1}`,cell_name:'TESTCELL',sym_CATHAF:category,list_CATHAF:`|${category}|`}}));
        if(!editing){map.addSource('enc-edits',{type:'geojson',data:{type:'FeatureCollection',features:[]}});map.addLayer({id:'overlap-review',type:'circle',source:'enc-edits',paint:{'circle-radius':10}});}
        map.getSource('enc-edits').updateData({add:features});
      },{revision,editing});
      await page.waitForFunction(()=>window.encTestMap.queryRenderedFeatures().filter(f=>f.properties.edit_key?.startsWith('HRBFAC/overlap')).length>=2);
      await page.evaluate(()=>{const map=window.encTestMap,point={x:innerWidth<700?170:800,y:innerWidth<700?310:290};map.fire('click',{point,lngLat:map.unproject([point.x,point.y]),originalEvent:new MouseEvent('click')});});
      const chooser=page.getByRole('region',{name:'Chọn đối tượng',exact:true});await chooser.waitFor();
      assert.equal(await chooser.getByRole('button').count(),3,'two objects and close; portrayal layers are deduplicated');
      assert.ok((await chooser.innerText()).includes(editing?'biên tập':'xem chi tiết'));
      if(process.env.REVIEW_SCREENSHOTS)await page.screenshot({path:`${process.env.REVIEW_SCREENSHOTS}/enc-overlap-${editing?'edit':'view'}-${width}.png`});
      const coordinates=await page.evaluate(async()=>{const data=await window.encTestMap.getSource('enc-edits').getData();return data.features.find(f=>f.id==='HRBFAC/overlap-1').geometry.coordinates;});
      transformFeature={key:'HRBFAC/overlap-1',sourceId:'overlap-1',objectClass:'HRBFAC',attributes:{OBJNAM:'Bến 2',CATHAF:[5]},geometry:{type:'Point',coordinates},canMove:true,canDelete:false,deleted:false};
      await chooser.getByRole('button',{name:/Bến 2/}).click();
      if(editing)await page.getByRole('region',{name:'Chỉnh sửa đối tượng ENC'}).getByLabel('Tên đối tượng (OBJNAM)',{exact:true}).waitFor();
      else {await page.getByRole('region',{name:'Thuộc tính đối tượng'}).getByText('Bến 2',{exact:true}).waitFor();await page.getByRole('button',{name:'Đóng bảng thuộc tính'}).click();}
      await page.evaluate(editing=>{const map=window.encTestMap;map.getSource('enc-edits').updateData({remove:['HRBFAC/overlap-0','HRBFAC/overlap-1']});if(!editing){map.removeLayer('overlap-review');map.removeSource('enc-edits');}},editing);
      transformFeature=undefined;
    };
    await reviewOverlap(false);
    await page.getByRole('button', { name: 'Biên tập cell', exact: true }).click();
    await page.getByRole('button', { name: 'Thêm điểm', exact: true }).waitFor();
    const picker=page.getByRole('combobox',{name:'Loại điểm',exact:true});
    await picker.fill('BOYLAT14');
    await page.getByRole('option',{name:/BOYLAT · BOYLAT14/}).click();
    await page.getByRole('button', { name: 'Thêm điểm', exact: true }).click();
    await page.mouse.move(width < 700 ? 170 : 800,width < 700 ? 560 : 440);
    await page.locator('.enc-edit-placement-preview [data-symbol="BOYLAT14"]').waitFor();
    if(process.env.REVIEW_SCREENSHOTS) await page.screenshot({path:`${process.env.REVIEW_SCREENSHOTS}/enc-symbol-placement-${width}.png`});
    await page.mouse.click(width < 700 ? 170 : 800, width < 700 ? 560 : 440);
    const inspector = page.getByRole('region', { name: 'Chỉnh sửa đối tượng ENC' });
    await inspector.waitFor();
    await page.locator('.enc-edit-symbol-marker [data-symbol="BOYLAT14"]').waitFor();
    assert.equal(await page.locator('.enc-feature-hover').count(),0,'pointer hover does not draw a rectangle');
    assert.equal(await page.getByRole('group',{name:'Khung thao tác BOYLAT',exact:true}).count(),1,'selected object retains transform controls');
    const contextBox=page.getByRole('group',{name:'Khung thao tác BOYLAT',exact:true});
    await reviewOverlap(true);
    await page.getByRole('combobox',{name:'Đối tượng trong bản biên tập',exact:true}).click();
    await page.getByRole('option').filter({hasText:'BOYLAT'}).click();await page.waitForFunction(()=>!document.querySelector('.MuiModal-root'));
    await contextBox.click({button:'right'});
    const contextMenu=page.getByRole('menu',{name:'Thao tác biên tập ENC',exact:true});
    await contextMenu.waitFor();
    assert.ok(await contextMenu.getByRole('menuitem',{name:'Sao chép điểm',exact:true}).isEnabled());
    await contextMenu.getByRole('menuitem',{name:'Sao chép điểm',exact:true}).click();
    await contextBox.click({button:'right'});
    assert.ok(await contextMenu.getByRole('menuitem',{name:'Dán điểm tại đây',exact:true}).isEnabled());
    if(process.env.REVIEW_SCREENSHOTS)await page.screenshot({path:`${process.env.REVIEW_SCREENSHOTS}/enc-context-menu-${width}.png`});
    await page.keyboard.press('Escape');await contextMenu.waitFor({state:'hidden'});
    await contextBox.click({button:'right'});
    await contextMenu.getByRole('menuitem',{name:'Nhân bản điểm',exact:true}).click();
    await page.getByText(/2 thay đổi chưa lưu · 2 đối tượng/).waitFor();
    await page.getByRole('button',{name:'Hoàn tác ENC',exact:true}).click();
    // Re-select the original point after Undo removes the duplicated document.
    await page.getByRole('combobox',{name:'Đối tượng trong bản biên tập',exact:true}).click();
    await page.getByRole('option').filter({hasText:'BOYLAT'}).click();
    await page.waitForFunction(()=>!document.querySelector('.MuiModal-root'));
    await page.mouse.click(width<700?350:900,470,{button:'right'});
    await contextMenu.waitFor();
    assert.ok(await contextMenu.getByRole('menuitem',{name:'Sao chép điểm',exact:true}).isDisabled(),'empty map does not target the old selection');
    await contextMenu.getByRole('menuitem',{name:'Dán điểm tại đây',exact:true}).click();
    await page.getByText(/2 thay đổi chưa lưu · 2 đối tượng/).waitFor();
    await page.getByRole('button',{name:'Hoàn tác ENC',exact:true}).click();
    await page.getByRole('combobox',{name:'Đối tượng trong bản biên tập',exact:true}).click();
    await page.getByRole('option').filter({hasText:'BOYLAT'}).click();
    await page.waitForFunction(()=>!document.querySelector('.MuiModal-root'));
    await contextBox.click({button:'right'});await contextMenu.getByRole('menuitem',{name:'Cắt điểm…',exact:true}).click();
    await inspector.getByText('Xóa điểm khỏi bản biên tập?',{exact:false}).waitFor();
    await inspector.getByRole('button',{name:'Hủy',exact:true}).click();
    await page.getByText(/1 thay đổi chưa lưu · 1 đối tượng/).waitFor();
    if(width>=700){
      const frame=page.getByRole('group',{name:'Khung thao tác BOYLAT',exact:true});
      const originalLongitude=await inspector.getByLabel('Kinh độ',{exact:true}).inputValue();
      const rect=await frame.boundingBox();
      await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
      await page.mouse.move(rect.x+rect.width/2+45,rect.y+rect.height/2+20,{steps:8});
      await page.mouse.up();
      const longitudeId=await inspector.getByLabel('Kinh độ',{exact:true}).getAttribute('id');
      await page.waitForFunction(({id,value})=>document.getElementById(id).value!==value,{id:longitudeId,value:originalLongitude});
      assert.notEqual(await inspector.getByLabel('Kinh độ',{exact:true}).inputValue(),originalLongitude);
      await page.getByRole('button',{name:'Hoàn tác ENC',exact:true}).click();
      await page.waitForFunction(({id,value})=>document.getElementById(id).value===value,{id:longitudeId,value:originalLongitude});
      assert.equal(await inspector.getByLabel('Kinh độ',{exact:true}).inputValue(),originalLongitude,'one drag is one Undo');
      const handle=frame.getByRole('button',{name:'Đổi kích thước se',exact:true});
      const corner=await handle.boundingBox();
      await page.mouse.move(corner.x+12,corner.y+12);await page.mouse.down();await page.mouse.move(corner.x+35,corner.y+35,{steps:8});await page.mouse.up();
      assert.ok(!(await frame.innerText()).includes('100%'),'resize updates symbol scale');
      await page.getByRole('button',{name:'Hoàn tác ENC',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('[aria-label="Khung thao tác BOYLAT"]')?.textContent.includes('100%'));
      assert.ok((await frame.innerText()).includes('100%'),'one resize is one Undo');
      if(process.env.REVIEW_SCREENSHOTS)await page.screenshot({path:`${process.env.REVIEW_SCREENSHOTS}/enc-transform-point-${width}.png`});
      // Real source-class regression: HRBFAC is movable without being creatable.
      const marinaCoordinate=await page.evaluate(()=>{const p=window.encTestMap.unproject([800,290]);return[p.lng,p.lat];});
      for(const movable of [true,false]){
        transformFeature={key:`HRBFAC/${movable?'marina':'shared-marina'}`,sourceId:movable?'marina':'shared-marina',objectClass:'HRBFAC',attributes:{CATHAF:[5]},geometry:{type:'Point',coordinates:marinaCoordinate},canMove:movable,canDelete:false,deleted:false};
        await page.evaluate(({feature,revision})=>{
          const map=window.encTestMap;
          map.getSource('enc-edits').updateData({add:[{type:'Feature',id:feature.key,geometry:feature.geometry,properties:{object_class:'HRBFAC',edit_key:feature.key,revision_id:revision,list_CATHAF:'|5|',sym_CATHAF:5}}]});
        },{feature:transformFeature,revision});
        await page.waitForFunction(key=>window.encTestMap.queryRenderedFeatures({layers:['enc-edits-points']}).some(f=>f.properties.edit_key===key),transformFeature.key);
        await page.evaluate(()=>{const map=window.encTestMap;map.fire('click',{point:{x:800,y:290},lngLat:map.unproject([800,290]),originalEvent:new MouseEvent('click')});});
        const marinaBox=page.getByRole('group',{name:'Khung thao tác HRBFAC',exact:true});await marinaBox.waitFor();
        await inspector.getByText('HRBFAC',{exact:true}).waitFor();
        if(movable)await inspector.getByLabel('Kinh độ',{exact:true}).waitFor();
        else await page.waitForFunction(()=>!document.querySelector('.enc-edit-properties input[aria-label="Kinh độ"]')&&!Array.from(document.querySelectorAll('.enc-edit-properties label')).some(e=>e.textContent==='Kinh độ'));
        const before=movable?await inspector.getByLabel('Kinh độ',{exact:true}).inputValue():null;
        const camera=await page.evaluate(()=>window.encTestMap.getCenter().toArray());
        const r=await marinaBox.boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2+35,r.y+r.height/2+15,{steps:6});
        assert.equal(await marinaBox.evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)','drag keeps the existing selected style');
        await page.mouse.up();
        if(movable){
          const id=await inspector.getByLabel('Kinh độ',{exact:true}).getAttribute('id');
          await page.waitForFunction(({id,before})=>document.getElementById(id).value!==before,{id,before});
          if(process.env.REVIEW_SCREENSHOTS)await page.screenshot({path:`${process.env.REVIEW_SCREENSHOTS}/enc-marina-drag-${width}.png`});
          await page.getByRole('button',{name:'Hoàn tác ENC',exact:true}).click();
        }else{
          assert.ok((await marinaBox.innerText()).includes('Khóa vị trí'));
          assert.deepEqual(await page.evaluate(()=>window.encTestMap.getCenter().toArray()),camera,'protected geometry does not accidentally pan the map');
        }
        await page.evaluate(key=>window.encTestMap.getSource('enc-edits').updateData({remove:[key]}),transformFeature.key);
      }
      await page.getByRole('combobox',{name:'Đối tượng trong bản biên tập',exact:true}).click();
      await page.getByRole('option').filter({hasText:'BOYLAT'}).click();await page.waitForFunction(()=>!document.querySelector('.MuiModal-root'));
      transformFeature=await page.evaluate(()=>{
        const map=window.encTestMap;
        const positions=[[730,250],[870,250],[870,330],[730,330],[730,250]].map(p=>{const c=map.unproject(p);return[c.lng,c.lat];});
        return {key:'LNDARE/transform-polygon',sourceId:'transform-polygon',objectClass:'LNDARE',attributes:{OBJNAM:'Transform polygon'},geometry:{type:'Polygon',coordinates:[positions]},deleted:false,canMove:true,canDelete:false};
      });
      await page.evaluate(({feature,revision})=>{
        const map=window.encTestMap;
        map.getSource('enc-edits').updateData({add:[{type:'Feature',id:feature.key,geometry:feature.geometry,properties:{object_class:feature.objectClass,edit_key:feature.key,revision_id:revision}}]});
      },{feature:transformFeature,revision});
      await page.waitForFunction(()=>window.encTestMap.queryRenderedFeatures({layers:['enc-edits-areas']}).some(f=>f.properties.edit_key==='LNDARE/transform-polygon'));
      await page.evaluate(()=>{const map=window.encTestMap;map.fire('click',{point:{x:800,y:290},lngLat:map.unproject([800,290]),originalEvent:new MouseEvent('click')});});
      const polygonBox=page.getByRole('group',{name:'Khung thao tác LNDARE',exact:true});await polygonBox.waitFor();
      await polygonBox.click({button:'right'});await contextMenu.waitFor();
      assert.ok(await contextMenu.getByRole('menuitem',{name:'Sao chép điểm',exact:true}).isDisabled(),'polygon cannot be copied through the point API');
      assert.ok(await contextMenu.getByRole('menuitem',{name:'Xóa điểm…',exact:true}).isDisabled(),'polygon deletion stays protected');
      await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.MuiModal-root'));
      const polyRect=await polygonBox.boundingBox();
      await page.mouse.move(polyRect.x+polyRect.width/2,polyRect.y+polyRect.height/2);await page.mouse.down();await page.mouse.move(polyRect.x+polyRect.width/2+30,polyRect.y+polyRect.height/2+20,{steps:5});await page.mouse.up();
      const movedHandle=await page.waitForFunction(async original=>{const data=await window.encTestMap.getSource('enc-edits').getData();const feature=data.features.find(f=>f.id==='LNDARE/transform-polygon');return feature&&Math.abs(feature.geometry.coordinates[0][0][0]-original)>1e-7?feature.geometry:null;},transformFeature.geometry.coordinates[0][0][0]);
      const moved=await movedHandle.jsonValue();await movedHandle.dispose();
      assert.notDeepEqual(moved,transformFeature.geometry);
      const resize=await polygonBox.getByRole('button',{name:'Đổi kích thước se',exact:true}).boundingBox();
      const beforeResize=await polygonBox.locator('path').getAttribute('d');
      await page.mouse.move(resize.x+12,resize.y+12);await page.mouse.down();await page.mouse.move(resize.x+40,resize.y+35,{steps:5});await page.mouse.up();
      await page.waitForFunction(previous=>document.querySelector('.enc-transform-geometry path')?.getAttribute('d')!==previous,beforeResize);
      if(process.env.REVIEW_SCREENSHOTS)await page.screenshot({path:`${process.env.REVIEW_SCREENSHOTS}/enc-transform-polygon-${width}.png`});
      await page.getByRole('button',{name:'Hoàn tác ENC',exact:true}).click();
      await page.getByRole('button',{name:'Hoàn tác ENC',exact:true}).click();
      await page.getByRole('combobox',{name:'Đối tượng trong bản biên tập',exact:true}).click();
      await page.getByRole('option').filter({hasText:'BOYLAT'}).click();
      await page.locator('.enc-edit-symbol-marker [data-symbol="BOYLAT14"]').waitFor();
    }
    const addField=inspector.getByRole('combobox',{name:'Thêm trường theo schema',exact:true});
    await page.getByRole('group',{name:'Khung thao tác BOYLAT',exact:true}).getByRole('button',{name:'Đổi kích thước se',exact:true}).press('ArrowUp');
    await addField.fill('DEPTH');
    assert.equal(await page.getByRole('option').count(),0,'DEPTH is not a BOYLAT attribute');
    await addField.fill('VERLEN');
    await page.getByRole('option',{name:/VERLEN/}).click();
    const verticalLength=inspector.getByLabel(/\(VERLEN\)/);
    await verticalLength.fill('abc');
    await verticalLength.press('Tab');
    assert.ok(await page.getByRole('button',{name:'Lưu',exact:true}).isDisabled(),'invalid numeric draft blocks save');
    await verticalLength.fill('12.5');
    await verticalLength.press('Tab');
    if(process.env.ENC_FIELDS_REVIEW_ONLY && process.env.REVIEW_SCREENSHOTS) {
      await inspector.locator('.enc-properties-body').evaluate(element=>{element.scrollTop=0;});
      await page.screenshot({path:`${process.env.REVIEW_SCREENSHOTS}/enc-schema-fields-${width}.png`});
      await context.close();continue;
    }
    await inspector.getByLabel('Tên đối tượng (OBJNAM)', { exact: true }).fill('Điểm kiểm thử');
    await inspector.getByLabel('Kinh độ', { exact: true }).fill('105.123456789');
    await inspector.getByLabel('Vĩ độ', { exact: true }).fill('21.987654321');
    await inspector.getByRole('button', { name: 'Áp dụng tọa độ' }).click();
    // Capture a meaningful editing state and assert both layouts fit.
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.env.REVIEW_SCREENSHOTS) {
      await mkdir(process.env.REVIEW_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: `${process.env.REVIEW_SCREENSHOTS}/enc-editing-${width}.png` });
    }
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await page.getByText('Đã lưu thay đổi vào không gian biên tập.', { exact: true }).waitFor();
    assert.equal(documents.size, 1);
    assert.equal([...documents.values()][0].attributes.VERLEN,12.5);
    assert.ok(Math.abs([...documents.values()][0].symbolScale-1.1)<1e-9,'symbol size is saved with the workspace');
    assert.deepEqual([...documents.values()][0].attributes.COLOUR,[3]);
    assert.deepEqual([...documents.values()][0].geometry.coordinates, [105.123456789, 21.987654321]);
    assert.equal(await page.evaluate(()=>window.encPerformance.setStyle),0,'workspace entry retains the presentation style');
    const pendingSlowRequest=page.waitForRequest(request=>request.url().includes('slow-test=1'));
    await page.evaluate(()=>{
      const map=window.encTestMap,source=map.getSource('enc');
      source.setTiles(map.getStyle().sources.enc.tiles.map(url=>url+'&slow-test=1'));
    });
    await pendingSlowRequest;
    // Cached fallback tiles can keep isStyleLoaded() true while requests are
    // pending. The held route is the deterministic evidence of slow loading.
    await firstSlowTile;
    const filtersBefore=await page.evaluate(()=>window.encPerformance.setFilter);
    const undoStart=performance.now();
    await page.getByRole('button', { name: 'Hoàn tác ENC' }).click();
    await inspector.getByLabel('Kinh độ', { exact: true }).waitFor();
    assert.notEqual(await inspector.getByLabel('Kinh độ', { exact: true }).inputValue(), '105.123456789');
    await page.waitForFunction(async()=>{
      const source=window.encTestMap.getSource('enc-edits');if(!source)return false;
      const data=await source.getData();return Boolean(data.features[0]) && data.features[0].geometry.coordinates[0]!==105.123456789;
    });
    await page.getByRole('button', { name: 'Làm lại ENC' }).click();
    const redoLongitudeId=await inspector.getByLabel('Kinh độ',{exact:true}).getAttribute('id');
    await page.waitForFunction(id=>document.getElementById(id)?.value==='105.123456789',redoLongitudeId);
    assert.equal(await inspector.getByLabel('Kinh độ', { exact: true }).inputValue(), '105.123456789');
    await page.waitForFunction(async()=>{
      const data=await window.encTestMap.getSource('enc-edits').getData();return data.features[0]?.geometry.coordinates[0]===105.123456789;
    });
    assert.equal(await page.evaluate(()=>window.encPerformance.setFilter),filtersBefore,'undo/redo does not recompile unchanged base filters');
    console.log(`Undo+Redo UI/worker round trip at ${width}px while base tiles are held: ${Math.round(performance.now()-undoStart)} ms`);
    assert.ok(slowRequests>0);releaseSlow();
    await inspector.getByLabel('Tên đối tượng (OBJNAM)', { exact: true }).fill('Sau mất kết nối');
    loseResponse = true;
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await page.getByRole('button', { name: 'Kiểm tra lần lưu' }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Mở công cụ biên tập ENC' }).click();
    await page.getByRole('button', { name: 'Tiếp tục bản biên tập' }).click();
    await page.getByRole('button', { name: 'Kiểm tra lần lưu' }).click();
    await page.getByText('Đã lưu thay đổi vào không gian biên tập.', { exact: true }).waitFor();
    assert.equal(creates, 1, 'reload reused workspace');
    assert.equal(receipts.size, 2, 'lost response did not duplicate a commit');
    assert.deepEqual(commits.at(-1), commits.at(-2));
    // After reload, select a persisted overlay point using MapLibre's public event API.
    await page.evaluate(() => {
      let fiber = document.querySelector('.maplibregl-map')[Object.keys(document.querySelector('.maplibregl-map')).find(key => key.startsWith('__reactFiber$'))];
      for (; fiber; fiber = fiber.return) for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const map = hook.memoizedState?.current;
        if (map && typeof map.getSource === 'function') {
          window.encTestMap = map;
          if(!window.encPerformance){
            window.encPerformance={setStyle:0,setFilter:0};
            for(const method of ['setStyle','setFilter']){const original=map[method].bind(map);map[method]=(...args)=>{window.encPerformance[method]++;return original(...args);};}
          }
          return;
        }
      }
      throw new Error('Map ref missing');
    });
    const point = [...documents.values()][0];
    assert.ok(Math.abs(point.symbolScale-1.1)<1e-9,'reload and retry retain symbol size');
    await page.evaluate(coordinates => { window.encTestMap.jumpTo({ center: coordinates }); }, point.geometry.coordinates);
    await page.waitForFunction(() => window.encTestMap.getLayer('enc-edits-points') && window.encTestMap.queryRenderedFeatures({ layers: ['enc-edits-points'] }).length > 0);
    await page.evaluate(coordinates => {
      const map = window.encTestMap, point = map.project(coordinates);
      map.fire('click', { point, lngLat: { lng: coordinates[0], lat: coordinates[1] }, originalEvent: new MouseEvent('click') });
    }, point.geometry.coordinates);
    await inspector.waitFor();
    await inspector.getByRole('button', { name: 'Xóa điểm', exact: true }).click();
    await inspector.getByRole('button', { name: 'Xóa', exact: true }).click();
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await page.getByText('Đã lưu thay đổi vào không gian biên tập.', { exact: true }).waitFor();
    assert.equal(documents.size, 0, 'deleted local point removed from workspace');
    const exitStart=performance.now();
    const stylesBeforeExit=await page.evaluate(()=>window.encPerformance.setStyle);
    await page.getByRole('button',{name:'Về chế độ xem',exact:true}).click();
    await page.getByRole('button',{name:'Biên tập cell',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.encPerformance.setStyle),stylesBeforeExit,'return to view retains style');
    console.log(`Return to view UI at ${width}px: ${Math.round(performance.now()-exitStart)} ms`);
    await page.getByRole('button',{name:'Tiếp tục bản biên tập',exact:true}).click();
    await page.getByRole('button',{name:'Thêm điểm',exact:true}).waitFor();
    // Two ENC tabs must never overwrite one another's draft silently.
    const other = await context.newPage();
    other.on('pageerror', error => errors.push(error.message));
    other.on('dialog', dialog => dialog.accept());
    await other.goto(origin + '/?mode=enc');
    await other.getByRole('button', { name: 'Mở công cụ biên tập ENC' }).click();
    await other.getByRole('button', { name: 'Tiếp tục bản biên tập' }).click();
    await other.getByRole('button', { name: 'Thêm điểm', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Thêm điểm', exact: true }).click();
    await page.mouse.click(width < 700 ? 170 : 800, width < 700 ? 560 : 440);
    await page.getByRole('region', { name: 'Chỉnh sửa đối tượng ENC' }).waitFor();
    // Wait for this tab's CAS write before the stale tab attempts its write.
    await page.waitForTimeout(200);
    await other.getByRole('button', { name: 'Thêm điểm', exact: true }).click();
    await other.mouse.click(width < 700 ? 170 : 800, width < 700 ? 560 : 440);
    await other.getByText(/Bản nháp đã thay đổi ở tab khác/).waitFor();
    assert.ok(await other.getByRole('button', { name: 'Lưu', exact: true }).isDisabled());
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`ENC editing browser passed at ${width}px: create, exact position, save, undo/redo, reload, retry, delete, multi-tab CAS`);
  }
} finally { await browser.close(); }
