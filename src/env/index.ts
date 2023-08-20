import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.string().default("3000"),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().default("poorlykeptsecret"),
});

const envSafed = envSchema.safeParse(process.env);

if (!envSafed.success) {
  throw new Error(envSafed.error.message);
}

export const env = envSafed.data;
