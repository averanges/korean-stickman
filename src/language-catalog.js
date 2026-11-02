import {OBJECT_TYPES,KOREAN} from './room-catalog.js';
import {LESSONS} from './room-lessons.js';
import {catalogs} from './catalog.js';
export {catalogs};
export const LANGUAGE_VERSION=1;
export const TRAINING={mode:'free',dictionary:true,targetGrammar:null};
export const OBJECTS=Object.keys(KOREAN);
export const NOUNS=Object.fromEntries(OBJECTS.map(id=>[id,[KOREAN[id],...(id==='phone'?['핸드폰']:id==='television'?['티비','TV']:[])]]));
const objectWord=id=>{const word=KOREAN[id],code=word.charCodeAt(word.length-1)-0xac00;return word+(code>=0&&code<=11171&&code%28?'을':'를');};
const useTargets=use=>OBJECTS.filter(id=>OBJECT_TYPES[id].type==='portable'&&OBJECT_TYPES[id].use===use&&OBJECT_TYPES[id].actions.includes('use'));
// A registration catalogue, separate from parsing: aliases and capabilities live together.
export const ACTIONS={
 drink:{kind:'use',targets:useTargets('drink'),forms:['마셔요','마십니다','마시세요','마셔주세요','마시다'],roots:['마시','마셔'],particles:['을','를','은','는'],canonical:id=>objectWord(id)+' 마셔요'},
 read:{kind:'use',targets:useTargets('read'),forms:['읽어요','읽습니다','읽으세요','읽어주세요','읽다'],roots:['읽'],particles:['을','를','은','는'],canonical:id=>objectWord(id)+' 읽어요'},
 eat:{kind:'use',targets:useTargets('eat'),forms:['먹어요','먹습니다','먹으세요','먹어주세요','먹다'],roots:['먹'],particles:['을','를','은','는'],canonical:id=>objectWord(id)+' 먹어요'},
 screen:{kind:'use',targets:useTargets('screen'),forms:['봐요','봅니다','보세요','봐주세요','보다','사용해요','사용하세요','사용해주세요'],roots:['보','봐','사용'],particles:['을','를','은','는'],canonical:id=>objectWord(id)+' 봐요'},
 sit:{kind:'sit',targets:['chair'],forms:['앉아요','앉습니다','앉으세요','앉아주세요','앉다'],roots:['앉'],particles:['에'],canonical:()=> '의자에 앉아요'},
 sleep:{kind:'sleep',targets:['bed'],forms:['자요','잡니다','자세요','자주세요','자다','주무세요'],roots:['자','주무'],particles:['에서','에'],canonical:()=> '침대에서 자요'},
 lie_down:{kind:'lie_down',targets:['bed'],forms:['누워요','눕습니다','누우세요','누워주세요','눕다'],roots:['누워','누우','눕'],particles:['에'],canonical:()=> '침대에 누워요'},
 stand_up:{kind:'stand_up',targets:[],forms:['일어나요','일어납니다','일어나세요','일어나주세요','일어나다'],roots:['일어나'],particles:[],canonical:()=> '일어나요'},
 on:{kind:'toggle',targets:['lamp'],forms:['켜요','켭니다','켜세요','켜주세요','켜다'],roots:['켜','켭'],particles:['을','를'],value:true,canonical:()=> '전등을 켜요'},
 off:{kind:'toggle',targets:['lamp'],forms:['꺼요','끕니다','끄세요','꺼주세요','끄다'],roots:['꺼','끄'],particles:['을','를'],value:false,canonical:()=> '전등을 꺼요'},
 take:{kind:'take',targets:OBJECTS.filter(id=>OBJECT_TYPES[id].type==='portable'),forms:['집어요','집습니다','집으세요','집어주세요','집다'],roots:['집'],particles:['을','를'],canonical:id=>objectWord(id)+' 집어요'},
 put:{kind:'put',targets:OBJECTS.filter(id=>OBJECT_TYPES[id].type==='portable'),forms:['놓아요','놓습니다','놓으세요','놓아주세요','놓다'],roots:['놓'],particles:['을','를'],canonical:id=>objectWord(id)+' 놓아요'},
 move_to:{kind:'move_to',targets:OBJECTS,forms:['가요','가세요','가주세요','가다'],roots:['가요','가세요','가다'],particles:['에','으로','로'],canonical:id=>KOREAN[id]+'에 가요'}
};
const lessonForms={study:['공부해요','공부를해요','공부하세요','공부해주세요','공부하다'],learn:['배워요','한국어를배워요','배우세요','배워주세요','배우다'],homework:['숙제를해요','숙제해요','숙제하세요','숙제를하세요','숙제를해주세요','숙제하다'],work:['일해요','일하세요','일해주세요','일하다'],exercise:['운동해요','운동하세요','운동해주세요','운동하다'],meet:['친구를만나요','친구만나요','친구를만나세요','친구만나주세요','친구를만나다'],movie:['영화를봐요','영화봐요','영화를보세요','영화봐주세요','영화를보다'],shop:['옷을사요','옷사요','옷을사세요','옷사주세요','옷을사다']};
const lessonRoots={study:['공부'],learn:['배워','배우'],homework:['숙제'],work:['일해','일하'],exercise:['운동'],meet:['만나'],movie:['영화'],shop:['옷']};
for(const [id,lesson] of Object.entries(LESSONS))ACTIONS[id]={kind:'lesson',targets:[],forms:lessonForms[id]||lesson.commands,roots:lessonRoots[id]||lesson.commands,particles:[],requires:lesson.requires,canonical:()=>lesson.commands[0],lesson:id};
export const CAPABILITIES={version:1,objects:OBJECTS.map(id=>({id,nouns:NOUNS[id],actions:OBJECT_TYPES[id].actions})),actions:Object.entries(ACTIONS).map(([id,a])=>({id,kind:a.kind,targets:a.targets,forms:a.forms,requires:a.requires||[]})),attributes:Object.fromEntries(Object.entries(catalogs).map(([field,c])=>[field,Object.keys(c)]))};
