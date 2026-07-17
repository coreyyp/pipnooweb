const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Helper to buffer the raw request stream (required for Stripe signature check)
const getRawBody = async (readable) => {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
};

// Disable Vercel's automatic body parser so we can verify the raw Stripe signature
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Fulfil the order upon successful payment
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const productIdsStr = session.metadata.productIds;

    if (productIdsStr) {
      const productIds = productIdsStr.split(',').map(Number);
      
      const sheetUrl = process.env.GOOGLE_SHEET_WEB_APP_URL;
      const apiSecret = process.env.GOOGLE_SHEET_API_SECRET;

      if (sheetUrl && apiSecret) {
        // Send authenticated decrement requests to Google Sheets for each item purchased
        for (const id of productIds) {
          try {
            const sheetRes = await fetch(sheetUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain' },
              body: JSON.stringify({
                action: 'decrement',
                secret: apiSecret,
                id: id
              })
            });
            const result = await sheetRes.json();
            if (!result.success) {
              console.error(`Spreadsheet decrement error for product ${id}:`, result.error);
            }
          } catch (err) {
            console.error(`Failed to connect to Google Sheets to decrement product ${id}:`, err);
          }
        }
      } else {
        console.error('Database configuration (GOOGLE_SHEET_WEB_APP_URL/GOOGLE_SHEET_API_SECRET) missing in webhook env.');
      }
    }
  }

  res.status(200).json({ received: true });
};

// Configure Vercel API Route
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
