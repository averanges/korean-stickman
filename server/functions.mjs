import {createSttApi} from './api.mjs';
import {webApi} from './http-adapters.mjs';
import {frontendOrigins,publicOrigins} from './security.mjs';
export function createFunction(platform,{env=process.env,...overrides}={}){
 const origin=env.API_PUBLIC_ORIGIN||(platform==='netlify'?env.URL||env.DEPLOY_PRIME_URL:env.VERCEL_PROJECT_PRODUCTION_URL?`https://${env.VERCEL_PROJECT_PRODUCTION_URL}`:env.VERCEL_URL?`https://${env.VERCEL_URL}`:'');
 const config=async()=>({openaiKey:env.OPENAI_API_KEY||'',groqSttPrompt:env.GROQ_STT_PROMPT,llmKey:env.LLM_API_KEY||env.GROQ_API_KEY||'',llmModel:env.LLM_MODEL||'openai/gpt-oss-20b',llmEnabled:env.LLM_ENABLED!=='false',key:env.GROQ_API_KEY||'',model:env.STT_MODEL||'whisper-large-v3'});
 return webApi(createSttApi({platform,config,origins:publicOrigins({PUBLIC_ORIGIN:origin}),frontends:frontendOrigins(env),...overrides}));
}
