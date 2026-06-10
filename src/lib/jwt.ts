import { sign, verify } from 'hono/jwt';
import { z } from 'zod';

const jwtPayloadSchema = z.object({
  sub: z.number(),
  email: z.string(),
  exp: z.number(),
});

export type JwtPayload = z.infer<typeof jwtPayloadSchema>;

const TTL_SECONDS = 60 * 60 * 24; // 24h

export async function signToken(userId: number, email: string, secret: string): Promise<string> {
  const payload: JwtPayload = {
    sub: userId,
    email,
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  };
  return sign(payload, secret);
}

export async function verifyToken(token: string, secret: string): Promise<JwtPayload> {
  const raw = await verify(token, secret, 'HS256');
  return jwtPayloadSchema.parse(raw);
}
