// Offline atlas packer: keep supplied pixels, rasterise vetted SVG additions,
// then pack all three themes with identical geometry. No npm install required.
// Usage from repo root: node ENC/tools/build_sprites.mjs
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../sprites/',import.meta.url));
const manifest=JSON.parse(await readFile(join(root,'sources/manifest.json'),'utf8'));
const colours=JSON.parse(await readFile(join(root,'sources/colors.json'),'utf8')).library;
const themes=['day','dusk','night'];
const base=Object.fromEntries(await Promise.all(themes.map(async theme=>[theme,JSON.parse(await readFile(join(root,'base',theme+'_simplified@2x.json'),'utf8'))])));
const entries=Object.fromEntries(Object.entries(base.day).map(([name,r])=>[name,{...r}]));
const metadata={};
const svgs={};
for(const [name,info] of Object.entries(manifest.entries)){
  if(entries[name]) throw Error('Addition duplicates supplied symbol '+name);
  const svg=await readFile(join(root,'sources/svg',name+'.svg'),'utf8');
  // Match the 96 dpi @2x convention of the supplied atlas. ViewBox includes
  // transparent margins and the pivot; do not crop to the visible ink bounds.
  const width=Number(/\bwidth="([\d.]+)mm"/.exec(svg)?.[1]);
  const height=Number(/\bheight="([\d.]+)mm"/.exec(svg)?.[1]);
  const view=/\bviewBox="([^"]+)"/.exec(svg)?.[1].trim().split(/\s+/).map(Number);
  if(!(width>0&&height>0&&view?.length===4))throw Error('Unsupported SVG dimensions '+name);
  entries[name]={width:Math.ceil(width*192/25.4),height:Math.ceil(height*192/25.4),pixelRatio:2};
  metadata[name]={...info,pivot:[-view[0]/view[2]*entries[name].width,-view[1]/view[3]*entries[name].height]};
  svgs[name]=svg;
}
const lines={LC_CBLSUB06:{symbol:'CBLSUB06',size:[128,8],cataloguePage:482,description:'Đường cáp ngầm.'},
  LC_PIPSOL05:{symbol:'PIPSOL05',size:[28,8],cataloguePage:513,description:'Đường ống dầu, khí hoặc chưa rõ loại.'},
  LC_PIPSOL06:{symbol:'PIPSOL06',size:[24,6],cataloguePage:514,description:'Đường ống nước, xả thải hoặc hút nước.'},
  LC_LOWACC21:{symbol:'LOWACC21',size:[64,12],cataloguePage:504,description:'Đường bờ hoặc công trình bờ có vị trí chưa chắc chắn.'}};
for(const [name,info] of Object.entries(lines)){
  entries[name]={width:info.size[0]*2,height:info.size[1]*2,pixelRatio:2};
  metadata[name]={kind:'LC',symbol:info.symbol,cataloguePage:info.cataloguePage,description:info.description,sourceLibrary:'Viewer SVG texture; not a complete LC interpreter'};
  svgs[name]=await readFile(join(root,'sources/lines',name+'.svg'),'utf8');
}
// Ascending name breaks equal-size ties, giving reproducible JSON coordinates.
const ordered=Object.keys(entries).sort((a,b)=>entries[b].height-entries[a].height||entries[b].width-entries[a].width||a.localeCompare(b,'en'));
const atlasWidth=2048,gutter=2;
let x=gutter,y=gutter,rowHeight=0;
for(const name of ordered){
  const r=entries[name];
  if(r.width+gutter*2>atlasWidth)throw Error('Symbol wider than atlas '+name);
  if(x+r.width+gutter>atlasWidth){x=gutter;y+=rowHeight+gutter;rowHeight=0;}
  r.x=x;r.y=y;x+=r.width+gutter;rowHeight=Math.max(rowHeight,r.height);
}
const atlasHeight=y+rowHeight+gutter;
if(atlasHeight>4096)throw Error('Atlas exceeds conservative texture budget');
if(entries.SOUNDSA1){
  const r=entries.SOUNDSA1;
  r.stretchX=[[2,r.width-2]];r.stretchY=[[2,r.height-6]];r.content=[0,0,r.width,r.height-4];
}
const sorted=Object.fromEntries(Object.keys(entries).sort().map(name=>[name,entries[name]]));
const css=theme=>'.layout{display:none}.sl{stroke-linecap:round;stroke-linejoin:round}.f0{fill:none}'+
  Object.entries(colours[theme.toUpperCase()]).map(([code,col])=>`.s${code}{stroke:${col}}.f${code}{fill:${col}}`).join('');
