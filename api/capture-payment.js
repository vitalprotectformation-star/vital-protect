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
    const { payment_intent_id, registration_id } = req.body;

    if (!payment_intent_id || !registration_id) {
      return res.status(400).json({ error: "Missing data" });
    }

    await stripe.paymentIntents.capture(payment_intent_id);

    const { error } = await supabase
      .from("trainer_session_registrations")
      .update({
        payment_status: "captured",
        validation_status: "validated",
        training_result: "passed",
        validated_at: new Date().toISOString()
      })
      .eq("id", registration_id);

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "DB update error" });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Capture error" });
  }
}
