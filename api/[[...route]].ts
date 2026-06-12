import { getRequestListener } from '@hono/node-server';
import { createApp } from '../src/app.js';

const app = createApp();

export default getRequestListener(app.fetch);
