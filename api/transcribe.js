import {createFunction} from '../server/functions.mjs';
const handler=createFunction('vercel');
export default {fetch:request=>handler(request,'/transcribe')};
