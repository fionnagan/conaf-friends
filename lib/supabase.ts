import { createClient } from "@supabase/supabase-js";

// Gracefully degrade when Supabase env vars are not configured.
const url  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "";
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const svc  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? anon;

export const supabaseAvailable = !!(url && anon);

/** Browser-safe client (anon key). Used in React components for realtime. */
export const supabase = supabaseAvailable
  ? createClient(url, anon)
  : null;

/** Server-only client (service-role key). Used in API routes for writes. */
export function getServerClient() {
  if (!supabaseAvailable) return null;
  return createClient(url, svc, { auth: { persistSession: false } });
}

export type Database = {
  public: {
    Tables: {
      submissions: {
        Row: {
          id: string;
          name: string;
          country: string;
          feeling_raw: string;
          feeling_normalized: string;
          embedding: number[] | null;
          generated_image_url: string | null;
          session_id: string | null;
          is_public: boolean;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["submissions"]["Row"], "id" | "created_at">;
      };
    };
  };
};
