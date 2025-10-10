import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const DEFAULT_BASE_URL = 'http://localhost:3010/api';
const BASE_URL = (__ENV.BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
const TEST_EMAIL = __ENV.TEST_EMAIL || 'test@example.com';
const TEST_PASSWORD = __ENV.TEST_PASSWORD || 'password123';
const TEST_MODEL_ID = __ENV.TEST_MODEL_ID || 'mock-claude-local';
const USE_WEBSOCKET = (__ENV.USE_WEBSOCKET || 'true').toLowerCase() === 'true';

const DEFAULT_STAGES = [
  { target: 100, duration: '5m' },
  { target: 200, duration: '5m' },
  { target: 400, duration: '5m' },
  { target: 600, duration: '5m' },
  { target: 800, duration: '5m' },
  { target: 1000, duration: '5m' },
  { target: 0, duration: '1m' }
];

export const options = {
  scenarios: {
    load: {
      executor: 'ramping-arrival-rate',
      startRate: Number(__ENV.START_RATE || 20),
      timeUnit: __ENV.TIME_UNIT || '1s',
      preAllocatedVUs: Number(__ENV.PRE_VUS || 120),
      maxVUs: Number(__ENV.MAX_VUS || 400),
      stages: parseStages()
    }
  },
  thresholds: {
    http_req_failed: [
      { threshold: 'rate==0', abortOnFail: true }
    ],
    http_req_duration: [
      { threshold: 'p(95)<1500', abortOnFail: true, delayAbortEval: '30s' }
    ],
    checks: [
      { threshold: 'rate>0.95', abortOnFail: true }
    ]
  }
};
function parseStages() {
  if (!__ENV.STAGES) {
    return DEFAULT_STAGES;
  }

  try {
    const parsed = JSON.parse(__ENV.STAGES);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (error) {
    console.error('Failed to parse STAGES env variable, using defaults:', error);
  }
  return DEFAULT_STAGES;
}


function jsonHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };
}

export function setup() {
  const healthRes = http.get(`${BASE_URL}/health`, {
    tags: { name: 'health_check', url: '/health' }
  });
  check(healthRes, { 'healthcheck ok': (res) => res.status === 200 });

  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'auth_login', url: '/auth/login' }
    }
  );

  const loginOk = check(loginRes, {
    'login succeeded': (res) => res.status === 200 && !!res.json('token')
  });

  if (!loginOk) {
    throw new Error(`Login failed: status=${loginRes.status} body=${loginRes.body}`);
  }

  return {
    token: loginRes.json('token')
  };
}

export default function runLoadTest(data) {
  const headers = jsonHeaders(data.token);
  const suffix = randomString(8);

  const createRes = http.post(
    `${BASE_URL}/conversations`,
    JSON.stringify({
      title: `Load Test ${suffix}`,
      model: TEST_MODEL_ID,
      systemPrompt: 'Load test conversation'
    }),
    {
      headers,
      tags: { name: 'conversations_create', url: '/conversations' }
    }
  );

  if (
    !check(createRes, {
      'create conversation ok': (res) => res.status === 200 && !!res.json('id')
    })
  ) {
    return;
  }

  const conversationId = createRes.json('id');
  if (USE_WEBSOCKET) {
    runWebSocketFlow(conversationId, headers, suffix, data.token);
  } else {
    runHttpOnlyFlow(conversationId, headers, suffix);
  }

  http.post(
    `${BASE_URL}/conversations/${conversationId}/archive`,
    JSON.stringify({ reason: 'k6 load test cleanup' }),
    {
      headers,
      tags: { name: 'conversations_archive', url: '/conversations/:id/archive' }
    }
  );

  sleep(0.05);
}

