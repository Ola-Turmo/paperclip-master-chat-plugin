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
