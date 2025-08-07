
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Stripe from 'stripe';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://0.0.0.0:5173', 'https://420caba3-5d56-47b1-8ff8-206e95dae4c2-00-28c6vwdzc3kkb.spock.replit.dev'],
  credentials: true
}));
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Start voice call with Retell AI
app.post('/api/voice-call', async (req, res) => {
  try {
    const { userPhone, userId } = req.body;

    if (!userPhone) {
      return res.status(400).json({ error: 'User phone number is required' });
    }

    // Remove the + sign from phone number for Retell AI
    const cleanPhone = userPhone.replace('+', '');

    // Make call to Retell AI
    const retellResponse = await fetch('https://api.retellai.com/create-phone-call', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RETELL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from_number: process.env.RETELL_PHONE_NUMBER,
        to_number: userPhone,
        agent_id: process.env.RETELL_AGENT_ID,
        metadata: {
          user_id: userId,
          phone: cleanPhone
        }
      })
    });

    if (!retellResponse.ok) {
      const errorData = await retellResponse.text();
      console.error('Retell API error:', errorData);
      return res.status(500).json({ 
        error: 'Failed to initiate call with Retell AI',
        details: errorData 
      });
    }

    const callData = await retellResponse.json();
    
    res.json({ 
      success: true, 
      callId: callData.call_id,
      message: 'Voice call initiated successfully' 
    });

  } catch (error) {
    console.error('Voice call error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Chat with Retell AI agent
app.post('/api/chat', async (req, res) => {
  try {
    const { message, userPhone, userId, sessionId } = req.body;

    if (!message || !userPhone) {
      return res.status(400).json({ error: 'Message and user phone are required' });
    }

    // Clean phone number (remove + sign)
    const cleanPhone = userPhone.replace('+', '');

    // Make request to Retell AI LLM
    const retellResponse = await fetch('https://api.retellai.com/chat-completion', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RETELL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        llm_id: process.env.RETELL_LLM_ID,
        messages: [
          {
            role: 'user',
            content: message
          }
        ],
        metadata: {
          user_id: userId,
          phone: cleanPhone,
          session_id: sessionId
        }
      })
    });

    if (!retellResponse.ok) {
      const errorData = await retellResponse.text();
      console.error('Retell Chat API error:', errorData);
      return res.status(500).json({ 
        error: 'Failed to get response from Savana',
        details: errorData 
      });
    }

    const chatData = await retellResponse.json();
    
    res.json({ 
      success: true, 
      response: chatData.choices?.[0]?.message?.content || 'I apologize, but I couldn\'t process your message. Please try again.',
      sessionId: chatData.session_id
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Create Stripe checkout session
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { priceId, userId, userEmail, planName } = req.body;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${req.headers.origin}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/subscribe`,
      customer_email: userEmail,
      metadata: {
        userId: userId,
        planName: planName,
      },
    });

    res.json({ sessionId: session.id });
  } catch (error) {
    console.error('Stripe session creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Stripe webhook for handling successful payments
app.post('/api/stripe-webhook', express.raw({type: 'application/json'}), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.log(`Webhook signature verification failed.`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      console.log('Payment successful:', session);
      
      // Here you would update your database with the subscription info
      // For example, update the user's subscription status in Supabase
      
      break;
    case 'invoice.payment_succeeded':
      console.log('Subscription payment succeeded');
      break;
    case 'customer.subscription.deleted':
      console.log('Subscription cancelled');
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({received: true});
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
