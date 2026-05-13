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

function toBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function isMissingTableError(error) {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "").toLowerCase();
  return code === "42p01" || message.includes("does not exist") || message.includes("schema cache");
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
  let paymentIntentId = sanitizeText(registration.stripe_payment_intent_id);

  if (paymentStatus !== "authorized" && paymentStatus !== "checkout_created") {
    return false;
  }

  if (!paymentIntentId && registration.stripe_session_id) {
    const checkoutSession = await getStripe().checkout.sessions.retrieve(registration.stripe_session_id, {
      expand: ["payment_intent"]
    });

    if (typeof checkoutSession?.payment_intent === "object") {
      paymentIntentId = checkoutSession.payment_intent.id;
    } else {
      paymentIntentId = sanitizeText(checkoutSession?.payment_intent);
    }
  }

  if (!paymentIntentId) {
    return false;
  }

  try {
    await getStripe().paymentIntents.cancel(paymentIntentId);
    return true;
  } catch (stripeError) {
    const code = String(stripeError?.code || "").toLowerCase();
    const message = String(stripeError?.message || "").toLowerCase();

    // Si l'autorisation est déjà annulée ou capturée côté Stripe, on ne bloque pas la suppression Supabase.
    if (
      code.includes("payment_intent_unexpected_state") ||
      message.includes("canceled") ||
      message.includes("cancelled") ||
      message.includes("succeeded") ||
      message.includes("requires_payment_method")
    ) {
      return false;
    }

    throw stripeError;
  }
}

async function safeDelete(table, filters) {
  let query = supabase.from(table).delete();
  filters.forEach((filter) => {
    query = query.eq(filter.column, filter.value);
  });

  const { error } = await query;
  if (error && !isMissingTableError(error)) {
    throw error;
  }

  return !error;
}

async function deleteAuthUserIfNeeded(authUserId) {
  const cleanAuthUserId = sanitizeText(authUserId);
  if (!cleanAuthUserId) return false;

  const { error } = await supabase.auth.admin.deleteUser(cleanAuthUserId);

  if (error) {
    const message = String(error.message || "").toLowerCase();
    if (message.includes("not found") || message.includes("user not found")) {
      return false;
    }
    throw error;
  }

  return true;
}

async function findTrainerProfile(registration) {
  const authUserId = sanitizeText(registration.auth_user_id);
  const email = normalizeEmail(registration.email);

  if (authUserId) {
    const { data, error } = await supabase
      .from("trainers")
      .select("id, email, auth_user_id")
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    if (error && !isMissingTableError(error)) throw error;
    if (data) return data;
  }

  if (email) {
    const { data, error } = await supabase
      .from("trainers")
      .select("id, email, auth_user_id")
      .eq("email", email)
      .maybeSingle();

    if (error && !isMissingTableError(error)) throw error;
    if (data) return data;
  }

  return null;
}

async function deleteTrainerProfileIfNeeded(registration) {
  const trainer = await findTrainerProfile(registration);
  if (!trainer?.id) return false;

  // Les modules/habilitations doivent disparaître avant le profil formateur.
  await safeDelete("trainer_modules", [{ column: "trainer_id", value: trainer.id }]);
  await safeDelete("trainer_certified_modules", [{ column: "trainer_id", value: trainer.id }]);

  const { error } = await supabase
    .from("trainers")
    .delete()
    .eq("id", trainer.id);

  if (error) throw error;
  return true;
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
    const forceDelete = toBoolean(req.body?.force_delete);
    const deleteAuthUser = toBoolean(req.body?.delete_auth_user);
    const deleteTrainerProfile = toBoolean(req.body?.delete_trainer_profile);

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
      const archiveDeleted = await safeDelete("trainer_candidate_archives", [
        { column: "registration_id", value: registrationId }
      ]);

      return res.status(200).json({
        success: true,
        already_deleted: true,
        archive_deleted: archiveDeleted
      });
    }

    const paymentStatus = sanitizeText(registration.payment_status).toLowerCase();
    const paymentAlreadyCaptured = paymentStatus === "captured" || paymentStatus === "paid";

    if (paymentAlreadyCaptured && !forceDelete) {
      return res.status(409).json({
        error: "Ce paiement est déjà encaissé. Confirme la suppression complète depuis l'admin si tu veux supprimer le dossier côté site. Le remboursement Stripe/comptabilité reste à traiter séparément."
      });
    }

    const stripeAuthorizationCanceled = await cancelStripeAuthorizationIfNeeded(registration);

    let authUserDeleted = false;
    let trainerProfileDeleted = false;

    if (deleteTrainerProfile) {
      trainerProfileDeleted = await deleteTrainerProfileIfNeeded(registration);
    }

    if (deleteAuthUser && registration.auth_user_id) {
      authUserDeleted = await deleteAuthUserIfNeeded(registration.auth_user_id);
    }

    // Supprime d'abord l'archive liée, si elle existe, pour éviter un éventuel blocage par contrainte SQL.
    const archiveDeleted = await safeDelete("trainer_candidate_archives", [
      { column: "registration_id", value: registrationId }
    ]);

    const { error: deleteError } = await supabase
      .from("trainer_session_registrations")
      .delete()
      .eq("id", registrationId);

    if (deleteError) {
      return res.status(500).json({ error: deleteError.message });
    }

    return res.status(200).json({
      success: true,
      stripe_authorization_canceled: stripeAuthorizationCanceled,
      auth_user_deleted: authUserDeleted,
      trainer_profile_deleted: trainerProfileDeleted,
      archive_deleted: archiveDeleted,
      captured_payment_was_not_refunded: paymentAlreadyCaptured
    });
  } catch (err) {
    console.error("Delete trainer candidate error:", err);
    return res.status(500).json({ error: err.message });
  }
}
