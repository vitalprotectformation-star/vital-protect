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
    return res.status(405).send("Method not allowed");
  }

  try {
    const origin = req.headers.origin || "https://www.vital-protect.fr";
    const type = sanitizeText(req.body?.type).toLowerCase();

    if (type === "trainer") {
      const firstName = sanitizeText(req.body?.first_name);
      const lastName = sanitizeText(req.body?.last_name);
      const email = normalizeEmail(req.body?.email);
      const phone = sanitizeText(req.body?.phone);
      const city = sanitizeText(req.body?.city);
      const message = sanitizeText(req.body?.message);
      const sessionId = sanitizeText(req.body?.session_id);

      if (!firstName) {
        return res.status(400).json({ error: "Prénom manquant" });
      }

      if (!lastName) {
        return res.status(400).json({ error: "Nom manquant" });
      }

      if (!email) {
        return res.status(400).json({ error: "Email manquant" });
      }

      if (!phone) {
        return res.status(400).json({ error: "Téléphone manquant" });
      }

      if (!city) {
        return res.status(400).json({ error: "Ville manquante" });
      }

      if (!sessionId) {
        return res.status(400).json({ error: "Session formateur manquante" });
      }

      const { data: trainerSession, error: trainerSessionError } = await supabase
        .from("trainer_sessions")
        .select("*")
        .eq("id", sessionId)
        .maybeSingle();

      if (trainerSessionError) {
        return res.status(500).json({ error: trainerSessionError.message });
      }

      if (!trainerSession) {
        return res.status(404).json({ error: "Session formateur introuvable" });
      }

      if (String(trainerSession.status || "").toLowerCase() !== "open") {
        return res.status(400).json({ error: "Cette session n'est pas ouverte" });
      }

      if (Number(trainerSession.remaining_places || 0) < 1) {
        return res.status(400).json({ error: "Cette session est complète" });
      }

      const moduleName = sanitizeText(
        trainerSession.module_name || trainerSession.title || "Formation formateur"
      );

      const unitAmount = Math.round(
        Number(trainerSession.launch_price || trainerSession.standard_price || 0) * 100
      );

      if (!unitAmount || unitAmount <= 0) {
        return res.status(400).json({ error: "Tarif de session invalide" });
      }

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        customer_email: email,
        line_items: [
          {
            price_data: {
              currency: "eur",
              product_data: {
                name: moduleName,
                description: `Formation formateur VITAL PROTECT — ${trainerSession.city || ""}`
              },
              unit_amount: unitAmount
            },
            quantity: 1
          }
        ],
        payment_intent_data: {
          capture_method: "manual"
        },
        metadata: {
          type: "trainer",
          session_id: sessionId,
          training_type: moduleName,
          first_name: firstName,
          last_name: lastName,
          email,
          phone,
          city,
          message
        },
        success_url: `${origin}/trainer-success.html?session_id=${encodeURIComponent(sessionId)}`,
        cancel_url: `${origin}/trainer-cancel.html?session_id=${encodeURIComponent(sessionId)}`
      });

      return res.status(200).json({ url: session.url });
    }

    const stageId = sanitizeText(req.body?.stage_id);
    const stageTitle = sanitizeText(req.body?.stage_title, "Stage VITAL PROTECT");
    const firstName = sanitizeText(req.body?.first_name);
    const lastName = sanitizeText(req.body?.last_name);
    const email = normalizeEmail(req.body?.email);
    const phone = sanitizeText(req.body?.phone);
    const quantity = Math.max(1, Number(req.body?.places || 1));
    const unitPrice = Math.max(0, Number(req.body?.unit_price || 0));

    if (!stageId) {
      return res.status(400).json({ error: "Stage manquant" });
    }

    if (!email) {
      return res.status(400).json({ error: "Email manquant" });
    }

    if (!unitPrice) {
      return res.status(400).json({ error: "Prix du stage invalide" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: stageTitle,
              description: "Réservation stage VITAL PROTECT"
            },
            unit_amount: Math.round(unitPrice * 100)
          },
          quantity
        }
      ],
      metadata: {
        type: "stage",
        stage_id: stageId,
        stage_title: stageTitle,
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        places: String(quantity),
        unit_price: String(unitPrice)
      },
      customer_email: email,
      success_url: `${origin}/success.html`,
      cancel_url: `${origin}/cancel.html`
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout session error:", err);
    return res.status(500).json({ error: "Erreur Stripe" });
  }
}
