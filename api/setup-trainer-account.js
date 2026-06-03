import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeText(value) {
  return String(value || "").trim();
}

function isMissingColumnError(error, columnName) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes(String(columnName || "").toLowerCase()) && message.includes("column");
}

function withoutUndefined(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

async function updateWithOptionalColumns(table, payload, filters, optionalColumns = []) {
  const omittedColumns = [];
  let currentPayload = withoutUndefined({ ...payload });

  for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
    let query = supabase.from(table).update(currentPayload);
    filters.forEach(filter => {
      query = query.eq(filter.column, filter.value);
    });

    const { data, error } = await query.select().single();
    if (!error) return { data, error: null, omittedColumns };

    const missingColumn = optionalColumns.find(
      columnName => Object.prototype.hasOwnProperty.call(currentPayload, columnName) && isMissingColumnError(error, columnName)
    );

    if (!missingColumn) return { data: null, error, omittedColumns };

    omittedColumns.push(missingColumn);
    currentPayload = { ...currentPayload };
    delete currentPayload[missingColumn];
  }

  return { data: null, error: new Error("Colonnes optionnelles incompatibles"), omittedColumns };
}

async function findAuthUserByEmail(email) {
  const target = normalizeEmail(email);
  if (!target) return null;

  let page = 1;
  const perPage = 1000;

  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message || "Impossible de rechercher l'utilisateur Auth");

    const users = data?.users || [];
    const found = users.find(user => normalizeEmail(user.email) === target);
    if (found) return found;
    if (users.length < perPage) return null;
    page += 1;
  }

  return null;
}

function isPaymentUsable(paymentStatus) {
  const status = String(paymentStatus || "").toLowerCase();
  return ["checkout_created", "authorized", "captured", "paid", "pending_payment"].includes(status);
}

async function getRegistrationFromStripeSession(sessionId) {
  const cleanSessionId = sanitizeText(sessionId);
  if (!cleanSessionId || !cleanSessionId.startsWith("cs_")) {
    throw Object.assign(new Error("Session Stripe invalide"), { status: 400 });
  }

  const checkoutSession = await stripe.checkout.sessions.retrieve(cleanSessionId, {
    expand: ["payment_intent"]
  });

  if (checkoutSession?.metadata?.type !== "trainer") {
    throw Object.assign(new Error("Cette session ne correspond pas à un parcours formateur"), { status: 400 });
  }

  const paymentIntent = checkoutSession.payment_intent;
  const paymentIntentStatus = paymentIntent && typeof paymentIntent === "object"
    ? String(paymentIntent.status || "")
    : "";
  const checkoutPaymentStatus = String(checkoutSession.payment_status || "").toLowerCase();
  const checkoutStatus = String(checkoutSession.status || "").toLowerCase();
  const amountTotal = Number(checkoutSession.amount_total || 0);
  const allowedPaymentIntentStatuses = ["requires_capture", "processing", "succeeded"];

  if (paymentIntentStatus && !allowedPaymentIntentStatuses.includes(paymentIntentStatus)) {
    throw Object.assign(new Error("Le paiement n'est pas confirmé côté Stripe"), { status: 402 });
  }

  // Stripe peut renvoyer payment_intent = null pour certains cas :
  // session à 0 €, session sans paiement à capturer, ou paiement traité autrement.
  // Dans ce cas, on ne doit pas lire payment_intent.status et faire planter l'API.
  if (!paymentIntentStatus && amountTotal > 0 && checkoutPaymentStatus === "unpaid" && checkoutStatus !== "complete") {
    throw Object.assign(new Error("Le paiement n'est pas confirmé côté Stripe"), { status: 402 });
  }

  const { data: registration, error } = await supabase
    .from("trainer_session_registrations")
    .select("*")
    .eq("stripe_session_id", cleanSessionId)
    .maybeSingle();

  if (error) throw error;
  if (!registration) {
    throw Object.assign(new Error("Dossier candidat introuvable"), { status: 404 });
  }

  return registration;
}

