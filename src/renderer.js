import { appearance, countries, professions } from './catalog.js';
import { asset, flag, chairArt, boxLayers } from './assets.js';
import { POSES, BOX, FIT, lerp, ease, mixPose, bodyFrame, articulate, attachment, flagAnchor, heldAtWrist, attachmentFlight, transformAt, propTransform } from './geometry.js';
export { POSES, mixPose } from './geometry.js';
const copyPose=pose=>mixPose(pose,pose,0);
const point=p=>p.join(' ');
export class Renderer {
  constructor(profile) {
    this.actor=document.querySelector('#actor');this.arm=document.querySelector('#front-arm');
    this.held=document.querySelector('#held');this.inside=document.querySelector('#held-inside');
    this.box=document.querySelector('#accessory-box');this.boxBack=document.querySelector('#accessory-box-back');
    this.hint=document.querySelector('#greeting-hint');
    document.querySelector('#chair').innerHTML=chairArt();
    const layers=boxLayers();this.boxBack.innerHTML=layers.back;
    document.querySelector('#box-contents').innerHTML=layers.contents;document.querySelector('#box-front').innerHTML=layers.front;
    this.generation=0;this.animating=false;this.visible=true;this.motionReduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.reset(profile);
    let last=0;
    const idle=time=>{
      if(!this.animating&&this.visible&&time-last>40){
        last=time;const p=copyPose(this.pose);
        if(!this.motionReduced){p.h[1]+=Math.sin(time/700)*(this.asleep?2:1);p.n[1]+=Math.sin(time/700)*.5;}
        if(this.asleep&&!this.motionReduced)p.angle+=Math.sin(time/1000)*2;
        else if(!this.asleep&&time%4700<130)p.eye=.05;
        this.draw(p);
      }
      this.idleFrame=requestAnimationFrame(idle);
    };this.idleFrame=requestAnimationFrame(idle);
  }
  setPhase(phase){this.phase=phase;this.actor.dataset.phase=phase;}
  updateBox(angle=0){
    const transform=`rotate(${angle} ${BOX.x} ${BOX.y}) ${propTransform(BOX)}`;
    this.box.setAttribute('transform',transform);this.boxBack.setAttribute('transform',transform);
  }
  clearHeld(){for(const layer of [this.held,this.inside]){layer.replaceChildren();layer.removeAttribute('transform');}}
  reset(profile){
    this.generation++;this.animating=false;this.profile={...profile};this.look=appearance(profile);this.asleep=!profile.awake;
    this.pose=copyPose(this.asleep?POSES.sleep:POSES.stand);this.hideSlot=null;this.hideHandForSearch=false;this.question=false;
    this.clearHeld();this.updateBox();this.setPhase(this.asleep?'sleep':'stand');
    this.hint.classList.toggle('dismissed',!this.asleep);this.hint.setAttribute('aria-hidden',String(!this.asleep));this.draw();
  }
  setProfile(profile){this.profile={...profile};this.look=appearance(profile);this.draw();}
  // The portrait uses both character layers, preserving the existing world screen.
  portraitMarkup(){return this.actor.innerHTML+this.arm.innerHTML;}
  // Level 2 uses the same skeleton, face and equipped appearance in its own scene.
  roomMarkup(pose,{using=false,question=false,facing='right'}={}){
    const previous={asleep:this.asleep,question:this.question,hideHandForSearch:this.hideHandForSearch,roomView:this.roomView};
    this.asleep=false;this.question=question;this.hideHandForSearch=using;this.roomView=facing;this.draw(pose);
    const markup=this.portraitMarkup();Object.assign(this,previous);return markup;
  }
  tween(duration,update){
    const generation=this.generation;this.animating=true;
    duration=this.motionReduced?Math.min(duration,220):duration;
    return new Promise(resolve=>{
      const start=performance.now();
      const frame=now=>{
        if(generation!==this.generation){resolve(false);return;}
        const t=Math.min(1,(now-start)/duration);this.actor.dataset.frame=t<.33?'early':t<.66?'middle':'late';update(t);
        if(t<1)requestAnimationFrame(frame);else{this.animating=false;resolve(true);}
      };requestAnimationFrame(frame);
    });
  }
  move(target,duration){const from=copyPose(this.pose);return this.tween(duration,t=>{this.pose=mixPose(from,target,ease(t));this.draw();});}
  anchor(slot,pose=this.pose,look=this.look){const at=attachment(slot,pose,look);return slot==='back'&&this.roomView==='back'?{...at,x:pose.n[0],y:pose.n[1]+95}:at;}
  placed(id,slot,pose){
    return !id||this.hideSlot===slot||(slot==='hand'&&this.hideHandForSearch)?'':`<g data-slot="${slot}" data-asset="${id}" transform="${transformAt(this.anchor(slot,pose))}">${asset(id)}</g>`;
  }
  draw(raw=this.pose){
    const p=articulate(raw),frame=bodyFrame(p);
    const limb=(points,width=5)=>`<path d="M${points.length===3?point(points[0])+'Q'+point(points[1])+' '+point(points[2]):points.map(point).join('L')}" fill="none" stroke="#25272c" stroke-width="${width+1}"/><path d="M${points.length===3?point(points[0])+'Q'+point(points[1])+' '+point(points[2]):points.map(point).join('L')}" fill="none" stroke="#25272c" stroke-width="${width}"/>`;
    const [hx,hy]=p.h,[nx,ny]=p.n,[px,py]=p.p,[sx,sy]=frame.side;
    const torso=`M${nx-sx*14} ${ny-sy*14}Q${lerp(nx,px,.5)-sx*22} ${lerp(ny,py,.5)-sy*22} ${px-sx*19} ${py-sy*19}Q${px-sy*10} ${py+sx*10} ${px+sx*19} ${py+sy*19}Q${lerp(nx,px,.5)+sx*17} ${lerp(ny,py,.5)+sy*17} ${nx+sx*14} ${ny+sy*14}Z`;
    const hair=this.look.hair==='bob'?'<path d="M-54-25Q-80 7-64 64L-35 54L-30-10M52-25Q76 7 64 62L38 53L29-10" fill="#49423f" stroke="#25272c" stroke-width="5"/>':'';
    const fringe=this.look.hair==='tuft'?'<path d="M-48-35Q-25-76 14-64L42-46L13-39L-3-49L-15-36L-29-43Z" fill="#49423f" stroke="#25272c" stroke-width="3"/>':this.look.hair==='bob'?'<path d="M-53-28Q-50-64-7-63Q36-67 53-30Q26-32 7-47Q-14-28-53-28Z" fill="#49423f" stroke="#25272c" stroke-width="3"/>':'';
    const back=this.roomView==='back',front=this.roomView==='front';
    const eyes=back?'':p.eye<.15?'<path d="M-16 7Q-8 17 0 7M20 5Q28 15 36 5" fill="none" stroke="#25272c" stroke-width="5"/>':`<ellipse cx="${front?-18:-6}" cy="9" rx="4" ry="${6*p.eye}" fill="#25272c"/><ellipse cx="${front?18:27}" cy="7" rx="4" ry="${6*p.eye}" fill="#25272c"/>`;
    this.actor.dataset.pose=this.asleep?'sleeping':this.animating?'moving':'standing';
    this.actor.innerHTML=`<ellipse cx="${this.asleep?px+16:(p.la[0]+p.ra[0])/2+10}" cy="681" rx="75" ry="11" fill="#31313d" opacity=".08"/>
      <g stroke-linecap="round" stroke-linejoin="round">${back?'':this.placed(this.look.back,'back',p)}
      <g data-part="far-leg">${limb([frame.hipLeft,p.lk,p.la,p.lf])}</g><g data-part="near-leg">${limb([frame.hipRight,p.rk,p.ra,p.rf])}</g>
      <g data-part="rear-arm">${limb([frame.shoulderLeft,p.le,p.lw])}</g><path data-part="torso" d="${torso}" fill="#fff" stroke="#25272c" stroke-width="6"/>
      ${back?this.placed(this.look.back,'back',p):this.placed(this.look.body,'body',p)}
      <g data-part="head" transform="translate(${hx} ${hy}) rotate(${p.angle})">${hair}<ellipse rx="62" ry="62" fill="${back&&this.look.hair?'#49423f':'#fff'}" stroke="#25272c" stroke-width="7"/>${back?'':fringe}${eyes}
      ${back?'':`<path d="${this.asleep?'M11 32Q18 28 24 32':this.question?'M11 31Q18 25 25 30':front?'M-13 28Q0 41 15 28':'M6 30Q18 42 31 27'}" fill="none" stroke="#25272c" stroke-width="3.5"/>`}${this.placedHead()}</g>
      ${this.look.flag?`<g data-slot="flag" data-flag="${this.look.flag}" transform="${transformAt(flagAnchor(p))}">${flag(this.look.flag)}</g>`:''}
      ${this.question?`<text x="${hx+73}" y="${hy-72}" font-family="Segoe UI,sans-serif" font-size="45" font-weight="700" fill="#dfad43">?</text>`:''}
      ${this.asleep?`<g class="sleep-z" transform="translate(${hx+60} ${hy-78}) rotate(-14)"><text fill="#454448" font-size="37" font-style="italic" font-weight="700">Z<tspan dy="-11" font-size="28">z</tspan><tspan dy="-8" font-size="20">z…</tspan></text></g>`:''}</g>`;
    this.arm.innerHTML=`<g data-part="front-arm" stroke-linecap="round" stroke-linejoin="round">${limb([frame.shoulderRight,p.re,p.rw])}${this.placed(this.look.hand,'hand',p)}</g>`;
  }
  placedHead(){
    const id=this.look.hat,fit=FIT[id];
    return id&&this.hideSlot!=='hat'?`<g data-slot="hat" data-asset="${id}" transform="translate(${fit.x||0} ${fit.y}) scale(${fit.scale})">${asset(id)}</g>`:'';
  }
  async wake(){
    if(!this.asleep)return true;
    this.setPhase('wake');if(!await this.move(POSES.seated,700))return false;
    this.asleep=false;this.hint.classList.add('dismissed');this.hint.setAttribute('aria-hidden','true');
    this.setPhase('rise');if(!await this.move(POSES.rise,750))return false;
    const from=copyPose(this.pose);
    const done=await this.tween(850,t=>{
      this.pose=mixPose(from,POSES.stand,ease(t));
      // Transfer weight onto the planted foot; the other foot lifts slightly as it moves clear of the chair.
      this.pose.ra[1]-=Math.sin(t*Math.PI)*16;this.pose.rf[1]-=Math.sin(t*Math.PI)*16;this.draw();
    });
    if(done)this.setPhase('stand');return done;
  }
  async confused(){
    const from=copyPose(this.pose);this.question=true;this.setPhase('confused');
    const done=await this.tween(1100,t=>{this.pose=copyPose(from);this.pose.angle+=Math.sin(t*Math.PI)*16;this.draw();});
    if(done){this.pose=from;this.question=false;this.setPhase(this.asleep?'sleep':'stand');this.draw();}return done;
  }
  async changeAppearance(next){
    const from=copyPose(this.pose);let switched=false;
    return this.tween(550,t=>{if(t>.45&&!switched){this.look=appearance(next);switched=true;}this.pose=copyPose(from);this.pose.h[1]-=Math.sin(t*Math.PI)*6;this.draw();});
  }
  async equip(command,next){
    const nextLook=appearance(next),job=professions[next.profession];
    const flagOnly=command.field==='country'&&job?.slot==='hat';
    const slot=command.field==='country'?'hat':professions[command.value].slot;
    const id=command.field==='country'?countries[command.value].hat:professions[command.value].asset;
    this.hideHandForSearch=true;
    this.setPhase('turn');if(!await this.move(mixPose(this.pose,POSES.search,.15),200))return false;
    this.setPhase('reach');if(!await this.move(POSES.search,650))return false;
    this.setPhase('search');const base=copyPose(this.pose);
    if(!await this.tween(900,t=>{
      this.pose=copyPose(base);this.pose.rw[1]+=Math.sin(t*Math.PI*6)*5;this.pose.rw[0]+=Math.sin(t*Math.PI*6)*2;
      this.draw();this.updateBox(Math.sin(t*Math.PI*6)*.55);
    }))return false;
    this.updateBox();this.setPhase('lift');
    this.inside.innerHTML=flagOnly?flag(countries[command.value].flag):asset(id);
    if(!await this.moveWithHeld(POSES.show,700,id,flagOnly))return false;
    this.setPhase('show');if(!await this.tween(350,()=>this.draw()))return false;
    this.hideSlot=flagOnly?null:slot;this.setPhase('attach');
    const from=copyPose(this.pose),start=heldAtWrist(id,from,flagOnly);
    if(!await this.tween(900,t=>{
      const e=ease(t);this.pose=mixPose(from,POSES.stand,e);this.draw();
      const end=flagOnly?flagAnchor(POSES.stand):attachment(slot,POSES.stand,nextLook);
      const at=attachmentFlight(start,end,t);
      this.held.setAttribute('transform',transformAt(at));
    }))return false;
    this.clearHeld();this.hideSlot=null;this.hideHandForSearch=false;this.look=nextLook;this.pose=copyPose(POSES.stand);this.setPhase('stand');this.draw();return true;
  }
  async moveWithHeld(target,duration,id,flagOnly){
    const from=copyPose(this.pose);let emerged=false;
    return this.tween(duration,t=>{
      this.pose=mixPose(from,target,ease(t));this.draw();
      if(t>=.72&&!emerged){this.held.append(...this.inside.childNodes);this.inside.removeAttribute('transform');emerged=true;}
      const layer=emerged?this.held:this.inside;
      layer.setAttribute('transform',transformAt(heldAtWrist(id,this.pose,flagOnly)));
    });
  }
}
