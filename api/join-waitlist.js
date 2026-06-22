import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function sanitizeText(value, fallback = "") {
  return String(value || fallback).trim();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function normalizePostalCode(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const firstName = sanitizeText(req.body?.first_name);
    const email = normalizeEmail(req.body?.email);
    const postalCode = normalizePostalCode(req.body?.postal_code);
    const city = sanitizeText(req.body?.city);
    const website = sanitizeText(req.body?.website); // honeypot anti-spam

    if (website) {
      // Soumission probablement automatisée : on répond succès sans rien enregistrer.
      return res.status(200).json({ success: true });
    }

    if (!firstName) {
      return res.status(400).json({ error: "Prénom manquant" });
    }

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: "Email invalide" });
    }

    if (!postalCode || !/^\d{4,5}$/.test(postalCode)) {
      return res.status(400).json({ error: "Code postal invalide" });
    }

    const { error } = await supabase
      .from("waitlist_signups")
      .insert({
        first_name: firstName,
        email,
        postal_code: postalCode,
        city: city || null
      });

    if (error) {
      // Une contrainte unique (email, postal_code) peut déjà exister : on ne traite
      // pas un doublon comme une erreur côté utilisateur.
      if (error.code === "23505") {
        return res.status(200).json({ success: true, already_registered: true });
      }

      console.error("Erreur insertion waitlist_signups:", error);
      return res.status(500).json({ error: "Impossible d'enregistrer votre demande pour le moment." });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Erreur join-waitlist:", err);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