async function getRegistrationFromInvite(registrationId, token) {
  const cleanRegistrationId = sanitizeText(registrationId);
  const cleanToken = sanitizeText(token);

  if (!cleanRegistrationId || !cleanToken) {
    throw Object.assign(new Error("Lien d'accès incomplet"), { status: 400 });
  }

  const { data: registration, error } = await supabase
    .from("trainer_session_registrations")
    .select("*")
    .eq("id", cleanRegistrationId)
    .eq("portal_access_token", cleanToken)
    .maybeSingle();

  if (error) throw error;
  if (!registration) {
    throw Object.assign(new Error("Lien d'accès invalide ou expiré"), { status: 404 });
  }

  const expiresAt = registration.portal_access_token_expires_at
    ? new Date(registration.portal_access_token_expires_at)
    : null;

  if (expiresAt && expiresAt.getTime() < Date.now()) {
    throw Object.assign(new Error("Ce lien a expiré. Demandez un nouveau lien à VITAL PROTECT."), { status: 410 });
  }

  return registration;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: "Variables Supabase serveur manquantes" });
    }

    const password = sanitizeText(req.body?.password);
    const confirmPassword = sanitizeText(req.body?.confirm_password || req.body?.confirmPassword || req.body?.password_confirmation);

    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Le mot de passe doit contenir au moins 8 caractères." });
    }

    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({ error: "Les deux mots de passe ne correspondent pas." });
    }

    const sessionId = sanitizeText(req.body?.session_id);
    const registrationId = sanitizeText(req.body?.registration_id);
    const token = sanitizeText(req.body?.token);

    const registration = sessionId
      ? await getRegistrationFromStripeSession(sessionId)
      : await getRegistrationFromInvite(registrationId, token);

    if (!registration?.email) {
      return res.status(404).json({ error: "Email candidat introuvable" });
    }

    if (!isPaymentUsable(registration.payment_status)) {
      return res.status(403).json({ error: "Le paiement du parcours formateur n'est pas confirmé." });
    }

    const email = normalizeEmail(registration.email);
    const existingUser = await findAuthUserByEmail(email);
    const metadata = {
      ...(existingUser?.user_metadata || {}),
      role: existingUser?.user_metadata?.role || "trainer_candidate",
      trainer_candidate_registration_id: registration.id,
      first_name: existingUser?.user_metadata?.first_name || registration.first_name || "",
      last_name: existingUser?.user_metadata?.last_name || registration.last_name || "",
      password_created_by_candidate: true,
      password_created_at: new Date().toISOString()
    };

    let authUserId = existingUser?.id || null;
    let created = false;

    if (existingUser?.id) {
      const { data: updated, error: updateError } = await supabase.auth.admin.updateUserById(existingUser.id, {
        password,
        email_confirm: true,
        user_metadata: metadata
      });

      if (updateError) return res.status(500).json({ error: updateError.message });
      authUserId = updated?.user?.id || existingUser.id;
    } else {
      const { data: createdUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: metadata
      });

      if (createError) return res.status(500).json({ error: createError.message });
      authUserId = createdUser?.user?.id || null;
      created = true;
    }

    const now = new Date().toISOString();
    await updateWithOptionalColumns(
      "trainer_session_registrations",
      {
        auth_user_id: authUserId,
        portal_account_created_at: now,
        portal_access_token: null,
        portal_access_token_expires_at: null
      },
      [{ column: "id", value: registration.id }],
      ["auth_user_id", "portal_account_created_at", "portal_access_token", "portal_access_token_expires_at"]
    );

    return res.status(200).json({
      success: true,
      created,
      email,
      auth_user_id: authUserId,
      registration_id: registration.id
    });
  } catch (error) {
    console.error("Setup trainer account error:", error);
    return res.status(error.status || 500).json({
      error: error.message || "Erreur lors de la création de l'accès formateur"
    });
  }
}
