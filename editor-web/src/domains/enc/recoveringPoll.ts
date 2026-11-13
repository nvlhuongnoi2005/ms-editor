type Environment={paused:()=>boolean;subscribe:(resume:()=>void)=>()=>void;setTimer:(fn:()=>void,ms:number)=>ReturnType<typeof setTimeout>;clearTimer:(timer:ReturnType<typeof setTimeout>)=>void;random:()=>number};

/** One request at a time. Hidden/offline tabs sleep; failures always get a retry. */
export function startRecoveringPoll(task:(signal:AbortSignal)=>Promise<number>,onError:(error:unknown)=>void,environment?:Environment){
  const env:Environment=environment??{
    paused:()=>document.hidden||!navigator.onLine,
    subscribe:resume=>{
      document.addEventListener('visibilitychange',resume);window.addEventListener('online',resume);window.addEventListener('offline',resume);
      return()=>{document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',resume);window.removeEventListener('offline',resume);};
    },setTimer:(fn,ms)=>setTimeout(fn,ms),clearTimer:timer=>clearTimeout(timer),random:Math.random,
  };
  let stopped=false,running=false,wake=false,failures=0;
  let timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
  const clear=()=>{if(timer!==undefined){env.clearTimer(timer);timer=undefined;}};
  const schedule=(delay:number)=>{clear();if(!stopped&&!env.paused())timer=env.setTimer(()=>void run(),delay);};
  const run=async()=>{
    if(stopped||env.paused()||running)return;
    running=true;controller=new AbortController();let delay=10_000;
    try{delay=await task(controller.signal);failures=0;}
    catch(error){if(!controller.signal.aborted&&!stopped){failures++;onError(error);delay=Math.min(60_000,5_000*2**Math.min(failures-1,4)*(.8+.4*env.random()));}}
    finally{running=false;controller=undefined;if(wake){wake=false;delay=0;}schedule(delay);}
  };
  const resume=()=>{
    clear();
    if(env.paused()){controller?.abort();return;}
    if(running){wake=true;return;}
    schedule(0);
  };
  const unsubscribe=env.subscribe(resume);schedule(0);
  return()=>{stopped=true;clear();controller?.abort();unsubscribe();};
}
