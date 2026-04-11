import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { data, error } = await supabase
      .from("training_modules")
      .select("*")
      .eq("status", "active")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      modules: data || []
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
