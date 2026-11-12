import {OBJECT_TYPES,KOREAN} from './room-catalog.js';
import {ACTIONS} from './language-catalog.js';
import {LESSONS} from './room-lessons.js';
export const ROOM_OBJECT_IDS=Object.keys(OBJECT_TYPES);
const own=(o,k)=>Object.hasOwn(o,k),plain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Object.getPrototypeOf(o)===Object.prototype;
export const REACTIONS=['thinking','understood','wrong','reject','reset','did_not_understand','try_again'];
export const TEACHER_ACTIONS=['sleep','eat','read','drink','study','learn','work','exercise','meet','shop','movie','homework'].filter(id=>own(ACTIONS,id));
export const ACTION_LABELS={sleep:'자다',eat:'먹다',read:'읽다',drink:'마시다',study:'공부하다',learn:'배우다',work:'일하다',exercise:'운동하다',meet:'친구를 만나다',shop:'옷을 사다',movie:'영화를 보다',homework:'숙제를 하다'};
export function validRoomOperation(op){
 if(!plain(op)||Object.keys(op).some(k=>!['action','item','value'].includes(k)))return false;
 if(['create','remove'].includes(op.action))return own(OBJECT_TYPES,op.item)&&op.value===undefined;
 if(op.action==='lesson')return own(LESSONS,op.item)&&op.value===undefined;
 if(!own(OBJECT_TYPES,op.item))return false;
 if(op.action==='use')return OBJECT_TYPES[op.item].actions.includes('use')&&op.value===undefined;
 if(op.action==='toggle')return OBJECT_TYPES[op.item].actions.includes('toggle')&&typeof op.value==='boolean';
 return ['move_to','take','put','sit','sleep','lie_down'].includes(op.action)&&OBJECT_TYPES[op.item].actions.includes(op.action)&&op.value===undefined;
}
export function actionOperation(id,target){const a=ACTIONS[id];if(!TEACHER_ACTIONS.includes(id))return null;if(a.kind==='lesson')return {action:'lesson',item:id};const item=target||a.targets[0];return a.targets.includes(item)?{action:a.kind,item}:null;}
export function requiredItems(op){if(op.action==='lesson')return LESSONS[op.item]?.requires||[];return ['create','remove'].includes(op.action)?[]:[op.item];}
export function teacherCommandLevel(command){return command.action==='room'?'home':command.action==='feedback'?command.level||'creator':'creator';}
export function roomMissing(op,state){return requiredItems(op).filter(id=>!state.items[id]);}
export function roomSummary(state,controller,lastResult=null){return {counts:Object.fromEntries(ROOM_OBJECT_IDS.map(id=>[id,Object.values(state.objects).filter(o=>o.id===id&&o.location.kind!=='absent').length])),hero:{position:[...state.hero.position],posture:state.hero.posture,facing:state.hero.facing,held:state.held||null},busy:Boolean(controller.busy),operation:controller.operation?{action:String(controller.operation.action).slice(0,40),item:controller.operation.item||null,status:controller.operation.status}:null,lastResult};}
export function safeRoomSnapshot(input){
 if(!plain(input)||Object.keys(input).some(k=>!['counts','hero','busy','operation','lastResult'].includes(k))||!plain(input.counts)||Object.keys(input.counts).length!==ROOM_OBJECT_IDS.length||Object.entries(input.counts).some(([id,n])=>!own(OBJECT_TYPES,id)||!Number.isInteger(n)||n<0||n>1)||!plain(input.hero)||Object.keys(input.hero).some(k=>!['position','posture','facing','held'].includes(k)))return null;
 const h=input.hero;if(!Array.isArray(h.position)||h.position.length!==2||h.position.some(v=>!Number.isFinite(v)||v<0||v>1)||!['standing','sitting','lying','sleeping'].includes(h.posture)||!['front','back','left','right'].includes(h.facing)||!(h.held===null||own(OBJECT_TYPES,h.held))||typeof input.busy!=='boolean')return null;
 const operation=input.operation;if(operation!==null&&(!plain(operation)||Object.keys(operation).some(k=>!['action','item','status'].includes(k))||typeof operation.action!=='string'||operation.action.length>40||!(operation.item===null||own(OBJECT_TYPES,operation.item)||own(LESSONS,operation.item))||!['waiting','running','completed','error'].includes(operation.status)))return null;
 const last=input.lastResult;if(last!==null&&(!plain(last)||Object.keys(last).some(k=>!['status','message','reason','missing'].includes(k))||!['success','blocked','error','cancelled'].includes(last.status)||typeof last.message!=='string'||last.message.length>500||typeof last.reason!=='string'||last.reason.length>80||!Array.isArray(last.missing)||last.missing.length>ROOM_OBJECT_IDS.length||last.missing.some(id=>!own(OBJECT_TYPES,id))))return null;
 return structuredClone(input);
}
export function compactResult(result){return {status:result?.cancelled?'cancelled':['success',''].includes(result?.type)?'success':result?.type==='blocked'?'blocked':'error',message:String(result?.message||'').slice(0,500),reason:String(result?.reason||'').slice(0,80),missing:Array.isArray(result?.missing)?result.missing.filter(id=>own(OBJECT_TYPES,id)):[]};}
export function describeRoom(op){return op.action==='lesson'?ACTION_LABELS[op.item]||op.item:(op.action==='create'?'+ ':op.action==='remove'?'− ':'')+KOREAN[op.item];}

export function roomOperations(command){if(command.operation!==undefined&&command.operations!==undefined)return null;if(command.operation!==undefined)return validRoomOperation(command.operation)?[command.operation]:null;const list=command.operations;if(!Array.isArray(list)||!list.length||list.length>3||list.some(op=>!validRoomOperation(op)))return null;if(list.length>1&&(!['create','remove'].includes(list[0].action)||list.some(op=>op.action!==list[0].action)||new Set(list.map(op=>op.item)).size!==list.length))return null;return list;}
export function teacherProposals(result){const intents=result?.interpretation?.intents||[],candidates=result?.candidates||[],ops=[];for(const i of [...intents,...candidates]){if(i.polarity!=='positive'||!['statement','instruction'].includes(i.speechAct)||!['present','dictionary'].includes(i.tense))continue;const operation=i.kind==='lesson'?{action:'lesson',item:i.action}:{action:i.kind,item:i.target,...(i.kind==='toggle'?{value:i.params.on}:{})};if(validRoomOperation(operation)&&!ops.some(v=>JSON.stringify(v)===JSON.stringify(operation)))ops.push(operation);}const proposals=ops.slice(0,3).map(operation=>({action:'room',operation}));if(result?.interpretation?.status==='resolved'&&ops.length>1&&ops.length<=3&&roomOperations({operations:ops}))return [...proposals.slice(0,2),{action:'room',operations:ops}];return proposals;}
