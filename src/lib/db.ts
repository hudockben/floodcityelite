import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// Lazily create the Neon client so that a missing DATABASE_URL only fails at
// request time (not at build time / module import).
let client: NeonQueryFunction<false, false> | null = null;

export function sql(): NeonQueryFunction<false, false> {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Copy .env.example to .env.local and add your Neon connection string.",
      );
    }
    client = neon(url);
  }
  return client;
}
