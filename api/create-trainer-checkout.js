import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20"
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    const {
      session_id,
      first_name,
      last_name,
      email,
      phone,
      city,
      training_type,
      message
    } = req.body || {};

    if (!session_id || !first_name || !last_name || !email || !phone || !city || !training_type) {
      return res.status(400).json({
        error: "Champs obligatoires manquants."
      });
    }

    const stripeSession = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      payment_intent_data: {
        capture_method: "manual",
        metadata: {
          session_id: String(session_id),
          first_name: String(first_name),
          last_name: String(last_name),
          email: String(email),
          phone: String(phone),
          city: String(city),
          training_type: String(training_type),
          message: String(message || "")
        }
      },
      metadata: {
        session_id: String(session_id),
        first_name: String(first_name),
        last_name: String(last_name),
        email: String(email),
        phone: String(phone),
        city: String(city),
        training_type: String(training_type),
        message: String(message || "")
      },
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `Réservation formateur — ${training_type}`,
              description: `Session ${session_id} — ${first_name} ${last_name}`
            },
            unit_amount: 5000
          },
          quantity: 1
        }
      ],
      success_url: `${req.headers.origin}/devenir-formateur.html?checkout=success&session_id=${encodeURIComponent(session_id)}&training_type=${encodeURIComponent(training_type)}`,
      cancel_url: `${req.headers.origin}/devenir-formateur.html?checkout=cancel&session_id=${encodeURIComponent(session_id)}&training_type=${encodeURIComponent(training_type)}`
    });

    return res.status(200).json({
      url: stripeSession.url
    });
  } catch (error) {
    console.error("Erreur create-trainer-checkout:", error);
    return res.status(500).json({
      error: "Erreur serveur lors de la création du checkout."
    });
  }
}
