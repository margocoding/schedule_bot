import { Redis } from "ioredis";
import { config } from "../config/config.js";

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const redisConnection = redis.duplicate();

export const closeRedis = async () => {
  await Promise.allSettled([redis.quit(), redisConnection.quit()]);
};
