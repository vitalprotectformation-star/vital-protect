import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {

  // GET /api/satisfaction?token=xxx — vérifie le token et retourne les infos du stage
  if (req.method === "GET") {
    const token = req.query?.token;
    if (!token) return res.status(400).json({ error: "Token manquant" });

    const { data: stage, error } = await supabase
      .from("stages")
      .select("id, module_name, stage_date, city, satisfaction_token")
      .eq("satisfaction_token", token)
      .maybeSingle();

    if (error || !stage) {
      return res.status(404).json({ error: "QR code invalide ou expiré" });
    }

    return res.status(200).json({
      success: true,
      stage: {
        module_name: stage.module_name,
        stage_date: stage.stage_date,
        city: stage.city
      }
    });
  }

  // POST /api/satisfaction — soumet une réponse anonyme
  if (req.method === "POST") {
    const { token, score_global, score_formateur, score_contenu, recommande, commentaire } = req.body || {};

    if (!token) return res.status(400).json({ error: "Token manquant" });

    // Validate scores
    for (const s of [score_global, score_formateur, score_contenu]) {
      const n = Number(s);
      if (!n || n < 1 || n > 5) {
        return res.status(400).json({ error: "Toutes les notes sont requises (1 à 5)" });
      }
    }

    // Verify token exists
    const { data: stage, error: stageError } = await supabase
      .from("stages")
      .select("id, satisfaction_token")
      .eq("satisfaction_token", token)
      .maybeSingle();

    if (stageError || !stage) {
      return res.status(404).json({ error: "QR code invalide" });
    }

    // Insert anonymous response
    const { error: insertError } = await supabase
      .from("satisfaction_responses")
      .insert({
        stage_id: stage.id,
        stage_token: token,
        score_global: Number(score_global),
        score_formateur: Number(score_formateur),
        score_contenu: Number(score_contenu),
        recommande: recommande === true || recommande === "true",
        commentaire: String(commentaire || "").trim().slice(0, 2000) || null
      });

    if (insertError) {
      return res.status(500).json({ error: insertError.message });
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
