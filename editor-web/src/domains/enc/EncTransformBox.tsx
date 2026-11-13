import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Map as EncMap } from 'maplibre-gl';
import type { EncEditFeature } from './editing';
import type { EncTheme } from './style';
import { geometryPositions, geometryCenter, projectPosition, transformGeometry, symbolScale } from './geometryTransform';
import { markerElement, pointRotation } from './pointSymbols';

type Props={map:EncMap;feature:EncEditFeature;theme:EncTheme;disabled:boolean;onChange:(feature:EncEditFeature)=>void;onError:(message:string)=>void};
const corners=['nw','ne','se','sw'] as const;

/** Screen-space controls; persist exactly once at gesture end, never per pointer event. */
export function EncTransformBox({map,feature,theme,disabled,onChange,onError}:Props){
  const box=useRef<HTMLDivElement>(null),drawing=useRef<SVGPathElement>(null),icon=useRef<HTMLDivElement>(null);
  const dragged=useRef(false);
  useEffect(()=>{
    const element=box.current;if(!element)return;
    const point=feature.geometry.type==='Point';
    const movable=!disabled&&feature.canMove;
    const scalable=!disabled&&feature.objectClass!=='SOUNDG'&&(point||feature.canMove);
    let positions:number[][],center:[number,number];
    try{positions=geometryPositions(feature.geometry);center=geometryCenter(feature.geometry);}catch(error){onError((error as Error).message);return;}
    let west=Infinity,south=Infinity,east=-Infinity,north=-Infinity;
    for(const position of positions){west=Math.min(west,position[0]);east=Math.max(east,position[0]);south=Math.min(south,position[1]);north=Math.max(north,position[1]);}
    const extent:[number,number][]=[[west,south],[east,south],[east,north],[west,north]];
    let bounds={left:0,top:0,width:0,height:0};
    let gesture:{id:number;mode:'move'|'scale';x:number;y:number;cx:number;cy:number;radius:number;target:HTMLElement}|undefined;
    let frame:number|undefined,last:PointerEvent|undefined;
    let candidate=feature;
    let delta:[number,number]=[0,0],factor=1;
    const render=()=>{
      if(gesture)return;
      const screen=extent.map(position=>map.project(position));
      let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
      for(const p of screen){left=Math.min(left,p.x);right=Math.max(right,p.x);top=Math.min(top,p.y);bottom=Math.max(bottom,p.y);}
      const margin=point?Math.max(22,22*symbolScale(feature.symbolScale)):6;
      bounds={left:left-margin,top:top-margin,width:Math.max(24,right-left+margin*2),height:Math.max(24,bottom-top+margin*2)};
      Object.assign(element.style,{left:`${bounds.left}px`,top:`${bounds.top}px`,width:`${bounds.width}px`,height:`${bounds.height}px`,transform:''});
      if(drawing.current){
        const paths:string[]=[];
        const visit=(value:unknown)=>{
          if(!Array.isArray(value))return;
          if(Array.isArray(value[0])&&typeof value[0][0]==='number')paths.push(value.map((p:number[],i:number)=>{const s=map.project(p as [number,number]);return `${i?'L':'M'}${s.x-bounds.left},${s.y-bounds.top}`;}).join(' '));
          else value.forEach(visit);
        };
        // Large objects retain their exact geometry; only the auxiliary SVG
        // outline is omitted, keeping camera movement independent of vertex count.
        if(!point&&positions.length<=4096)visit(feature.geometry.coordinates);
        drawing.current.setAttribute('d',paths.join(' '));
      }
      if(point&&icon.current?.firstElementChild)(icon.current.firstElementChild as HTMLElement).style.transform=`rotate(${pointRotation(feature.objectClass,feature.attributes)-map.getBearing()}deg)`;
    };
    if(point&&icon.current){
      const image=markerElement(feature.objectClass,feature.attributes,theme,symbolScale(feature.symbolScale));
      image.style.pointerEvents='none';icon.current.replaceChildren(image);
    }
    const restore=()=>{if(frame!==undefined)cancelAnimationFrame(frame);frame=undefined;last=undefined;gesture=undefined;element.classList.remove('is-transforming');render();};
    const preview=()=>{
      frame=undefined;if(!gesture||!last)return;
      const dx=last.clientX-gesture.x,dy=last.clientY-gesture.y;
      if(gesture.mode==='move'){
        const a=map.unproject([gesture.cx,gesture.cy]),b=map.unproject([gesture.cx+dx,gesture.cy+dy]);
        const pa=projectPosition([a.lng,a.lat]),pb=projectPosition([b.lng,b.lat]);
        delta=[pb[0]-pa[0],pb[1]-pa[1]];
        element.style.transform=`translate(${dx}px,${dy}px)`;
      }else{
        let scale=Math.max(0.05,Math.min(20,Math.hypot(last.clientX-(gesture.cx+map.getCanvas().getBoundingClientRect().left),last.clientY-(gesture.cy+map.getCanvas().getBoundingClientRect().top))/gesture.radius));
        if(point){const size=symbolScale((feature.symbolScale??1)*scale);candidate={...feature,symbolScale:size===1?undefined:size};scale=size/(feature.symbolScale??1);}
        else factor=scale;
        element.style.transform=`scale(${scale})`;
      }
    };
    const move=(event:PointerEvent)=>{
      if(!gesture||gesture.id!==event.pointerId)return;
      event.preventDefault();last=event;
      if(frame===undefined)frame=requestAnimationFrame(()=>{try{preview();}catch(error){onError((error as Error).message);cancel();}});
    };
    const release=()=>{const active=gesture;if(active?.target.hasPointerCapture(active.id))active.target.releasePointerCapture(active.id);};
    const cancel=()=>{release();restore();};
    const end=(event:PointerEvent)=>{
      if(!gesture||event.pointerId!==gesture.id)return;
      if(Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)<2){cancel();return;}
      last=event;
      dragged.current=true;
      try{
        preview();
        // The visual preview uses CSS. Traverse large coordinate arrays only
        // once, on release, rather than on every pointer movement.
        const after=gesture.mode==='move'||!point?{...feature,geometry:transformGeometry(feature.geometry,center,delta,factor)}:candidate;
        release();restore();if(after!==feature)onChange(after);
      }catch(error){cancel();onError((error as Error).message);}
    };
    const down=(event:PointerEvent)=>{
      if(event.button!==0||gesture)return;
      const target=(event.target as HTMLElement).closest<HTMLElement>('[data-transform]');if(!target)return;
      const mode=target.dataset.transform as 'move'|'scale';
      if(mode==='move'?!movable:!scalable){event.preventDefault();event.stopPropagation();return;}
      event.preventDefault();event.stopPropagation();
      dragged.current=false;
      const rect=map.getCanvas().getBoundingClientRect();
      const cx=bounds.left+bounds.width/2,cy=bounds.top+bounds.height/2;
      gesture={id:event.pointerId,mode,x:event.clientX,y:event.clientY,cx,cy,radius:Math.max(1,Math.hypot(event.clientX-rect.left-cx,event.clientY-rect.top-cy)),target};candidate=feature;delta=[0,0];factor=1;
      target.setPointerCapture(event.pointerId);element.classList.add('is-transforming');
    };
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&gesture){event.preventDefault();event.stopPropagation();cancel();return;}
      if(event.target!==element)return;
      const directions:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
      const direction=directions[event.key];
      if(!direction||!movable)return;
      event.preventDefault();event.stopPropagation();
      const a=map.unproject([bounds.left,bounds.top]),b=map.unproject([bounds.left+direction[0]*(event.shiftKey?10:1),bounds.top+direction[1]*(event.shiftKey?10:1)]);
      try{const pa=projectPosition([a.lng,a.lat]),pb=projectPosition([b.lng,b.lat]);onChange({...feature,geometry:transformGeometry(feature.geometry,center,[pb[0]-pa[0],pb[1]-pa[1]])});}catch(error){onError((error as Error).message);}
    };
    element.addEventListener('pointerdown',down);element.addEventListener('pointermove',move);element.addEventListener('pointerup',end);element.addEventListener('pointercancel',cancel);element.addEventListener('keydown',key);
    // Map movement invalidates screen coordinates; cancel rather than applying an outdated transform.
    map.on('movestart',cancel);map.on('move',render);map.on('resize',render);render();
    window.addEventListener('blur',cancel);
    return()=>{cancel();window.removeEventListener('blur',cancel);map.off('movestart',cancel);map.off('move',render);map.off('resize',render);element.removeEventListener('pointerdown',down);element.removeEventListener('pointermove',move);element.removeEventListener('pointerup',end);element.removeEventListener('pointercancel',cancel);element.removeEventListener('keydown',key);};
  },[map,feature,theme,disabled,onChange,onError]);
  const point=feature.geometry.type==='Point';
  const scalable=!disabled&&feature.objectClass!=='SOUNDG'&&(point||feature.canMove);
  return createPortal(<div ref={box} className={`enc-transform-box${feature.canMove&&!disabled?' is-movable':''}`} data-transform="move" tabIndex={0} role="group" aria-label={`Khung thao tác ${feature.objectClass}`} onContextMenu={event=>{
    event.preventDefault();event.stopPropagation();const rect=map.getCanvas().getBoundingClientRect();const point={x:event.clientX-rect.left,y:event.clientY-rect.top};
    map.fire('contextmenu',{point,lngLat:map.unproject([point.x,point.y]),originalEvent:event.nativeEvent,editKey:feature.key});
  }} onClick={event=>{
    event.stopPropagation();
    if(dragged.current){dragged.current=false;return;}
    if((event.target as HTMLElement).closest('button'))return;
    const rect=map.getCanvas().getBoundingClientRect();const point:[number,number]=[event.clientX-rect.left,event.clientY-rect.top];
    map.fire('click',{point:{x:point[0],y:point[1]},lngLat:map.unproject(point),originalEvent:event.nativeEvent});
  }}>
    <span className="enc-transform-caption">{feature.objectClass}{point?` · ${Math.round((feature.symbolScale??1)*100)}%`:''}{!feature.canMove?' · Khóa vị trí':''}</span>
    <svg className="enc-transform-geometry" aria-hidden="true"><path ref={drawing}/></svg>
    {point&&<div ref={icon} className="enc-transform-icon"/>}
    {scalable&&corners.map(corner=><button key={corner} type="button" data-transform="scale" className={`enc-transform-handle ${corner}`} aria-label={`Đổi kích thước ${corner}`} onKeyDown={event=>{
      if(!['ArrowUp','ArrowRight','ArrowDown','ArrowLeft','+','-'].includes(event.key))return;
      event.preventDefault();event.stopPropagation();const scale=['ArrowUp','ArrowRight','+'].includes(event.key)?1.1:1/1.1;
      try{const size=symbolScale((feature.symbolScale??1)*scale);onChange(point?{...feature,symbolScale:size===1?undefined:size}:{...feature,geometry:transformGeometry(feature.geometry,geometryCenter(feature.geometry),[0,0],scale)});}catch(error){onError((error as Error).message);}
    }}/>) }
  </div>,map.getContainer());
}
