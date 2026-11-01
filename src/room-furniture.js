import {project} from './room-space.js';
import {OBJECT_TYPES} from './room-catalog.js';
const pts=p=>p.map(x=>x.join(' ')).join(' ');
export function furnitureArt(id,{on=false}={}){
 const f=OBJECT_TYPES[id].footprint,{u,v,w,d,height:h}=f,corners=[[u,v],[u+w,v],[u+w,v+d],[u,v+d]],top=corners.map(p=>project(p,h));
 const polygon=(points,fill)=>`<polygon points="${pts(points)}" fill="${fill}"/>`;
 const legs=corners.map(p=>{const a=project(p,h),b=project(p);return `<path d="M${a[0]-4} ${a[1]}L${b[0]-4} ${b[1]}l9 3V${a[1]}Z" fill="#bd8b53"/>`;}).join('');
 const shadow=polygon(corners.map(p=>project(p)),'#79634418');
 if(id==='lamp'){const p=project([u+w/2,v+d/2]);return `<g data-lamp="${on?'on':'off'}" stroke="#5d5144" stroke-width="2.5">${on?`<ellipse cx="${p[0]}" cy="${p[1]-112}" rx="55" ry="47" fill="#ffe095" opacity=".38" stroke="none"/>`:''}<ellipse cx="${p[0]}" cy="${p[1]}" rx="22" ry="9" fill="#d3af74"/><path d="M${p[0]} ${p[1]-2}V${p[1]-120}" stroke-width="7"/><path d="M${p[0]-22} ${p[1]-145}h44l13 42h-70Z" fill="${on?'#ffdf84':'#f1c382'}"/><path d="M${p[0]+4} ${p[1]-95}v24"/><circle cx="${p[0]+4}" cy="${p[1]-71}" r="4" fill="#c7844c"/></g>`;}
 if(id==='chair'){const back=[top[0],top[3]],raised=back.map(p=>[p[0],p[1]-62]);return `<g stroke="#65503d" stroke-width="3" stroke-linejoin="round">${shadow}${legs}${polygon([raised[0],raised[1],back[1],back[0]],'#d9a465')}${polygon(top,'#edc58a')}<path d="M${top[0].join(' ')}L${top[3].join(' ')}L${top[2].join(' ')}" fill="none" stroke="#9d6e40" stroke-width="6"/></g>`;}
 const pillow=[[u+.035,v+.025],[u+w-.035,v+.025],[u+w-.035,v+.12],[u+.035,v+.12]].map(p=>project(p,h+9));
 const blanket=[[u,v+.17],[u+w,v+.17],[u+w,v+d],[u,v+d]].map(p=>project(p,h+6));
 return `<g stroke="#62564c" stroke-width="3" stroke-linejoin="round">${shadow}${legs}${polygon([top[0],top[1],[top[1][0],top[1][1]-45],[top[0][0],top[0][1]-45]],'#d9aa71')}${polygon(corners.map(p=>project(p,h-12)),'#bf8a50')}${polygon(top,'#fff2d9')}${polygon(blanket,'#83b2cf')}${polygon(pillow,'#fff9e9')}<path d="M${blanket[0].join(' ')}L${blanket[1].join(' ')}" stroke="#bad6e5" stroke-width="5"/></g>`;
}
