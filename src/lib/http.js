export const ok = (c, data = {}, status = 200) => c.json({ ok: true, ...data }, status);
export const fail = (c, message, status = 400, details = undefined) =>
  c.json({ ok: false, error: message, ...(details ? { details } : {}) }, status);

export const numberValue = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const textValue = (value) => String(value ?? '').trim();

export const jsonBody = async (c) => {
  try {
    return await c.req.json();
  } catch {
    throw new Error('Invalid JSON request body');
  }
};

export const pageParams = (c, defaults = {}) => {
  const page = Math.max(1, parseInt(c.req.query('page') || defaults.page || '1', 10));
  const size = Math.min(250, Math.max(1, parseInt(c.req.query('size') || defaults.size || '50', 10)));
  return { page, size, offset: (page - 1) * size };
};

export const requestMeta = (c) => ({
  requestId: c.req.header('Cf-Ray') || crypto.randomUUID(),
  ipAddress: c.req.header('CF-Connecting-IP') || '',
  userAgent: c.req.header('User-Agent') || '',
});
