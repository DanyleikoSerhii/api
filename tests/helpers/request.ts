import { createApp } from '../../src/app.js';

const app = createApp();

type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
};

export async function request(
  path: string,
  options: RequestOptions = {},
): Promise<{ status: number; body: unknown; cookies: Record<string, string> }> {
  const { method = 'GET', headers = {}, body } = options;

  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const res = await app.request(path, init);
  let responseBody: unknown;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    responseBody = await res.json();
  } else {
    responseBody = await res.text();
  }

  const cookies: Record<string, string> = {};
  for (const sc of res.headers.getSetCookie()) {
    const pair = sc.split(';', 1)[0];
    const eq = pair.indexOf('=');
    if (eq > 0) {
      cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1);
    }
  }

  return { status: res.status, body: responseBody, cookies };
}

// Build a Cookie request header carrying the auth token, mirroring the cookie
// the API sets on register/login.
export function authCookie(token: string): { Cookie: string } {
  return { Cookie: `token=${token}` };
}
