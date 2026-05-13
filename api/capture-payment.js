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

async function requireAdmin(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "Token d'authentification manquant"
    };
  }

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser(token);

  if (userError || !user?.email) {
    return {
      ok: false,
      status: 401,
      error: "Session admin invalide"
    };
  }

  const email = normalizeEmail(user.email);

  const { data: adminUser, error: adminError } = await supabase
    .from("admin_users")
    .select("id, email")
    .eq("email", email)
    .maybeSingle();

  if (adminError) {
    return {
      ok: false,
      status: 500,
      error: "Erreur de vérification admin"
    };
  }

  if (!adminUser) {
    return {
      ok: false,
      status: 403,
      error: "Accès refusé"
    };
  }

  return {
    ok: true,
    user,
    adminUser
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const adminCheck = await requireAdmin(req);

    if (!adminCheck.ok) {
      return res.status(adminCheck.status).json({ error: adminCheck.error });
    }

    const registrationId = sanitizeText(req.body?.registration_id);
    let paymentIntentId = sanitizeText(req.body?.payment_intent_id);

    if (!registrationId) {
      return res.status(400).json({ error: "registration_id manquant" });
    }

    const { data: registration, error } = await supabase
      .from("trainer_session_registrations")
      .select("*")
      .eq("id", registrationId)
      .single();

    if (error || !registration) {
      return res.status(404).json({ error: "Registration not found" });
    }

    if (registration.validation_status === "rejected") {
      return res.status(400).json({
        error: "Impossible d'encaisser un dossier refusé"
      });
    }

    if (["captured", "paid"].includes(String(registration.payment_status || "").toLowerCase())) {
      const { error: alreadyUpdateError } = await supabase
        .from("trainer_session_registrations")
        .update({ validation_status: "validated" })
        .eq("id", registrationId);

      if (alreadyUpdateError) {
        console.error("Registration validation update error:", alreadyUpdateError);
        return res.status(500).json({ error: alreadyUpdateError.message });
      }

      return res.status(200).json({ success: true, already_captured: true });
    }

    if (!paymentIntentId && registration.stripe_payment_intent_id) {
      paymentIntentId = sanitizeText(registration.stripe_payment_intent_id);
    }

    if (!paymentIntentId && registration.stripe_session_id) {
      const checkoutSession = await stripe.checkout.sessions.retrieve(
        registration.stripe_session_id,
        { expand: ["payment_intent"] }
      );

      const paymentIntent = checkoutSession.payment_intent;
      paymentIntentId = typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id;
    }

    if (!paymentIntentId) {
      return res.status(400).json({
        error: "payment_intent_id manquant : impossible de synchroniser ce paiement Stripe"
      });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status === "requires_capture") {
      await stripe.paymentIntents.capture(paymentIntentId);
    } else if (paymentIntent.status === "succeeded") {
      // Paiement déjà capturé côté Stripe : on synchronise simplement Supabase.
    } else {
      return res.status(400).json({
        error: `Le paiement Stripe n'est pas capturable actuellement : ${paymentIntent.status}`
      });
    }

    const { error: updateError } = await supabase
      .from("trainer_session_registrations")
      .update({
        stripe_payment_intent_id: paymentIntentId,
        payment_status: "captured",
        validation_status: "validated"
      })
      .eq("id", registrationId);

    if (updateError) {
      console.error("Registration update error:", updateError);
      return res.status(500).json({ error: updateError.message });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Capture payment error:", err);
    return res.status(500).json({ error: err.message });
  }
}
