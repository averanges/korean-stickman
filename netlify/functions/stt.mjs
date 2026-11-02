import {createFunction} from '../../server/functions.mjs';
const handler=createFunction('netlify');
export default handler;
export const config={path:['/health','/transcribe','/api/stt/status','/api/stt']};
