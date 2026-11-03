// Experiment only. Models are pinned per variant; normal STT_MODEL is independent.
export const STT_KEYWORDS=['공책','옷','영화','펜'];
export const GROQ_EXPERIMENT_PROMPT='공책, 옷, 영화, 펜. 공책이 있어요. 옷을 사요. 영화를 봐요. 펜이 있어요.';
export const STT_MATRIX_ID='groq-whisper-v1';
export const STT_VARIANTS=[
 {id:'A',provider:'groq',model:'whisper-large-v3-turbo',label:'Turbo без prompt',hints:false},
 {id:'B',provider:'groq',model:'whisper-large-v3-turbo',label:'Turbo с prompt',hints:true},
 {id:'C',provider:'groq',model:'whisper-large-v3',label:'V3 без prompt',hints:false},
 {id:'D',provider:'groq',model:'whisper-large-v3',label:'V3 с prompt',hints:true}
];
