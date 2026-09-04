const express = require('express');
const cors = require('cors');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

// BULLETPROOF CORS CONFIGURATION
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors()); 
app.use(express.json());

// Secure Environment Variables
const ARKESEL_API_KEY = process.env.ARKESEL_API_KEY;
const EMAIL_USER = process.env.EMAIL_USER; 
const EMAIL_PASS = process.env.EMAIL_PASS; 
const COUNSEL_EMAIL = process.env.COUNSEL_EMAIL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; 
const ADMIN_SECRET = process.env.ADMIN_SECRET || '2324';

// Initialize Supabase Client
let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('Supabase client initialized successfully.');
}

// Initialize Nodemailer for Yahoo (Kept exactly as requested)
const transporter = nodemailer.createTransport({
    service: 'yahoo',
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
    }
});

// Helper Function: Format Ghana Phone Numbers for Arkesel (Ensures 233 format)
function formatGhanaNumber(phone) {
    let formatted = phone.trim().replace(/[^0-9]/g, '');
    if (formatted.startsWith('0')) {
        formatted = '233' + formatted.substring(1);
    } else if (!formatted.startsWith('233')) {
        formatted = '233' + formatted;
    }
    return formatted;
}

// ========================================================
// HEALTH CHECK
// ========================================================
app.get('/', (req, res) => {
    const isConfigured = Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS && process.env.ARKESEL_API_KEY && process.env.SUPABASE_KEY);
    
    const statusColor = isConfigured ? '#22c55e' : '#ef4444';
    const statusBg = isConfigured ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)';
    const iconSymbol = isConfigured ? '✓' : '⚠';
    const titleText = isConfigured ? 'YOUR WEBSITE BACKEND IS LIVE' : 'YOUR WEBSITE BACKEND IS NOT LIVE';
    const descText = isConfigured 
        ? 'The API server for Akoben Legal Services is running perfectly, connected to Supabase, and ready to accept connections from your frontend.' 
        : 'RESOLVE THE CONFIGURATION ISSUE: Missing critical Environment Variables. Please add them in the Render dashboard to restore full functionality.';

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Backend Status | Akoben Legal</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
        <style>
            body { margin: 0; padding: 0; font-family: 'Inter', sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; overflow: hidden; }
            .container { text-align: center; background: rgba(255, 255, 255, 0.03); padding: 4rem 2rem; border-radius: 24px; backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.05); box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); max-width: 500px; width: 90%; }
            .status-icon { width: 90px; height: 90px; border-radius: 50%; margin: 0 auto 2rem; display: flex; align-items: center; justify-content: center; font-size: 2.5rem; font-weight: 800; background: ${statusBg}; color: ${statusColor}; border: 2px solid ${statusColor}; box-shadow: 0 0 30px ${statusBg}; }
            h1 { margin: 0 0 1rem; font-size: 1.8rem; font-weight: 800; letter-spacing: -0.5px; }
            p { color: #94a3b8; font-size: 1.05rem; line-height: 1.6; margin: 0 auto; max-width: 400px; }
            .interactive-btn { margin-top: 2.5rem; padding: 0.8rem 2rem; background: transparent; color: #e2e8f0; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 50px; font-weight: 600; cursor: pointer; transition: all 0.3s ease; }
            .interactive-btn:hover { background: rgba(255, 255, 255, 0.1); border-color: rgba(255, 255, 255, 0.4); }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="status-icon">${iconSymbol}</div>
            <h1 style="color: ${statusColor}">${titleText}</h1>
            <p>${descText}</p>
            <button class="interactive-btn" onclick="window.location.reload()">Ping Server Check</button>
        </div>
    </body>
    </html>
    `;
    res.send(htmlContent);
});

// ========================================================
// AUTHENTICATION & CLIENT FETCH ROUTE
// ========================================================
app.post('/api/verify-counsel', async (req, res) => {
    const { passcode } = req.body;

    if (passcode !== ADMIN_SECRET) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Counsel Passcode.' });
    }

    try {
        let clients = [];
        if (supabase) {
            const { data, error } = await supabase
                .from('consultations')
                .select('first_name, last_name, phone')
                .order('created_at', { ascending: false });

            if (!error && data) {
                const uniqueClients = new Map();
                data.forEach(client => {
                    if (client.phone && !uniqueClients.has(client.phone)) {
                        uniqueClients.set(client.phone, `${client.first_name} ${client.last_name}`);
                    }
                });
                clients = Array.from(uniqueClients, ([phone, name]) => ({ name, phone }));
            }
        }
        res.status(200).json({ success: true, clients });
    } catch (err) {
        console.error('Verify Counsel Error:', err.message);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// ========================================================
// SECURE PUBLICATION ENDPOINT (NOW WITH MEDIA URL)
// ========================================================
app.post('/api/publish-article', async (req, res) => {
    const { author, passcode, title, content, media_type, media_url } = req.body;

    if (passcode !== ADMIN_SECRET) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Counsel Passcode.' });
    }

    try {
        if (!supabase) throw new Error('Database is not configured correctly on Render.');

        const { data, error } = await supabase
            .from('publications')
            .insert([{ title, content, author, media_type, media_url }])
            .select();

        if (error) throw error;

        res.status(200).json({ success: true, message: 'Article published successfully to database', data });
    } catch (err) {
        console.error('Publish Article Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ========================================================
// SECURE DIRECT SMS ENDPOINT (FIXED ARKESEL FORMATTING)
// ========================================================
app.post('/api/send-custom-sms', async (req, res) => {
    const { passcode, phone, message } = req.body;

    if (passcode !== ADMIN_SECRET) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Counsel Passcode.' });
    }

    try {
        // Auto-format phone number to '233...' so Arkesel API accepts it
        const formattedPhone = formatGhanaNumber(phone);

        await axios.post('https://sms.arkesel.com/api/v2/sms/send', {
            sender: 'AKOBEN', 
            message: message,
            recipients: [formattedPhone]
        }, {
            headers: { 
                'api-key': ARKESEL_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        res.status(200).json({ success: true, message: 'SMS sent successfully.' });
    } catch (error) {
        console.error('Custom SMS Error:', error?.response?.data || error.message);
        res.status(500).json({ success: false, error: 'Failed to send Custom SMS. Check Arkesel API Key.' });
    }
});

// ========================================================
// NOTIFICATIONS: Consultations (BACKGROUND PROCESSING FIX)
// ========================================================
app.post('/api/notify-consultation', async (req, res) => {
    const { 
        first_name, last_name, email, phone, 
        practice_area, consultation_type, issue_description 
    } = req.body;

    // Generate unique 5-digit booking reference ID immediately
    const bookingId = `AKB-${Math.floor(10000 + Math.random() * 90000)}`;
    const formattedPhone = formatGhanaNumber(phone);

    try {
        // 1. Save to Supabase
        if (supabase) {
            const { error: dbError } = await supabase
                .from('consultations')
                .insert([{
                    first_name, last_name, email, phone, 
                    practice_area, consultation_type, issue_description
                }]);
            
            if (dbError) {
                console.error('Supabase DB Insert Error:', dbError.message);
                throw new Error("Database insert failed.");
            }
        }

        // 2. Respond to the website IMMEDIATELY to prevent freezing. 
        res.status(200).json({ 
            success: true, 
            booking_id: bookingId,
            message: 'Consultation request received successfully.' 
        });

        // 3. Process SMS & Email silently in the background
        setImmediate(async () => {
            try {
                if (ARKESEL_API_KEY) {
                    const smsMessage = `Akoben Legal: Hello ${first_name}, your consultation request (Ref: ${bookingId}) has been received. Our chambers will contact you shortly to confirm your schedule.`;
                    await axios.post('https://sms.arkesel.com/api/v2/sms/send', {
                        sender: 'AKOBEN', 
                        message: smsMessage,
                        recipients: [formattedPhone]
                    }, {
                        headers: { 
                            'api-key': ARKESEL_API_KEY,
                            'Content-Type': 'application/json'
                        }
                    });
                }
            } catch(err) {
                console.log('Background SMS warning:', err?.response?.data || err.message);
            }

            try {
                if (EMAIL_USER && EMAIL_PASS && COUNSEL_EMAIL) {
                    const mailOptions = {
                        from: EMAIL_USER,
                        to: COUNSEL_EMAIL,
                        subject: `[${bookingId}] New Consultation Booking - ${first_name} ${last_name}`,
                        text: `New consultation booking submitted.\n\nBooking Reference: ${bookingId}\nClient: ${first_name} ${last_name}\nPhone: ${phone}\nEmail: ${email}\nArea: ${practice_area}\nType: ${consultation_type}\n\nClient Issue:\n${issue_description}\n\nPlease reach out to confirm the date and time.`
                    };
                    await transporter.sendMail(mailOptions);
                }
            } catch(err) {
                console.log('Background Email warning:', err.message);
            }
        });

    } catch (error) {
        console.error('Booking Processing Error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to record booking request.' });
    }
});

// ========================================================
// NOTIFICATIONS: Contact Form (BACKGROUND PROCESSING FIX)
// ========================================================
app.post('/api/notify-contact', async (req, res) => {
    const { name, email, subject, message } = req.body;

    try {
        if (supabase) {
            await supabase
                .from('contacts')
                .insert([{ name, email, subject, message }])
                .catch(err => console.error('Supabase DB Insert Error:', err.message));
        }

        // Return immediately
        res.status(200).json({ success: true, message: 'Message sent successfully.' });

        // Background processing
        setImmediate(async () => {
            if (EMAIL_USER && EMAIL_PASS) {
                if (email) {
                    transporter.sendMail({
                        from: EMAIL_USER,
                        to: email, 
                        subject: `Inquiry Received: ${subject}`,
                        text: `Hello ${name},\n\nThank you for reaching out to Akoben Legal Services. We have received your message regarding "${subject}". Counsel will review and respond shortly.\n\nBest Regards,\nAkoben Legal Services`
                    }).catch(err => console.log('Client mailer error:', err.message));
                }

                if (COUNSEL_EMAIL) {
                    transporter.sendMail({
                        from: EMAIL_USER,
                        to: COUNSEL_EMAIL,
                        subject: `Website Inquiry: ${subject}`,
                        text: `New message from ${name} (${email}):\n\nSubject: ${subject}\n\n${message}`
                    }).catch(err => console.log('Counsel mailer error:', err.message));
                }
            }
        });

    } catch (error) {
        console.error('Contact Notification Error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to process contact message.' });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Akoben Backend is running securely on port ${PORT}`);
});