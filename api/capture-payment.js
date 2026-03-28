import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { registration_id, payment_intent_id } = req.body;

    const { data: registration, error } = await supabase
      .from("trainer_session_registrations")
      .select("*")
      .eq("id", registration_id)
      .single();

    if (error || !registration) {
      return res.status(404).json({ error: "Registration not found" });
    }

    if (registration.payment_status === "captured") {
      return res.status(400).json({ error: "Already captured" });
    }

    // 💳 Capture Stripe
    await stripe.paymentIntents.capture(payment_intent_id);

    // 🔄 Update DB
    await supabase
      .from("trainer_session_registrations")
      .update({
        payment_status: "captured",
        validation_status: "validated"
      })
      .eq("id", registration_id);

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
