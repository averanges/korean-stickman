import { readFile } from 'node:fs/promises';
export async function readConfig(root, env = process.env) {
  const values = {};
  try {
    const text = env.RENDER==='true'?'':await readFile(new URL('.env', root), 'utf8');
    for (const line of text.split(/\r?\n/u)) {
      const match = line.match(/^\s*(GROQ_API_KEY|STT_MODEL|LLM_API_KEY|LLM_MODEL|LLM_ENABLED|PORT)\s*=\s*(.*?)\s*$/u);
      if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/u, '$2');
    }
  } catch (error) { if (error.code !== 'ENOENT') throw new Error('config-unavailable'); }
  return { llmModel:env.LLM_MODEL||values.LLM_MODEL||'openai/gpt-oss-20b',llmKey:env.LLM_API_KEY||values.LLM_API_KEY||env.GROQ_API_KEY||values.GROQ_API_KEY||'',llmEnabled:(env.LLM_ENABLED||values.LLM_ENABLED)!=='false',key: env.GROQ_API_KEY || values.GROQ_API_KEY || '', model: env.STT_MODEL || values.STT_MODEL || 'whisper-large-v3', port: Number(env.PORT || values.PORT || 5173) };
}
