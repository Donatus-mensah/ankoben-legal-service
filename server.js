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
const CLERK_PHONE = '233577780056'; // Victoria Kotei's Phone Number

// Initialize Supabase Client
let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('Supabase client initialized successfully.');
}

// Initialize Nodemailer for Gmail Setup
const transporter = nodemailer.createTransport({
    service: 'gmail', // Transitioned from Yahoo to Gmail
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS // Requires Google App Password
    }
});

// Helper Function: Format Ghana Phone Numbers for Arkesel
function formatGhanaNumber(phone) {
    if (!phone) return '';
    let formatted = phone.trim().replace(/[^0-9]/g, '');
    if (formatted.startsWith('0')) {
        formatted = '233' + formatted.substring(1);
    } else if (!formatted.startsWith('233')) {
        formatted = '233' + formatted;
    }
    return formatted;
}

// Helper to prevent 'undefined' string bugs in mapping
const safeString = (val, fallback) => (val && val !== 'undefined' && val !== null) ? val : fallback;

// ========================================================
// HEALTH CHECK
// ========================================================
app.get('/', (req, res) => {
    const isConfigured = Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS && process.env.ARKESEL_API_KEY && process.env.SUPABASE_KEY);
    res.send(`Backend Status: ${isConfigured ? 'LIVE (Gmail Activated)' : 'MISSING VARIABLES'}`);
});

// ========================================================
// 1. AUTHENTICATION & FULL CLIENT FETCH ROUTE
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
                .select('id, first_name, last_name, phone, email, booking_ref, status, appointment_date, appointment_time, practice_area, consultation_type, issue_description, created_at')
                .order('created_at', { ascending: false });

            if (!error && data) {
                clients = data.map(client => ({
                    id: client.id,
                    name: `${safeString(client.first_name, '')} ${safeString(client.last_name, '')}`.trim() || 'Unknown Client',
                    first_name: safeString(client.first_name, ''),
                    last_name: safeString(client.last_name, ''),
                    phone: safeString(client.phone, 'N/A'),
                    email: safeString(client.email, 'N/A'),
                    ref: safeString(client.booking_ref, 'PENDING'),
                    status: safeString(client.status, 'Pending'),
                    appointment_date: client.appointment_date || null,
                    appointment_time: client.appointment_time || null,
                    practice_area: safeString(client.practice_area, 'General'),
                    consultation_type: safeString(client.consultation_type, 'In-Person'),
                    issue_description: safeString(client.issue_description, ''),
                    created_at: client.created_at
                }));
            }
        }
        res.status(200).json({ success: true, clients });
    } catch (err) {
        console.error('Verify Counsel Error:', err.message);
        res.status(500).json({ success: false, error: 'Database query error.' });
    }
});

// ========================================================
// 2. SECURE PUBLICATION ENDPOINT (WITH MEDIA URL)
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
        res.status(500).json({ success: false, error: err.message });
    }
});

