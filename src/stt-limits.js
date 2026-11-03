// Public application limits; serverless headroom is below the platforms' ingress limits.
export const STT_POLICIES={amvera:{maxAudioBytes:4000000,maxDurationMs:300000,timeoutMs:45000},render:{maxAudioBytes:20*1024*1024,maxDurationMs:null,timeoutMs:60000},netlify:{maxAudioBytes:4000000,maxDurationMs:300000,timeoutMs:50000},vercel:{maxAudioBytes:4000000,maxDurationMs:300000,timeoutMs:50000}};
