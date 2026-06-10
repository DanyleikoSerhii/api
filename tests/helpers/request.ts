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
): Promise<{ status: number; body: unknown }> {
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

  return { status: res.status, body: responseBody };
}
