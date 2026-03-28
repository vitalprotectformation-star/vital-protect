import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { registration_id, result } = req.body;

    if (!["passed", "failed", "resit"].includes(result)) {
      return res.status(400).json({ error: "Invalid result" });
    }

    const { error } = await supabase
      .from("trainer_session_registrations")
      .update({
        training_result: result
      })
      .eq("id", registration_id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
