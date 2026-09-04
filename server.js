const express = require('express');
const cors = require('cors');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

// Bulleproof open CORS so browser never hits network block
app.use(cors({ origin: '*' }));
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
    console.log('Supabase client connected.');
}

// Initialize Nodemailer for Yahoo
const transporter = nodemailer.createTransport({
    service: 'yahoo',
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
    }
});

// Health check endpoint
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Akoben Legal API</title></head>
    <body style="background:#0f172a;color:#22c55e;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <div style="text-align:center;background:rgba(255,255,255,0.05);padding:3rem;border-radius:16px;">
            <h1 style="margin:0 0 10px;">✓ YOUR WEBSITE BACKEND IS LIVE</h1>
            <p style="color:#94a3b8;">Akoben Legal Services API is running and ready.</p>
        </div>
    </body>
    </html>`);
});

// ========================================================
// 1. VERIFY COUNSEL & POPULATE DROPDOWN
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
                data.forEach(c => {
                    if (c.phone && !uniqueClients.has(c.phone)) {
                        uniqueClients.set(c.phone, `${c.first_name} ${c.last_name}`);
                    }
                });
                clients = Array.from(uniqueClients, ([phone, name]) => ({ name, phone }));
            }
        }
        res.status(200).json({ success: true, clients });
    } catch (err) {
        console.error('Verify Counsel Error:', err.message);
        res.status(500).json({ success: false, error: 'Database error occurred' });
    }
});

// ========================================================
// 2. CONSULTATION BOOKING (Instant ID + Background Send)
// ========================================================
app.post('/api/notify-consultation', async (req, res) => {
    const { 
        first_name, last_name, email, phone, 
        practice_area, consultation_type, issue_description 
    } = req.body;

    // Generate unique 5-digit booking reference ID
    const bookingId = `AKB-${Math.floor(10000 + Math.random() * 90000)}`;

    try {
        // 1. Save directly into Supabase
        if (supabase) {
            await supabase
                .from('consultations')
                .insert([{
                    first_name, last_name, email, phone, 
                    practice_area, consultation_type, issue_description
                }])
                .catch(err => console.error('Supabase DB Insert Error:', err.message));
        }

        // 2. Respond immediately to browser so user never waits
        res.status(200).json({ 
            success: true, 
            booking_id: bookingId,
            message: 'Consultation request received successfully.' 
        });

        // 3. Dispatch SMS & Email in background
        setImmediate(async () => {
            // SMS via Arkesel
            if (ARKESEL_API_KEY && phone) {
                // Determine the sender ID to use
                // Assuming you use AKOBEN, but you can change this if needed.
                const senderId = 'AKOBEN'; 
                const smsMessage = `Akoben Legal: Hello ${first_name}, your consultation request (Ref: ${bookingId}) has been received. Our chambers will contact you shortly to confirm your schedule.`;
                axios.post('https://sms.arkesel.com/api/v2/sms/send', {
                    sender: senderId, 
                    message: smsMessage,
                    recipients: [phone]
                }, {
                    headers: { 'api-key': ARKESEL_API_KEY }
                }).catch(err => console.log('Arkesel SMS notice:', err?.response?.data || err.message));
            }

            // Email via Yahoo
            if (EMAIL_USER && EMAIL_PASS && COUNSEL_EMAIL) {
                const mailOptions = {
                    from: EMAIL_USER,
                    to: COUNSEL_EMAIL,
                    subject: `[${bookingId}] New Consultation Booking - ${first_name} ${last_name}`,
                    text: `New consultation booking submitted.\n\nBooking Reference: ${bookingId}\nClient: ${first_name} ${last_name}\nPhone: ${phone}\nEmail: ${email}\nArea: ${practice_area}\nType: ${consultation_type}\n\nClient Issue:\n${issue_description}\n\nPlease reach out to confirm the date and time.`
                };
                transporter.sendMail(mailOptions).catch(err => console.log('Yahoo Mailer notice:', err.message));
            }
        });

    } catch (error) {
        console.error('Booking Processing Error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to record booking request.' });
    }
});

// ========================================================
// 3. CONTACT FORM
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

        res.status(200).json({ success: true, message: 'Message sent successfully.' });

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

// ========================================================
// 4. PUBLISH ARTICLE
// ========================================================
app.post('/api/publish-article', async (req, res) => {
    const { author, passcode, title, content } = req.body;

    if (passcode !== ADMIN_SECRET) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Counsel Passcode.' });
    }

    try {
        if (!supabase) throw new Error('Database not configured.');
        const { data, error } = await supabase.from('publications').insert([{ title, content, author }]).select();
        if (error) throw error;
        res.status(200).json({ success: true, message: 'Article published successfully.', data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ========================================================
// 5. SEND CUSTOM SMS
// ========================================================
app.post('/api/send-custom-sms', async (req, res) => {
    const { passcode, phone, message } = req.body;

    if (passcode !== ADMIN_SECRET) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Counsel Passcode.' });
    }

    try {
        // Log the attempt
        console.log(`Attempting to send custom SMS to ${phone}`);
        
        // Wait for the SMS response
        const smsResponse = await axios.post('https://sms.arkesel.com/api/v2/sms/send', {
            sender: 'AKOBEN', 
            message: message,
            recipients: [phone]
        }, {
            headers: { 'api-key': ARKESEL_API_KEY }
        });
        
        console.log(`Arkesel response status: ${smsResponse.status}`);
        
        res.status(200).json({ success: true, message: 'SMS sent successfully.' });
    } catch (error) {
        console.error('Custom SMS Error:', error?.response?.data || error.message);
        res.status(500).json({ success: false, error: 'Failed to send Custom SMS. Check Arkesel keys and credits.' });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Akoben Backend is running on port ${PORT}`);
});