const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items provided in checkout payload.' });
    }

    // Fetch the latest catalog from the Google Sheets database to verify availability
    const sheetUrl = process.env.GOOGLE_SHEET_WEB_APP_URL;
    if (!sheetUrl) {
      return res.status(500).json({ error: 'Database URL (GOOGLE_SHEET_WEB_APP_URL) not configured.' });
    }

    const sheetRes = await fetch(sheetUrl);
    if (!sheetRes.ok) {
      throw new Error(`Failed to fetch database: ${sheetRes.status}`);
    }
    const dbProducts = await sheetRes.json();

    // Verify each item is still in stock (inventory > 0)
    for (const cartItem of items) {
      const dbProduct = dbProducts.find(p => p.id === cartItem.id);
      if (!dbProduct || dbProduct.inventory <= 0) {
        return res.status(400).json({
          error: `Item "${cartItem.title || 'Product'}" is unfortunately sold out.`
        });
      }
    }

    // Construct Stripe Line Items
    const lineItems = items.map(item => {
      const imageUrl = item.images && item.images.length > 0 ? item.images[0] : '';
      // Stripe requires fully qualified absolute URLs for product images
      const absoluteImageUrl = imageUrl.startsWith('http') ? imageUrl : undefined;

      return {
        price_data: {
          currency: 'gbp',
          product_data: {
            name: item.title,
            description: (item.then && item.now) ? `Then: ${item.then} ➔ Now: ${item.now}` : item.description || '',
            images: absoluteImageUrl ? [absoluteImageUrl] : undefined,
            metadata: {
              id: item.id.toString()
            }
          },
          unit_amount: Math.round(item.price * 100) // Convert to pence/cents
        },
        quantity: 1
      };
    });

    // Determine host protocol for redirections
    const host = req.headers.host || 'localhost:3000';
    const protocol = host.startsWith('localhost') ? 'http://' : 'https://';
    const successUrl = `${protocol}${host}/#success`;
    const cancelUrl = `${protocol}${host}/#collections`;

    // Create a secure Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        productIds: items.map(item => item.id).join(',')
      }
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout Session Creation Error:', err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
};