function runWebSocketFlow(conversationId, headers, suffix, token) {
  const participantsRes = http.get(
    `${BASE_URL}/participants/conversation/${conversationId}`,
    {
      headers,
      tags: { name: 'participants_list', url: '/participants/conversation/:id' }
    }
  );

  let responderId;
  if (participantsRes.status === 200) {
    const participants = participantsRes.json();
    const assistant = Array.isArray(participants) ? participants.find((p) => p.type === 'assistant') : undefined;
    responderId = assistant?.id;
  }

  const wsUrl = buildWebSocketUrl(BASE_URL, token);
  let assistantMessageId;
  let assistantPrimaryBranchId;
  let alternateBranchId;
  let regenerateSent = false;
  let regenerateComplete = false;

  const wsRes = ws.connect(wsUrl, {}, (socket) => {
    socket.setTimeout(() => {
      if (!regenerateComplete) {
        socket.close();
      }
    }, Number(__ENV.WS_TIMEOUT || 15000));

    socket.on('open', () => {
      const userMessageId = uuid();
      socket.send(JSON.stringify({
        type: 'chat',
        conversationId,
        messageId: userMessageId,
        content: `Load test message ${suffix}`,
        responderId
      }));
    });

    socket.on('message', (raw) => {
      try {
        const payload = JSON.parse(raw);

        if (payload.type === 'message_created' && payload.message) {
          if (payload.message.role === 'assistant') {
            assistantMessageId = payload.message.id;
            assistantPrimaryBranchId = payload.message.activeBranchId;
          }
        } else if (payload.type === 'message_edited' && payload.message) {
          if (payload.message.id === assistantMessageId) {
            alternateBranchId = payload.message.activeBranchId;
          }
        } else if (payload.type === 'stream') {
          if (!regenerateSent) {
            if (payload.isComplete) {
              if (assistantMessageId && assistantPrimaryBranchId) {
                socket.send(JSON.stringify({
                  type: 'regenerate',
                  conversationId,
                  messageId: assistantMessageId,
                  branchId: assistantPrimaryBranchId
                }));
                regenerateSent = true;
              } else {
                regenerateComplete = true;
                socket.close();
              }
            }
          } else if (payload.isComplete) {
            alternateBranchId = payload.branchId || alternateBranchId;
            regenerateComplete = true;
            socket.close();
          }
        } else if (payload.type === 'error') {
          regenerateComplete = true;
          socket.close();
        }
      } catch (err) {
        console.error('Failed to parse websocket message', err);
      }
    });

    socket.on('close', () => {
      if (!regenerateComplete) {
        regenerateComplete = true;
      }
    });
  });

  const connected = check(wsRes, {
    'websocket connected': (res) => res && res.status === 101
  });

  if (!connected || !assistantMessageId) {
    return;
  }

  if (!alternateBranchId) {
    alternateBranchId = assistantPrimaryBranchId;
  }

  loadConversationAndSwitchBranch(
    conversationId,
    headers,
    assistantMessageId,
    assistantPrimaryBranchId,
    alternateBranchId
  );
}

function runHttpOnlyFlow(conversationId, headers, suffix) {
  const nowIso = new Date().toISOString();
  const userMessageId = uuid();
  const userBranchId = uuid();
  const assistantMessageId = uuid();
  const assistantPrimaryBranchId = uuid();
  const alternateBranchId = uuid();

  const importRes = http.post(
    `${BASE_URL}/import/messages-raw`,
    JSON.stringify({
      conversationId,
      messages: [
        {
          id: userMessageId,
          order: 0,
          activeBranchId: userBranchId,
          branches: [
            {
              id: userBranchId,
              content: `Load user message ${suffix}`,
              role: 'user',
              createdAt: nowIso,
              parentBranchId: 'root'
            }
          ]
        },
        {
          id: assistantMessageId,
          order: 1,
          activeBranchId: assistantPrimaryBranchId,
          branches: [
            {
              id: assistantPrimaryBranchId,
              content: `Primary response ${suffix}`,
              role: 'assistant',
              createdAt: nowIso,
              parentBranchId: userBranchId,
              model: TEST_MODEL_ID
            },
            {
              id: alternateBranchId,
              content: `Alternate response ${suffix}`,
              role: 'assistant',
              createdAt: nowIso,
              parentBranchId: userBranchId,
              model: TEST_MODEL_ID
            }
          ]
        }
      ]
    }),
    {
      headers,
      tags: { name: 'import_raw', url: '/import/messages-raw' }
    }
  );

  const imported = check(importRes, {
    'messages imported': (res) => res.status === 200 && res.json('success') !== false
  });

  if (!imported) {
    return;
  }

  loadConversationAndSwitchBranch(
    conversationId,
    headers,
    assistantMessageId,
    assistantPrimaryBranchId,
    alternateBranchId
  );
}

function loadConversationAndSwitchBranch(
  conversationId,
  headers,
  assistantMessageId,
  primaryBranchId,
  alternateBranchId
) {
  const getRes = http.get(`${BASE_URL}/conversations/${conversationId}`, {
    headers,
    tags: { name: 'conversations_get', url: '/conversations/:id' }
  });
  check(getRes, {
    'get conversation ok': (res) => res.status === 200 && res.json('id') === conversationId
  });

  const messagesRes = http.get(`${BASE_URL}/conversations/${conversationId}/messages`, {
    headers,
    tags: { name: 'messages_list', url: '/conversations/:id/messages' }
  });
  check(messagesRes, {
    'messages fetched': (res) => res.status === 200 && Array.isArray(res.json())
  });

  if (
    assistantMessageId &&
    primaryBranchId &&
    alternateBranchId &&
    alternateBranchId !== primaryBranchId
  ) {
    http.post(
      `${BASE_URL}/conversations/${conversationId}/set-active-branch`,
      JSON.stringify({
        messageId: assistantMessageId,
        branchId: alternateBranchId
      }),
      {
        headers,
        tags: { name: 'conversations_set_branch', url: '/conversations/:id/set-active-branch' }
      }
    );
  }
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function buildWebSocketUrl(baseApiUrl, token) {
  const match = baseApiUrl.match(/^(https?):\/\/([^/]+)/);
  if (!match) {
    throw new Error(`Unable to parse BASE_URL: ${baseApiUrl}`);
  }

  const protocol = match[1] === 'https' ? 'wss' : 'ws';
  const host = match[2];
  return `${protocol}://${host}/?token=${token}`;
}
