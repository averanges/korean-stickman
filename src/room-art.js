import {project,TABLE} from './room-state.js';
const pts=points=>points.map(p=>p.join(',')).join(' ');
export function roomArt(){
  const back=project([0,0]),right=project([1,0]),front=project([1,1]),left=project([0,1]);
  const a=project([0,0],280),b=project([1,0],280),c=project([0,1],280);
  const planks=Array.from({length:12},(_,i)=>`<path d="M${project([i/12,0]).join(' ')}L${project([i/12,1]).join(' ')}"/>`).join('');
  const seams=Array.from({length:12},(_,i)=>{const v=((i%3)+1)/4;return `<path d="M${project([i/12,v]).join(' ')}L${project([(i+1)/12,v]).join(' ')}"/>`;}).join('');
  return `<defs><linearGradient id="home-left" x2="1" y2="1"><stop stop-color="#fcf7ef"/><stop offset="1" stop-color="#eee4d8"/></linearGradient><linearGradient id="home-right" x2="0" y2="1"><stop stop-color="#fffdf6"/><stop offset="1" stop-color="#f3e9db"/></linearGradient><linearGradient id="home-floor" x2=".6" y2="1"><stop stop-color="#f7d5a5"/><stop offset="1" stop-color="#eab67c"/></linearGradient><clipPath id="home-floor-clip"><polygon points="${pts([back,right,front,left])}"/></clipPath></defs>
    <ellipse cx="500" cy="711" rx="360" ry="31" fill="#54483c" opacity=".07"/>
    <g stroke="#71645a" stroke-width="2.8" stroke-linejoin="round"><polygon points="${pts([a,c,left,back])}" fill="url(#home-left)"/><polygon points="${pts([a,b,right,back])}" fill="url(#home-right)"/>
    <polygon points="${pts([back,right,front,left])}" fill="url(#home-floor)" stroke="#c59d73"/>
    <g stroke="#c99966" stroke-width="1.2" opacity=".48" clip-path="url(#home-floor-clip)">${planks}${seams}</g>
    <path d="M${left[0]} ${left[1]-9}L${back[0]} ${back[1]-9}L${right[0]} ${right[1]-9}" fill="none" stroke="#c79d70" stroke-width="10"/>
    <g transform="matrix(1 -.524 0 1 186 400)"><rect x="-8" y="-117" width="163" height="159" rx="4" fill="#e8bb7c"/><rect y="-108" width="140" height="132" fill="#a8d9ec"/><path d="M0-24Q26-63 50-29Q79-71 104-28L140-44V24H0Z" fill="#97b68a" stroke="none"/><path d="M0-74Q12-101 24-73Q46-84 49-69H0Z" fill="#fff" stroke="none"/><path d="M70-108V24M0-42H140" stroke="#bd8a50" stroke-width="8"/><path d="M-9-120V38H10V-120M133-120V38H152V-120" fill="#ffe1a0" stroke="#b99565" stroke-width="2"/><path d="M-16-120H161" stroke="#b4824e" stroke-width="9" stroke-linecap="round"/></g>
    <g transform="matrix(1 .402 0 1 774 450)"><path d="M0 0V-183H92V0" fill="#d9b17c"/><path d="M9-1V-173H84V-1" fill="#edc997"/><path d="M20-145H70V-32H20Z" fill="none" stroke="#c29a6d" stroke-width="2"/><circle cx="69" cy="-84" r="4" fill="#a57a3e"/></g></g>`;
}
export function deskArt(){
  const {u,v,w,d,height}=TABLE,corners=[[u,v],[u+w,v],[u+w,v+d],[u,v+d]],top=corners.map(p=>project(p,height));
  const legs=corners.map(([x,y])=>[x+(x===u?.025:-.025),y+(y===v?.025:-.025)]);
  return `<g stroke="#514438" stroke-width="3" stroke-linejoin="round"><polygon points="${pts(corners.map(p=>project(p)))}" fill="#6b5541" opacity=".12" stroke="none"/>
    ${legs.map(p=>{const [x,y]=project(p,height-7),floor=project(p);return `<path d="M${x-5} ${y}L${floor[0]-5} ${floor[1]}L${floor[0]+5} ${floor[1]+3}L${x+5} ${y+3}Z" fill="#c18b50"/>`;}).join('')}
    <polygon points="${pts(top)}" fill="#efc489"/><path d="M${top[3].join(' ')}L${top[2].join(' ')}L${top[1].join(' ')}v12L${top[2][0]} ${top[2][1]+12}L${top[3][0]} ${top[3][1]+12}Z" fill="#c68d4e"/>
    <path d="M${project([u+.06,v+.17],height+1).join(' ')}L${project([u+w-.04,v+.17],height+1).join(' ')}" stroke="#daa766" stroke-width="1.5"/></g>`;
}
export function itemArt(id,{open=false}={}){
  if(id==='book')return open?`<g stroke="#4b4741" stroke-width="2.3" stroke-linejoin="round"><path d="M0-5L-41-17L-35-47Q-17-50 0-37Q17-50 35-47L41-17Z" fill="#fff9e6"/><path d="M0-37V-5M-29-36L-9-29M-29-29L-9-22M9-29L29-36M9-22L29-29" fill="none" stroke="#b4b09f" stroke-width="1.4"/></g>`:
    `<g stroke="#484039" stroke-width="2.4" stroke-linejoin="round"><ellipse cy="2" rx="43" ry="10" fill="#443b32" opacity=".12" stroke="none"/><path d="M-43-12L16-34L42-19L-16 5Z" fill="#ef7761"/><path d="M-40-10L-16 1L39-19V-10L-16 12L-40 0Z" fill="#fff4d7"/><path d="M-43-12L-43 1L-16 15L43-8V-18M-16 5V15" fill="none" stroke="#aa4b42"/><path d="M-21-15L10-26M-25-10L3-20" stroke="#ffd2a8" stroke-width="2"/><path d="M3-21L18-26L26-22L10-17Z" fill="#fff5da" stroke="none"/></g>`;
  return `<g stroke="#3e5863" stroke-width="2.3" stroke-linejoin="round"><ellipse cy="2" rx="20" ry="7" fill="#443b32" opacity=".10" stroke="none"/><path d="M-10-55Q-16-48-16-41V-5Q-16 3 0 3Q16 3 16-5V-41Q16-48 10-55Z" fill="#e5f7fc"/><path d="M-11-35Q0-30 11-35V-7Q0-1-11-7Z" fill="#81c9e8" stroke="none"/><path d="M-8-42V-13" stroke="#fff" stroke-width="3" stroke-linecap="round"/><rect x="-11" y="-65" width="22" height="12" rx="4" fill="#639ecc"/><path d="M-7-61H7" stroke="#9dcbe8" stroke-width="1.5"/></g>`;
}