// ========================================================
// 3. SCHEDULE CONSULTATION (SMS & SET CONFIRMED STATUS)
// ========================================================
app.post('/api/schedule-consultation', async (req, res) => {
    const { passcode, id, date, time } = req.body;

    if (passcode !== ADMIN_SECRET) return res.status(401).json({ success: false, error: 'Unauthorized.' });
    if (!id || !date || !time) return res.status(400).json({ success: false, error: 'Missing parameters.' });

    try {
        if (!supabase) throw new Error('Database is not connected.');

        // Update status to Confirmed
        const { data: updatedRecord, error: updateError } = await supabase
            .from('consultations')
            .update({ appointment_date: date, appointment_time: time, status: 'Confirmed' })
            .eq('id', id)
            .select()
            .single();

        if (updateError) throw updateError;

        const clientName = `${updatedRecord.first_name} ${updatedRecord.last_name}`;
        const formattedDate = new Date(date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const formattedPhone = formatGhanaNumber(updatedRecord.phone);
        const refCode = updatedRecord.booking_ref || 'CONFIRMED';

        // SMS to Client
        if (ARKESEL_API_KEY) {
            const smsMessage = `Hello ${updatedRecord.first_name}, your consultation with Akoben Legal Services (Ref: ${refCode}) is confirmed for ${formattedDate} at ${time}. Please arrive on time.`;
            await axios.post('https://sms.arkesel.com/api/v2/sms/send', {
                sender: 'AKOBEN', message: smsMessage, recipients: [formattedPhone]
            }, { headers: { 'api-key': ARKESEL_API_KEY, 'Content-Type': 'application/json' } })
            .catch(err => console.error('Arkesel SMS Schedule error:', err?.response?.data || err.message));
        }

        res.status(200).json({ success: true, message: `Consultation confirmed and official SMS sent to ${clientName}.` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message || 'Failed to schedule appointment.' });
    }
});

// ========================================================
// 4. MANUAL STATUS UPDATE ENDPOINT (ATTENDANCE)
// ========================================================
app.post('/api/update-consultation-status', async (req, res) => {
    const { passcode, id, status } = req.body;

    if (passcode !== ADMIN_SECRET) return res.status(401).json({ success: false, error: 'Unauthorized.' });

    try {
        if (!supabase) throw new Error('Database is not connected.');
        const { error } = await supabase.from('consultations').update({ status: status }).eq('id', id);
        if (error) throw error;

        res.status(200).json({ success: true, message: `Consultation marked as ${status}.` });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to update consultation status.' });
    }
});

// ========================================================
// 5. NOTIFICATIONS: Consultations (BACKGROUND PROCESSING)
// ========================================================
app.post('/api/notify-consultation', async (req, res) => {
    const { first_name, last_name, email, phone, practice_area, consultation_type, issue_description } = req.body;
    const bookingId = `AKB-${Math.floor(10000 + Math.random() * 90000)}`;
    const formattedPhone = formatGhanaNumber(phone);

    try {
        if (supabase) {
            // Prevent double booking UNLESS they are marked Completed/Cancelled
            const emailQuery = email ? `email.eq.${email}` : 'email.eq.NONE';
            const phoneQuery = phone ? `phone.eq.${phone}` : 'phone.eq.NONE';
            
            const { data: existingBookings } = await supabase
                .from('consultations')
                .select('*')
                .or(`${emailQuery},${phoneQuery}`)
                .in('status', ['Pending', 'Confirmed']);

            if (existingBookings && existingBookings.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: `You already have an active booking (Status: ${existingBookings[0].status}). Please wait for your consultation or contact us directly.`
                });
            }

            const { error: dbError } = await supabase.from('consultations').insert([{
                first_name, last_name, email, phone, practice_area, consultation_type, issue_description,
                booking_ref: bookingId, status: 'Pending'
            }]);
            
            if (dbError) throw new Error("Database insert failed.");
        }

        res.status(200).json({ success: true, booking_id: bookingId, message: 'Consultation request received.' });

        // Background Processing for Notifications
        setImmediate(async () => {
            if (ARKESEL_API_KEY) {
                // SMS 1: To the Client
                try {
                    const clientSms = `Hello ${first_name}, your consultation request (Ref: ${bookingId}) has been received. Our chambers will contact you shortly to confirm your schedule.`;
                    await axios.post('https://sms.arkesel.com/api/v2/sms/send', {
                        sender: 'AKOBEN', message: clientSms, recipients: [formattedPhone]
                    }, { headers: { 'api-key': ARKESEL_API_KEY, 'Content-Type': 'application/json' } });
                } catch(err) { console.log('Background SMS Client warning:', err.message); }

                // SMS 2: To the Legal Clerk (Administrator)
                try {
                    const adminSms = `AKOBEN ALERTS: New Booking (Ref: ${bookingId}). Client: ${first_name} ${last_name}. Phone: ${phone}. Area: ${practice_area}. Please check portal to confirm schedule.`;
                    await axios.post('https://sms.arkesel.com/api/v2/sms/send', {
                        sender: 'AKOBEN', message: adminSms, recipients: [CLERK_PHONE]
                    }, { headers: { 'api-key': ARKESEL_API_KEY, 'Content-Type': 'application/json' } });
                } catch(err) { console.log('Background SMS Admin warning:', err.message); }
            }

            // Email Notification to the Clerk/Counsel at akobenlegalservices@gmail.com
            // Make sure COUNSEL_EMAIL is set to akobenlegalservices@gmail.com in Render environment
            if (EMAIL_USER && EMAIL_PASS && COUNSEL_EMAIL) {
                try {
                    const mailOptions = {
                        from: EMAIL_USER, 
                        to: COUNSEL_EMAIL, // Notification sent here
                        subject: `[${bookingId}] New Consultation Booking - ${first_name} ${last_name}`,
                        text: `New consultation booking submitted.\n\nBooking Reference: ${bookingId}\nClient: ${first_name} ${last_name}\nPhone: ${phone}\nEmail: ${email}\nArea: ${practice_area}\nType: ${consultation_type}\n\nClient Issue:\n${issue_description}\n\nPlease log in to the Counsel Portal to set an appointment schedule.`
                    };
                    await transporter.sendMail(mailOptions);
                } catch(err) { console.log('Background Email warning:', err.message); }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to record booking request.' });
    }
});

// ========================================================
// 6. NOTIFICATIONS: Contact Form (BACKGROUND PROCESSING)
// ========================================================
app.post('/api/notify-contact', async (req, res) => {
    const { name, email, subject, message } = req.body;

    try {
        if (supabase) await supabase.from('contacts').insert([{ name, email, subject, message }]);
        res.status(200).json({ success: true, message: 'Message sent successfully.' });

        setImmediate(async () => {
            if (EMAIL_USER && EMAIL_PASS) {
                if (email) {
                    transporter.sendMail({
                        from: EMAIL_USER, to: email, 
                        subject: `Inquiry Received: ${subject}`,
                        text: `Hello ${name},\n\nThank you for reaching out to Akoben Legal Services. We have received your message. Counsel will review and respond shortly.\n\nBest Regards,\nAkoben Legal Services`
                    }).catch(err => console.log('Client mailer error:', err.message));
                }
                if (COUNSEL_EMAIL) {
                    transporter.sendMail({
                        from: EMAIL_USER, to: COUNSEL_EMAIL,
                        subject: `Website Inquiry: ${subject}`,
                        text: `New message from ${name} (${email}):\n\nSubject: ${subject}\n\n${message}`
                    }).catch(err => console.log('Counsel mailer error:', err.message));
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to process contact message.' });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Akoben Backend is running securely on port ${PORT}`);
});