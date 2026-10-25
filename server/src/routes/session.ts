import type { FastifyInstance } from 'fastify';
import type { Auth } from '../auth.js';
import { AppError } from '../errors.js';
import { isPlainObject } from '../validation.js';

/** Simulated sign-in: pick one of the seeded users. See auth.ts for what this is and is not. */
export function registerSessionRoutes(app: FastifyInstance, auth: Auth): void {
  // Who am I, and who can I switch to. Public by design: the seeded accounts are the simulation.
  app.get('/api/session', async (req) => ({ user: auth.currentUser(req), users: auth.listUsers() }));

  app.post('/api/session', async (req, reply) => {
    const body = isPlainObject(req.body) ? req.body : {};
    const userId = body.userId;
    if (typeof userId !== 'string' || userId === '') throw new AppError('VALIDATION_ERROR', 'A user id is required');
    const user = auth.findUser(userId);
    if (!user) throw new AppError('UNAUTHENTICATED', 'Unknown user');
    auth.signIn(reply, user.id);
    return { user };
  });

  app.delete('/api/session', async (_req, reply) => {
    auth.signOut(reply);
    return reply.code(204).send();
  });
}
