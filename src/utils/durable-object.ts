export function getSessionStub(env: Env, sessionId: string) {
  const id = env.CROW_WEB_SESSION.idFromName(sessionId);
  return env.CROW_WEB_SESSION.get(id);
}
