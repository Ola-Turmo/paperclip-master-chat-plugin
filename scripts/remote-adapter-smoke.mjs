import { createHmac, randomUUID } from 'node:crypto';

const adapterUrl = process.env.MASTER_CHAT_REMOTE_ADAPTER_URL || '';
const authToken = process.env.MASTER_CHAT_REMOTE_ADAPTER_TOKEN || '';
const authHeaderName = (process.env.MASTER_CHAT_REMOTE_ADAPTER_HEADER || 'authorization').toLowerCase();
const expectedText = process.env.MASTER_CHAT_REMOTE_EXPECT_TEXT || 'READY';
const allowHttp = /^(1|true|yes)$/i.test(process.env.MASTER_CHAT_REMOTE_ALLOW_HTTP || '');
const allowInsecureTls = /^(1|true|yes)$/i.test(process.env.MASTER_CHAT_REMOTE_ALLOW_INSECURE_TLS || '');
const attemptImageAnalysis = /^(1|true|yes)$/i.test(process.env.MASTER_CHAT_REMOTE_ATTEMPT_IMAGE_ANALYSIS || '');
const requireImageAnalysis = /^(1|true|yes)$/i.test(process.env.MASTER_CHAT_REMOTE_REQUIRE_IMAGE_ANALYSIS || '');
const profileId = process.env.MASTER_CHAT_REMOTE_PROFILE || 'default';
const provider = process.env.MASTER_CHAT_REMOTE_PROVIDER || 'auto';
const model = process.env.MASTER_CHAT_REMOTE_MODEL || 'MiniMax-M2.7';

const readyCardPng = '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';

if (allowInsecureTls) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

function fail(message) {
  throw new Error(message);
}

function assertConfig() {
  if (!adapterUrl) fail('MASTER_CHAT_REMOTE_ADAPTER_URL is required');
  if (!authToken) fail('MASTER_CHAT_REMOTE_ADAPTER_TOKEN is required');
  let url;
  try {
    url = new URL(adapterUrl);
  } catch {
    fail(`Invalid MASTER_CHAT_REMOTE_ADAPTER_URL: ${adapterUrl}`);
  }
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    fail('Remote adapter smoke requires an https URL unless MASTER_CHAT_REMOTE_ALLOW_HTTP=true');
  }
  return url.toString().replace(/\/$/, '');
}

function authHeaderValue() {
  if (authHeaderName === 'authorization' && !/^bearer\s+/i.test(authToken)) {
    return `Bearer ${authToken}`;
  }
  return authToken;
}

function buildSignedHeaders(method, path, body) {
  const date = new Date().toISOString();
  const nonce = randomUUID();
  const signature = createHmac('sha256', authToken)
    .update([method.toUpperCase(), path, date, nonce, body].join('\n'))
    .digest('hex');
  return {
    [authHeaderName]: authHeaderValue(),
    'x-master-chat-date': date,
    'x-master-chat-nonce': nonce,
    'x-master-chat-signature': signature,
  };
}

async function fetchJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    const cause = error instanceof Error && 'cause' in error ? error.cause : undefined;
    const causeText = cause instanceof Error ? ` cause=${cause.message}` : cause ? ` cause=${String(cause)}` : '';
    throw new Error(`fetch failed for ${url}${causeText}`);
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return data;
}

async function main() {
  const baseUrl = assertConfig();
  const threadId = `remote-smoke-${Date.now()}`;
  const path = '/sessions/continue';
  const imagePath = '/images/analyze';
  const imageDataUrl = `data:image/png;base64,${readyCardPng}`;

  const imageBody = JSON.stringify({
    session: {
      profileId,
      provider,
      model,
    },
    metadata: {
      threadId,
      title: 'Remote HTTPS smoke',
    },
    image: {
      name: 'ready-card.png',
      mimeType: 'image/png',
      dataUrl: imageDataUrl,
    },
  });
  const body = JSON.stringify({
    session: {
      profileId,
      provider,
      model,
    },
    metadata: {
      threadId,
      title: 'Remote HTTPS smoke',
    },
    scope: {
      companyId: 'remote-smoke-company',
      selectedAgentIds: [],
      mode: 'company_wide',
    },
    skillPolicy: {
      enabled: [],
      disabled: [],
      toolsets: ['web', 'vision'],
    },
    toolPolicy: {
      allowedPluginTools: ['paperclip.dashboard'],
      allowedHermesToolsets: ['web', 'vision'],
    },
    context: {
      company: { id: 'remote-smoke-company', name: 'Remote Smoke Co' },
      selectedAgents: [],
      issueCount: 0,
      agentCount: 0,
      projectCount: 0,
      catalog: {
        companies: { loaded: 1, pageSize: 1, truncated: false },
        projects: { loaded: 0, pageSize: 0, truncated: false },
        issues: { loaded: 0, pageSize: 0, truncated: false },
        agents: { loaded: 0, pageSize: 0, truncated: false },
      },
      warnings: [],
    },
    tools: [
      {
        name: 'paperclip.dashboard',
        description: 'Allowed Paperclip/plugin tool: paperclip.dashboard',
        kind: 'paperclip',
      },
    ],
    continuity: {
      strategy: 'synthetic-summary',
      olderMessageCount: 2,
      totalMessageCount: 3,
      summary: '- User: Earlier discussion established the risk framing.\n- Assistant: Earlier discussion requested a concise answer only.',
    },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Reply with the single word READY.' },
          { type: 'image', name: 'ready-card.png', mimeType: 'image/png', data: readyCardPng },
        ],
      },
    ],
  });

  const health = await fetchJson(`${baseUrl}/health`, { method: 'GET' });
  const imageHeaders = buildSignedHeaders('POST', imagePath, imageBody);
  let imageAnalysis = null;
  let imageAnalysisError = null;
  if (attemptImageAnalysis || requireImageAnalysis) {
    try {
      imageAnalysis = await fetchJson(`${baseUrl}${imagePath}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...imageHeaders,
        },
        body: imageBody,
      });
      if (imageAnalysis?.status !== 'complete') {
        fail(`Image analysis did not complete successfully: ${JSON.stringify(imageAnalysis)}`);
      }
      if (!String(imageAnalysis?.summary || imageAnalysis?.extractedText || '').trim()) {
        fail(`Image analysis returned no summary or extracted text: ${JSON.stringify(imageAnalysis)}`);
      }
    } catch (error) {
      imageAnalysisError = error instanceof Error ? error.message : String(error);
      if (requireImageAnalysis) {
        throw error;
      }
      console.warn(`[remote-adapter-smoke] continuing without required image-analysis success: ${imageAnalysisError}`);
    }
  }
  const signedHeaders = buildSignedHeaders('POST', path, body);
  const response = await fetchJson(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...signedHeaders,
    },
    body,
  });

  const assistantText = String(response?.assistantText || '').trim();
  if (!assistantText) {
    fail('Adapter returned no assistantText');
  }
  if (!assistantText.includes(expectedText)) {
    fail(`Adapter response did not include ${JSON.stringify(expectedText)}: ${JSON.stringify(assistantText)}`);
  }

  const summary = {
    baseUrl,
    health,
    request: {
      profileId,
      provider,
      model,
    },
    imageAnalysis: imageAnalysis
      ? {
        status: imageAnalysis?.status,
        summary: imageAnalysis?.summary || null,
        extractedText: imageAnalysis?.extractedText || null,
      }
      : null,
    imageAnalysisError,
    response: {
      assistantText,
      gatewayMode: response?.gatewayMode,
      continuationMode: response?.continuationMode,
      sessionId: response?.sessionId || null,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(`[remote-adapter-smoke] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
