import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { env } from '../env.js';
import { errorResponse, ErrorCode, defaultHook } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { Tags, telegramTestResponseSchema, errorResponseSchema } from '../openapi/schemas.js';

type AuthVariables = {
  user: { sub: number; email: string };
};

const jsonError = { content: { 'application/json': { schema: errorResponseSchema } } };

const telegramTestRoute = createRoute({
  operationId: 'telegramTest',
  method: 'post',
  path: '/api/notifications/telegram/test',
  tags: [Tags.NOTIFICATIONS],
  summary: 'Send a test Telegram notification',
  description:
    'Sends a test message to the configured Telegram chat. ' +
    'Requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to be set as Vercel environment variables. ' +
    'Returns 500 with an error envelope when either variable is missing.',
  security: [{ cookieAuth: [] }],
  responses: {
    200: {
      content: { 'application/json': { schema: telegramTestResponseSchema } },
      description: 'Test message sent',
    },
    401: { ...jsonError, description: 'Missing or invalid token' },
    500: { ...jsonError, description: 'Telegram not configured or API error' },
  },
});

export const notificationsRouter = new OpenAPIHono<{ Variables: AuthVariables }>({ defaultHook });
notificationsRouter.use('/api/notifications/*', requireAuth);

notificationsRouter.openapi(telegramTestRoute, async (c) => {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId } = env;

  if (!token || !chatId) {
    return errorResponse(
      c,
      ErrorCode.INTERNAL_ERROR,
      'Telegram not configured — add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to Vercel environment variables.',
    ) as never;
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: '🧪 Test notification from Movie Explorer API',
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return errorResponse(c, ErrorCode.INTERNAL_ERROR, `Telegram API error: ${text}`) as never;
  }

  return c.json({ ok: true, message: 'Test message sent to Telegram.' }, 200);
});
