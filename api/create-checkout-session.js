import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      stage_id,
      stage_title,
      first_name,
      last_name,
      email,
      phone,
      places,
      unit_price
    } = req.body;

    if (!stage_id || !stage_title || !email || !places || !unit_price) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const qty = Number(places);
    const price = Number(unit_price);

    if (!Number.isFinite(qty) || qty < 1) {
      return res.status(400).json({ error: "Invalid quantity" });
    }

    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ error: "Invalid unit price" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,

      metadata: {
        stage_id: String(stage_id),
        stage_title: String(stage_title),
        first_name: String(first_name || ""),
        last_name: String(last_name || ""),
        email: String(email || ""),
        phone: String(phone || ""),
        places: String(qty),
        unit_price: String(price)
      },

      success_url: `${req.headers.origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/cancel.html`,

      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: stage_title
            },
            unit_amount: Math.round(price * 100)
          },
          quantity: qty
        }
      ]
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout error:", err);
    return res.status(500).json({ error: "Stripe error" });
  }
}
