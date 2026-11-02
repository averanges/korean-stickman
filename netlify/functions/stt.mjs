import {createFunction} from '../../server/functions.mjs';
const handler=createFunction('netlify');
// Netlify passes (request, context). The shared handler's optional second
// argument is an API pathname, so never forward the platform Context to it.
export default request=>handler(request);
export const config={path:['/health','/transcribe','/api/stt/status','/api/stt']};
