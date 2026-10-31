import { Redis } from 'ioredis';
import { config } from '../config.js';

/**
 * BullMQ requires maxRetriesPerRequest: null on its connections.
 * family: 0 resolves both IPv4 and IPv6, needed for Railway's private network.
 */
export function createRedis(): Redis {
  return new Redis(config.redisUrl, { maxRetriesPerRequest: null, family: 0 });
}
