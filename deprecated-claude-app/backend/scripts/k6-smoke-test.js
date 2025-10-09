import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const DEFAULT_BASE_URL = 'http://localhost:3010/api';
const BASE_URL = (__ENV.BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
const TEST_EMAIL = __ENV.TEST_EMAIL || 'test@example.com';
const TEST_PASSWORD = __ENV.TEST_PASSWORD || 'password123';
const TEST_MODEL_ID = __ENV.TEST_MODEL_ID || 'mock-claude-local';

export const options = {
  scenarios: {
    smoke: {
      executor: 'shared-iterations',
      vus: Number(__ENV.VUS || 1),
      iterations: Number(__ENV.ITERATIONS || 1),
      maxDuration: __ENV.MAX_DURATION || '1m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
  },
};

function jsonHeaders(token) {
  return {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };
}

export function setup() {
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, {
    'healthcheck ok': (res) => res.status === 200,
  });

  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  const loginOk = check(loginRes, {
    'login succeeded': (res) => res.status === 200 && !!res.json('token'),
  });

  if (!loginOk) {
    throw new Error(`Login failed: status=${loginRes.status} body=${loginRes.body}`);
  }

  return {
    token: loginRes.json('token'),
    user: loginRes.json('user'),
  };
}

export default function runSmokeTest(data) {
  const { token } = data;
  const headers = jsonHeaders(token);
  const suffix = randomString(6);

  group('Models', () => {
    const modelsRes = http.get(`${BASE_URL}/models`, headers);
    check(modelsRes, {
      'list models 200': (res) => res.status === 200 && Array.isArray(res.json()),
    });
  });

  group('System config', () => {
    const systemRes = http.get(`${BASE_URL}/system/config`);
    check(systemRes, {
      'system config 200': (res) => res.status === 200 && typeof res.json('features') === 'object',
    });
  });

  group('Conversations', () => {
    const listRes = http.get(`${BASE_URL}/conversations`, headers);
    check(listRes, {
      'list conversations 200': (res) => res.status === 200 && Array.isArray(res.json()),
    });

    const createPayload = {
      title: `Smoke Test ${suffix}`,
      model: TEST_MODEL_ID,
      systemPrompt: 'Smoke test conversation',
    };

    const createRes = http.post(
      `${BASE_URL}/conversations`,
      JSON.stringify(createPayload),
      headers,
    );

    const createdOk = check(createRes, {
      'create conversation 200': (res) => res.status === 200 && !!res.json('id'),
    });

    if (!createdOk) {
      throw new Error(`Failed to create conversation: status=${createRes.status} body=${createRes.body}`);
    }

    const conversation = createRes.json();
    const conversationId = conversation.id;

    const getRes = http.get(`${BASE_URL}/conversations/${conversationId}`, headers);
    check(getRes, {
      'get conversation 200': (res) => res.status === 200 && res.json('id') === conversationId,
    });

    const updatePayload = {
      title: `Smoke Test Updated ${suffix}`,
    };
    const updateRes = http.patch(
      `${BASE_URL}/conversations/${conversationId}`,
      JSON.stringify(updatePayload),
      headers,
    );
    check(updateRes, {
      'update conversation 200': (res) => res.status === 200 && res.json('title') === updatePayload.title,
    });

    const messagesRes = http.get(`${BASE_URL}/conversations/${conversationId}/messages`, headers);
    check(messagesRes, {
      'get messages 200': (res) => res.status === 200 && Array.isArray(res.json()),
    });

    const metricsRes = http.get(`${BASE_URL}/conversations/${conversationId}/metrics`, headers);
    check(metricsRes, {
      'metrics accessible': (res) => res.status === 200 || res.status === 403,
    });

    const exportRes = http.get(`${BASE_URL}/conversations/${conversationId}/export`, headers);
    check(exportRes, {
      'export conversation 200': (res) => res.status === 200 && res.json('conversation')?.id === conversationId,
    });

    group('Participants', () => {
      const createParticipantRes = http.post(
        `${BASE_URL}/participants`,
        JSON.stringify({
          conversationId,
          name: `Assistant ${suffix}`,
          type: 'assistant',
          model: TEST_MODEL_ID,
        }),
        headers,
      );

      const participantCreated = check(createParticipantRes, {
        'create participant 200': (res) => res.status === 200 && !!res.json('id'),
      });

      const participantId = participantCreated ? createParticipantRes.json('id') : null;

      const listParticipantsRes = http.get(
        `${BASE_URL}/participants/conversation/${conversationId}`,
        headers,
      );
      check(listParticipantsRes, {
        'list participants 200': (res) => res.status === 200 && Array.isArray(res.json()),
      });

      if (participantId) {
        const deleteRes = http.del(`${BASE_URL}/participants/${participantId}`, null, headers);
        check(deleteRes, {
          'delete participant 200': (res) => res.status === 200 && res.json('success') === true,
        });
      }
    });

    const archiveRes = http.post(
      `${BASE_URL}/conversations/${conversationId}/archive`,
      JSON.stringify({ reason: 'k6 smoke test cleanup' }),
      headers,
    );
    check(archiveRes, {
      'archive conversation 200': (res) => res.status === 200 && res.json('success') === true,
    });
  });

  sleep(1);
}
