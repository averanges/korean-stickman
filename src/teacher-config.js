// Public URL of the separate lesson service. No STT address or credentials here.
export const TEACHER_API_BASE_URL='';
export function teacherApiBase(location=globalThis.location){
 if(TEACHER_API_BASE_URL)return TEACHER_API_BASE_URL;
 return ['localhost','127.0.0.1'].includes(location?.hostname)?location.origin:'';
}
