const profiles=[{quality:'high',resolutionScale:1},{quality:'medium',resolutionScale:1},{quality:'low',resolutionScale:1},{quality:'low',resolutionScale:.8},{quality:'low',resolutionScale:.65}];
export function createAdaptiveQuality({targetFps=30}={}){
  let tier=1,setting='',enabled=true,elapsed=0,count=0,fast=0,cooldown=0,warmup=2,activeBefore=false;
  const base=q=>q==='high'?0:q==='low'?2:1;
  return {sample(seconds,{active=true,auto=true,quality='medium',shadows=true}={}){
    if(setting!==quality||enabled!==auto){setting=quality;enabled=auto;tier=base(quality);elapsed=count=fast=cooldown=0;warmup=2;}
    if(!active){elapsed=count=fast=0;warmup=1;activeBefore=false;}
    else if(auto&&Number.isFinite(seconds)&&seconds>0&&seconds<1){
      if(!activeBefore){warmup=Math.max(1,warmup);activeBefore=true;}
      const dt=Math.min(.2,seconds);cooldown=Math.max(0,cooldown-dt);
      if(warmup>0)warmup-=dt;
      else {
        elapsed+=dt;count++;
        if(elapsed>=2&&count>=12){
          const average=elapsed/count;
          if(average>1/(targetFps*.92)&&cooldown<=0&&tier<profiles.length-1){tier++;cooldown=4;fast=0;}
          else if(average<1/(targetFps*1.15)){fast+=elapsed;if(fast>=16&&cooldown<=0&&tier>base(quality)){tier--;cooldown=12;fast=0;}}
          else fast=0;
          elapsed=count=0;
        }
      }
    }
    if(!auto)tier=base(quality);
    return {...profiles[tier],shadows:shadows&&tier<2,tier,automatic:auto};
  },get tier(){return tier;}};
}