const input={base,entries:sorted,metadata,svgs,themes,css:Object.fromEntries(themes.map(t=>[t,css(t)])),width:atlasWidth,height:atlasHeight};
const server=createServer(async(req,res)=>{
  if(req.url==='/input'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(input));return;}
  const theme=/^\/base\/(day|dusk|night)\.png$/.exec(req.url??'')?.[1];
  if(theme){res.setHeader('Content-Type','image/png');res.end(await readFile(join(root,'base',theme+'_simplified@2x.png')));return;}
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>ENC atlas builder</title>');return;}
  res.writeHead(404).end();
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const address=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(join(tmpdir(),'enc-atlas-build-'));
const staging=await mkdtemp(join(tmpdir(),'enc-atlas-output-'));
const chrome=spawn(process.env.CHROME_BIN??'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run',address],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let ws,call;
try{
  let page;
  for(let i=0;i<80;i++){
    try{const port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];page=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(p=>p.type==='page');if(page)break;}catch{}
    await pause(100);
  }
  if(!page)throw Error('Chrome did not start');
  ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let next=0;const pending=new Map();
  call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(JSON.stringify(m.error))):p?.resolve(m.result);}});
  await call('Page.enable');await call('Page.navigate',{url:address});
  const result=await call('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{
    const d=await(await fetch('${address}/input')).json(),outputs={};
    async function image(src){const img=new Image();img.src=src;await img.decode();return img;}
    for(const theme of d.themes){
      const canvas=document.createElement('canvas');canvas.width=d.width;canvas.height=d.height;
      const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
      const supplied=await image('${address}/base/'+theme+'.png');
      for(const [name,r] of Object.entries(d.entries)){
        const old=d.base[theme][name];
        if(old){ctx.drawImage(supplied,old.x,old.y,old.width,old.height,r.x,r.y,r.width,r.height);continue;}
        let svg=d.svgs[name].replace(/<\\?xml[\\s\\S]*?\\?>/g,'');
        svg=svg.replace('</svg>','<style>'+d.css[theme]+'</style></svg>');
        const img=await image('data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(svg))));
        ctx.drawImage(img,r.x,r.y,r.width,r.height);
        const pixels=ctx.getImageData(r.x,r.y,r.width,r.height).data;
        let occupied=false;for(let i=3;i<pixels.length;i+=4)if(pixels[i]){occupied=true;break;}
        if(!occupied)throw Error('Empty rendered symbol '+theme+'/'+name);
      }
      outputs[theme]=canvas.toDataURL('image/png').split(',')[1];
    }
    return outputs;
  })()`});
  if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);
  // Finish every theme before replacing any served output.
  for(const theme of themes){
    await writeFile(join(staging,theme+'.png'),Buffer.from(result.result.value[theme],'base64'));
  }
  for(const theme of themes){
    await writeFile(join(root,theme+'_simplified@2x.png'),await readFile(join(staging,theme+'.png')));
    await writeFile(join(root,theme+'_simplified@2x.json'),JSON.stringify(sorted,null,4)+'\n');
  }
  await writeFile(join(root,'additions.json'),JSON.stringify({revision:14,baseCount:Object.keys(base.day).length,addedCount:Object.keys(metadata).length,totalCount:Object.keys(entries).length,width:atlasWidth,height:atlasHeight,entries:metadata},null,2)+'\n');
  console.log(JSON.stringify({base:Object.keys(base.day).length,added:Object.keys(metadata).length,total:Object.keys(entries).length,size:[atlasWidth,atlasHeight],themes}));
}finally{
  if(call)await call('Browser.close').catch(()=>{});ws?.close();chrome.kill();server.close();
}
