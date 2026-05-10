import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

let stripeClient = null;

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY manquant : impossible d'annuler l'autorisation Stripe avant suppression.");
  }

  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  }

  return stripeClient;
}

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

async function cancelStripeAuthorizationIfNeeded(registration) {
  const paymentStatus = sanitizeText(registration.payment_status).toLowerCase();
  const paymentIntentId = sanitizeText(registration.stripe_payment_intent_id);

  if (paymentStatus !== "authorized" || !paymentIntentId) {
    return false;
  }

  try {
    await getStripe().paymentIntents.cancel(paymentIntentId);
    return true;
  } catch (stripeError) {
    const code = String(stripeError?.code || "").toLowerCase();
    const message = String(stripeError?.message || "").toLowerCase();

    // Si l'autorisation est déjà annulée côté Stripe, on ne bloque pas la suppression Supabase.
    if (code.includes("payment_intent_unexpected_state") || message.includes("canceled") || message.includes("cancelled")) {
      return false;
    }

    throw stripeError;
  }
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

    if (!registrationId) {
      return res.status(400).json({ error: "registration_id manquant" });
    }

    const { data: registration, error: registrationError } = await supabase
      .from("trainer_session_registrations")
      .select("*")
      .eq("id", registrationId)
      .maybeSingle();

    if (registrationError) {
      return res.status(500).json({ error: registrationError.message });
    }

    if (!registration) {
      // On nettoie quand même une éventuelle archive orpheline.
      const { error: archiveCleanupError } = await supabase
        .from("trainer_candidate_archives")
        .delete()
        .eq("registration_id", registrationId);

      if (archiveCleanupError) {
        return res.status(500).json({ error: archiveCleanupError.message });
      }

      return res.status(200).json({ success: true, already_deleted: true });
    }

    const paymentStatus = sanitizeText(registration.payment_status).toLowerCase();

    if (paymentStatus === "captured" || paymentStatus === "paid") {
      return res.status(400).json({
        error: "Impossible de supprimer directement un candidat déjà encaissé. Traite d'abord le remboursement / la comptabilité dans Stripe, puis archive le dossier."
      });
    }

    const stripeAuthorizationCanceled = await cancelStripeAuthorizationIfNeeded(registration);

    // Supprime d'abord l'archive liée, si elle existe, pour éviter un éventuel blocage par contrainte SQL.
    const { error: archiveDeleteError } = await supabase
      .from("trainer_candidate_archives")
      .delete()
      .eq("registration_id", registrationId);

    if (archiveDeleteError) {
      return res.status(500).json({ error: archiveDeleteError.message });
    }

    const { error: deleteError } = await supabase
      .from("trainer_session_registrations")
      .delete()
      .eq("id", registrationId);

    if (deleteError) {
      return res.status(500).json({ error: deleteError.message });
    }

    return res.status(200).json({
      success: true,
      stripe_authorization_canceled: stripeAuthorizationCanceled
    });
  } catch (err) {
    console.error("Delete trainer candidate error:", err);
    return res.status(500).json({ error: err.message });
  }
}
