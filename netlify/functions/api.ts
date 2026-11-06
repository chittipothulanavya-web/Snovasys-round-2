import serverless from 'serverless-http';
import { startServer } from '../../server.js';

let expressHandler: ReturnType<typeof serverless> | null = null;

async function getHandler() {
  if (!expressHandler) {
    process.env.NETLIFY = 'true';
    process.env.NODE_ENV = 'production';
    const app = await startServer({ listen: false });
    expressHandler = serverless(app);
  }
  return expressHandler;
}

export const handler = async (event: any, context: any) => {
  const netlifyHandler = await getHandler();
  return netlifyHandler(event, context);
};
