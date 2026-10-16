import { router, json, error } from '@appdeploy/sdk';

import { appRoutes } from './routes';

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ message: 'Success' })],

  ...appRoutes,
});
