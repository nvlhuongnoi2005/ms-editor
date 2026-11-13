import assert from 'node:assert/strict';
import test from 'node:test';
import {loadSource} from './test-source.mjs';
const {startRecoveringPoll}=await import(await loadSource('../src/domains/enc/recoveringPoll.ts'));
function environment(){
  const env={hidden:false,timer:undefined,delay:0,listener:undefined,random:()=>.5,
    paused:()=>env.hidden,subscribe:fn=>{env.listener=fn;return()=>env.listener=undefined;},
    setTimer:(fn,ms)=>{env.timer=fn;env.delay=ms;return 1;},clearTimer:()=>env.timer=undefined};
  env.tick=async()=>{const fn=env.timer;env.timer=undefined;fn?.();for(let i=0;i<10;i++)await Promise.resolve();};return env;
}
test('catalog polling retries errors with bounded backoff and resets after recovery',async()=>{
  const env=environment(),errors=[];let requests=0;
  const stop=startRecoveringPoll(async()=>{requests++;if(requests<3)throw Error('offline');return 3000;},e=>errors.push(e),env);
  await env.tick();assert.equal(env.delay,5000);await env.tick();assert.equal(env.delay,10000);
  await env.tick();assert.equal(env.delay,3000);assert.equal(errors.length,2);stop();assert.equal(env.timer,undefined);
});
test('hidden tabs suspend, resume once, and never overlap requests',async()=>{
  const env=environment();let finish,requests=0,signal;
  const stop=startRecoveringPoll(s=>{requests++;signal=s;return new Promise(resolve=>finish=resolve);},()=>assert.fail('cancel is not an error'),env);
  await env.tick();env.listener();env.listener();assert.equal(requests,1);
  env.hidden=true;env.listener();assert.equal(signal.aborted,true);finish(10000);await env.tick();assert.equal(env.timer,undefined);
  env.hidden=false;env.listener();assert.equal(env.delay,0);await env.tick();assert.equal(requests,2);
  stop();assert.equal(signal.aborted,true);finish(10000);await env.tick();assert.equal(env.timer,undefined);assert.equal(env.listener,undefined);
});
test('polling jitter never exceeds the sixty second retry cap',async()=>{
  const env=environment();env.random=()=>1;
  const stop=startRecoveringPoll(async()=>{throw Error('unavailable');},()=>{},env);
  for(let i=0;i<12;i++){await env.tick();assert.ok(env.delay<=60000);}
  assert.equal(env.delay,60000);stop();
});
