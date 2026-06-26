import { getRequestListener } from '@hono/node-server';
import { createApp } from '../src/app.js';

// This Vercel function runs on the Node.js runtime (pg/bcrypt need it), so the
// entry must be a Node (req, res) listener. getRequestListener produces exactly
// that. (hono/vercel's handle is a Web fetch handler for the Edge runtime and
// is wrong here — Vercel would invoke it with (req, res) and it would crash.)
const app = createApp();

export default getRequestListener(app.fetch);
