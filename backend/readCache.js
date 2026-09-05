/** Bounded, process-local read cache. Never cache errors or invalidate in-flight joins. */
function createReadCache({ ttl = 15000, maxEntries = 256 } = {}) {
  const entries = new Map();
  const flights = new Map();
  let generation = 0;
  return {
    clear() { generation++; entries.clear(); },
    async get(key, read) {
      const flightKey = `${generation}:${key}`;
      const cached = entries.get(key);
      if (cached && Date.now() - cached.at < ttl) {
        console.log(`[Cache] ${key.split(':')[0]} hit`);
        return cached.value;
      }
      if (flights.has(flightKey)) {
        console.log('[Cache] joined existing in-flight query');
        return flights.get(flightKey);
      }
      console.log(`[Cache] ${key.split(':')[0]} miss`);
      const startGeneration = generation;
      const promise = Promise.resolve().then(read).then(value => {
        if (generation === startGeneration) {
          if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
          entries.set(key, { at: Date.now(), value });
        }
        return value;
      }).catch(error => {
        if (cached && error.status === 402 && !Array.isArray(cached.value)) {
          return { ...cached.value, degraded: true, stale: true, errorCode: 'SUPABASE_QUOTA_COOLDOWN' };
        }
        throw error;
      }).finally(() => flights.delete(flightKey));
      flights.set(flightKey, promise);
      return promise;
    }
  };
}
module.exports = { createReadCache };
