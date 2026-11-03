// Fixed vocabulary for the second-level experiment. These are hints, never output replacements.
export const STT_KEYWORDS=['공책','옷','영화','펜'];
export const GROQ_EXPERIMENT_PROMPT='공책, 옷, 영화, 펜. 공책이 있어요. 옷을 사요. 영화를 봐요. 펜이 있어요.';
export const STT_VARIANTS=[{id:'A',provider:'groq',label:'Whisper без контекста',hints:false},{id:'B',provider:'groq',label:'Whisper с контекстом',hints:true},{id:'C',provider:'openai',label:'GPT-Transcribe без подсказок',hints:false},{id:'D',provider:'openai',label:'GPT-Transcribe с подсказками',hints:true}];
