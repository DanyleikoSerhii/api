import { handle } from 'hono/vercel';
import { createApp } from '../src/app.js';

// Use Hono's native Vercel adapter (a Web fetch handler) so Vercel's runtime
// serializes the Response itself. The previous @hono/node-server
// getRequestListener piped the Web Response into a Node res manually, which
// crashed on Vercel for any non-trivial response body (FUNCTION_INVOCATION_FAILED).
const app = createApp();

export default handle(app);
