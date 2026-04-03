import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeText(value, fallback = "") {
  return String(value || fallback).trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      first_name,
      last_name,
      email,
      phone,
      city,
      training_type,
      message,
      session_id
    } = req.body;

    const cleanFirstName = sanitizeText(first_name);
    const cleanLastName = sanitizeText(last_name);
    const cleanEmail = normalizeEmail(email);
    const cleanPhone = sanitizeText(phone);
    const cleanCity = sanitizeText(city);
    const cleanTrainingType = sanitizeText(training_type);
    const cleanMessage = sanitizeText(message);
    const cleanSessionId = sanitizeText(session_id);

    if (!cleanFirstName) {
      return res.status(400).json({ error: "Prénom manquant" });
    }

    if (!cleanLastName) {
      return res.status(400).json({ error: "Nom manquant" });
    }

    if (!cleanEmail) {
      return res.status(400).json({ error: "Email manquant" });
    }

    if (!cleanPhone) {
      return res.status(400).json({ error: "Téléphone manquant" });
    }

    if (!cleanCity) {
      return res.status(400).json({ error: "Ville manquante" });
    }

    if (!cleanTrainingType) {
      return res.status(400).json({ error: "Module manquant" });
    }

    if (!cleanSessionId) {
      return res.status(400).json({ error: "Session manquante" });
    }

    const { data: trainerSession, error: sessionError } = await supabase
      .from("trainer_sessions")
      .select("*")
      .eq("id", cleanSessionId)
      .maybeSingle();

    if (sessionError) {
      console.error("Trainer session fetch error:", sessionError);
      return res.status(500).json({ error: "Erreur lecture session formateur" });
    }

    if (!trainerSession) {
      return res.status(404).json({ error: "Session formateur introuvable" });
    }

    if (String(trainerSession.status || "").toLowerCase() !== "open") {
      return res.status(400).json({
        error: "Cette session n'est pas ouverte à la réservation"
      });
    }

    const remainingPlaces = Number(trainerSession.remaining_places || 0);
    if (remainingPlaces <= 0) {
      return res.status(400).json({ error: "Cette session est complète" });
    }

    const sessionModuleName = sanitizeText(
      trainerSession.module_name || trainerSession.training_type || trainerSession.title
    );

    if (
      sessionModuleName &&
      cleanTrainingType &&
      sessionModuleName.toLowerCase() !== cleanTrainingType.toLowerCase()
    ) {
      return res.status(400).json({
        error: "Le module sélectionné ne correspond pas à la session choisie"
      });
    }

    const launchPrice = Number(trainerSession.launch_price || 0);
    const standardPrice = Number(trainerSession.standard_price || 0);
    const selectedPrice = launchPrice > 0 ? launchPrice : standardPrice;

    if (!selectedPrice || selectedPrice <= 0) {
      return res.status(400).json({ error: "Tarif session invalide" });
    }

    const origin = req.headers.origin || "https://www.vital-protect.fr";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: cleanEmail,

      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name:
                trainerSession.title ||
                sessionModuleName ||
                "Formation formateur VITAL PROTECT",
              description: `Réservation session formateur${
                trainerSession.city ? ` - ${trainerSession.city}` : ""
              }`
            },
            unit_amount: Math.round(selectedPrice * 100)
          },
          quantity: 1
        }
      ],

      payment_intent_data: {
        capture_method: "manual"
      },

      metadata: {
        type: "trainer",
        session_id: cleanSessionId,
        training_type: sessionModuleName || cleanTrainingType,
        first_name: cleanFirstName,
        last_name: cleanLastName,
        email: cleanEmail,
        phone: cleanPhone,
        city: cleanCity,
        message: cleanMessage
      },

      success_url: `${origin}/trainer-success.html?session_id=${encodeURIComponent(cleanSessionId)}`,
      cancel_url: `${origin}/trainer-cancel.html?session_id=${encodeURIComponent(cleanSessionId)}`
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Create trainer checkout error:", err);
    return res.status(500).json({ error: "Erreur Stripe checkout formateur" });
  }
}
