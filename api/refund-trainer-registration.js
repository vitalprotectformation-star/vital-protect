import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

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
    return { ok: false, status: 401, error: "Token d'authentification manquant" };
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser(token);

  if (userError || !user?.email) {
    return { ok: false, status: 401, error: "Session admin invalide" };
  }

  const email = normalizeEmail(user.email);

  const { data: adminUser, error: adminError } = await supabase
    .from("admin_users")
    .select("id, email")
    .eq("email", email)
    .maybeSingle();

  if (adminError) {
    return { ok: false, status: 500, error: "Erreur de vérification admin" };
  }

  if (!adminUser) {
    return { ok: false, status: 403, error: "Accès refusé" };
  }

  return { ok: true, user, adminUser };
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

    const { data: reg, error: regError } = await supabase
      .from("trainer_session_registrations")
      .select("id, email, first_name, last_name, payment_status, validation_status, stripe_payment_intent_id, stripe_session_id, refunded_at, stripe_refund_id")
      .eq("id", registrationId)
      .maybeSingle();

    if (regError || !reg) {
      return res.status(404).json({ error: "Inscription introuvable" });
    }

    if (reg.refunded_at || reg.stripe_refund_id) {
      return res.status(400).json({ error: "Cette inscription a déjà été remboursée" });
    }

    const { data: trainer } = await supabase
      .from("trainers")
      .select("id")
      .ilike("email", reg.email || "")
      .maybeSingle();

    if (trainer) {
      return res.status(400).json({ error: "Ce formateur est déjà activé — remboursement impossible depuis l'admin" });
    }

    let paymentIntentId = reg.stripe_payment_intent_id;

    if (!paymentIntentId && reg.stripe_session_id) {
      try {
        const session = await stripe.checkout.sessions.retrieve(reg.stripe_session_id);
        paymentIntentId = session.payment_intent;
      } catch (err) {
        return res.status(500).json({ error: "Impossible de récupérer la session Stripe : " + err.message });
      }
    }

    if (!paymentIntentId) {
      return res.status(400).json({ error: "Aucun paiement Stripe trouvé pour cette inscription" });
    }

    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      reason: "requested_by_customer"
    });

    await supabase
      .from("trainer_session_registrations")
      .update({
        refunded_at: new Date().toISOString(),
        stripe_refund_id: refund.id,
        payment_status: "refunded",
        validation_status: "cancelled"
      })
      .eq("id", registrationId);

    return res.status(200).json({
      success: true,
      refund_id: refund.id,
      amount: refund.amount
    });

  } catch (err) {
    return res.status(500).json({ error: "Erreur Stripe : " + err.message });
  }
}
