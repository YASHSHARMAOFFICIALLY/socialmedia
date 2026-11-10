declare global {
  namespace Express {
    interface Request {
      id: string;
      /** Raw JSON body bytes (needed to verify platform webhook signatures). */
      rawBody?: Buffer;
      user?: { id: string; email: string; name: string };
    }
  }
}
export {};
