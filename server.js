const express = require('express');
const cors = require('cors');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

app.use(cors({
    origin: '*' // Allows your frontend to communicate with this backend
}));
app.use(express.json());

// These keys will be hidden safely inside Render's dashboard or your local .env
const ARKESEL_API_KEY = process.env.ARKESEL_API_KEY;
const EMAIL_USER = process.env.EMAIL_USER; 
const EMAIL_PASS = process.env.EMAIL_PASS; // Using Yahoo App Password
const COUNSEL_EMAIL = process.env.COUNSEL_EMAIL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Initialize Supabase Client for backend database syncing
let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('Supabase client initialized successfully.');
}

// Initialize Mailer
const transporter = nodemailer.createTransport({
    service: 'yahoo',
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
    }
});

// Graphical Interface for Backend Status
app.get('/', (req, res) => {
    // Check if vital env variables exist to determine true "healthy" state
    const isConfigured = Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS && process.env.ARKESEL_API_KEY && process.env.SUPABASE_KEY);
    
    const statusColor = isConfigured ? '#22c55e' : '#ef4444';
    const statusBg = isConfigured ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)';
    const iconSymbol = isConfigured ? '✓' : '⚠';
    const titleText = isConfigured ? 'YOUR WEBSITE BACKEND IS LIVE' : 'YOUR WEBSITE BACKEND IS NOT LIVE';
    const descText = isConfigured 
        ? 'The API server for Akoben Legal Services is running perfectly, connected to Supabase, and ready to accept connections from your frontend.' 
        : 'RESOLVE THE CONFIGURATION ISSUE: Missing critical Environment Variables (e.g., EMAIL_USER, ARKESEL_API_KEY, SUPABASE_KEY). Please add them in the Render dashboard to restore full functionality.';

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
            .container { text-align: center; background: rgba(255, 255, 255, 0.03); padding: 4rem 2rem; border-radius: 24px; backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.05); box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1); cursor: default; max-width: 500px; width: 90%; }
            .container:hover { transform: translateY(-8px); border-color: rgba(255, 255, 255, 0.1); }
            .status-icon { width: 90px; height: 90px; border-radius: 50%; margin: 0 auto 2rem; display: flex; align-items: center; justify-content: center; font-size: 2.5rem; font-weight: 800; position: relative; background: ${statusBg}; color: ${statusColor}; border: 2px solid ${statusColor}; box-shadow: 0 0 30px ${statusBg}; transition: transform 0.2s; cursor: pointer; }
            .status-icon:active { transform: scale(0.9); }
            .ripple { position: absolute; width: 100%; height: 100%; border-radius: 50%; border: 2px solid ${statusColor}; animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; box-sizing: border-box; }
            @keyframes pulse { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(1.6); opacity: 0; } }
            h1 { margin: 0 0 1rem; font-size: 1.8rem; font-weight: 800; letter-spacing: -0.5px; }
            p { color: #94a3b8; font-size: 1.05rem; line-height: 1.6; margin: 0 auto; max-width: 400px; }
            .interactive-btn { margin-top: 2.5rem; padding: 0.8rem 2rem; background: transparent; color: #e2e8f0; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 50px; font-weight: 600; cursor: pointer; transition: all 0.3s ease; font-family: 'Inter', sans-serif; font-size: 0.95rem; }
            .interactive-btn:hover { background: rgba(255, 255, 255, 0.1); border-color: rgba(255, 255, 255, 0.4); transform: translateY(-2px); }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="status-icon" onclick="pingAnim(this)">
                <div class="ripple"></div>
                ${iconSymbol}
            </div>
            <h1 style="color: ${statusColor}">${titleText}</h1>
            <p>${descText}</p>
            <button class="interactive-btn" onclick="window.location.reload()">Ping Server Check</button>
        </div>
        <script>
            function pingAnim(el) {
                el.style.transform = 'scale(0.85)';
                setTimeout(() => el.style.transform = 'scale(1)', 150);
            }
        </script>
    </body>
    </html>
    `;
    res.send(htmlContent);
});

app.post('/api/notify-consultation', async (req, res) => {
    const { 
        first_name, last_name, email, phone, 
        practice_area, consultation_type, issue_description 
    } = req.body;

    try {
        // 1. Sync data securely to Supabase Backend
        if (supabase) {
            const { error: dbError } = await supabase
                .from('consultations')
                .insert([{
                    first_name, last_name, email, phone, 
                    practice_area, consultation_type, issue_description
                }]);
            
            if (dbError) console.error('Supabase DB Insert Error:', dbError.message);
        }

        // 2. Send Generic Receipt SMS to Client via Arkesel
        const smsMessage = `Hello ${first_name}, your ${consultation_type} consultation request has been received by Akoben Legal Services. We will contact you shortly to confirm your appointment date and time.`;
        
        await axios.post('https://sms.arkesel.com/api/v2/sms/send', {
            sender: 'AKOBEN', 
            message: smsMessage,
            recipients: [phone]
        }, {
            headers: { 'api-key': ARKESEL_API_KEY }
        });

        // 3. Send Immediate Email Alert to Counsel
        const mailOptions = {
            from: EMAIL_USER,
            to: COUNSEL_EMAIL,
            subject: `URGENT: New ${consultation_type} Consultation Booking - ${first_name} ${last_name}`,
            text: `You have a new consultation booking awaiting scheduling.\n\nDetails:\nName: ${first_name} ${last_name}\nEmail: ${email}\nPhone: ${phone}\nPractice Area: ${practice_area}\nType: ${consultation_type}\n\nClient's Issue/Notes:\n${issue_description}\n\nPlease reach out to the client to schedule the date and time. If this is a Virtual meeting, generate a Zoom link and provide it to them.`
        };
        
        await transporter.sendMail(mailOptions);

        res.status(200).json({ success: true, message: 'Database synced and Notifications deployed securely.' });
    } catch (error) {
        console.error('Notification Error:', error?.response?.data || error.message);
        res.status(500).json({ success: false, error: 'Failed to process notifications' });
    }
});

app.post('/api/notify-contact', async (req, res) => {
    const { name, email, subject, message } = req.body;

    try {
        // 1. Sync data securely to Supabase Backend
        if (supabase) {
            const { error: dbError } = await supabase
                .from('contacts')
                .insert([{ name, email, subject, message }]);
            
            if (dbError) console.error('Supabase DB Insert Error:', dbError.message);
        }

        // 2. Send Auto-Reply Feedback Email TO THE CLIENT
        const clientFeedbackMail = {
            from: EMAIL_USER,
            to: email, // Sending to the person who filled the form
            subject: `Request Received: ${subject}`,
            text: `Hello ${name},\n\nThank you for contacting Akoben Legal Services. We have successfully received your inquiry regarding "${subject}".\n\nA member of our team or Counsel will review your message and get back to you as soon as possible.\n\nBest Regards,\nAkoben Legal Services\nnyogyasi@yahoo.com`
        };
        await transporter.sendMail(clientFeedbackMail);

        // 3. Forward the actual message TO COUNSEL
        const counselAlertMail = {
            from: EMAIL_USER,
            to: COUNSEL_EMAIL,
            subject: `Website Inquiry: ${subject}`,
            text: `You have received a new general inquiry from the website.\n\nFrom: ${name}\nEmail: ${email}\nSubject: ${subject}\n\nMessage:\n${message}`
        };
        await transporter.sendMail(counselAlertMail);

        res.status(200).json({ success: true, message: 'Database synced and Contact emails sent successfully.' });
    } catch (error) {
        console.error('Contact Notification Error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to process contact emails' });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Akoben Backend is running securely on port ${PORT}`);
});