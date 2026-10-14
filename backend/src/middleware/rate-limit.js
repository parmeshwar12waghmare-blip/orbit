const buckets = new Map();

function rateLimit({ limit, windowMs, keyPrefix }) {
  return (req, res, next) => {
    const now = Date.now();
    const identity = req.auth?.sub || req.ip || req.socket.remoteAddress || "unknown";
    const key = `${keyPrefix}:${identity}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    buckets.set(key, bucket);
    if (buckets.size > 5000) for (const [entry, value] of buckets) if (value.resetAt <= now) buckets.delete(entry);
    res.set("RateLimit-Limit", String(limit));
    res.set("RateLimit-Remaining", String(Math.max(0, limit - bucket.count)));
    if (bucket.count > limit) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests. Try again later." } });
    }
    next();
  };
}

module.exports = { rateLimit };
